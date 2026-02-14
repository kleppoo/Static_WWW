/**
 * Lambda Build + Publish handler.
 *
 * Route: POST /batteries/{code}/publish
 *
 * Flow:
 *   1. Read battery data from DynamoDB
 *   2. Read template files from S3 (_templates/)
 *   3. Build self-contained HTML pages in memory
 *   4. Upload HTML to S3 (b/{code}/)
 *   5. Invalidate CloudFront cache
 *   6. Update battery status in DynamoDB → "published"
 *
 * Dependencies: qrcode (bundled via esbuild/NodejsFunction)
 * AWS SDK v3: included in Lambda runtime
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import crypto from "node:crypto";
import * as QRCode from "qrcode";

// ── AWS Clients ──────────────────────────────────────────────────

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
const cf = new CloudFrontClient({ region: "us-east-1" });

// ── Environment ──────────────────────────────────────────────────

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;
const TEMPLATES_PREFIX = process.env.TEMPLATES_PREFIX || "_templates/";
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || "";

// ── Template Cache (cold start) ──────────────────────────────────

let cachedTemplates = null;

async function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;

  const files = [
    { key: `${TEMPLATES_PREFIX}index.template.html`, name: "index" },
    { key: `${TEMPLATES_PREFIX}instructions-safety.template.html`, name: "instructions" },
    { key: `${TEMPLATES_PREFIX}assets/styles.css`, name: "css" },
    { key: `${TEMPLATES_PREFIX}assets/app.js`, name: "js" },
    { key: `${TEMPLATES_PREFIX}assets/logo.svg`, name: "logo" },
  ];

  const results = await Promise.all(
    files.map(async (f) => {
      const resp = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET_NAME, Key: f.key })
      );
      const body = await resp.Body.transformToString("utf-8");
      return { name: f.name, content: body };
    })
  );

  cachedTemplates = {};
  for (const r of results) {
    cachedTemplates[r.name] = r.content;
  }

  console.log(`[Build] Templates loaded: ${Object.keys(cachedTemplates).join(", ")}`);
  return cachedTemplates;
}

// ── Build Engine (adapted from tools/build.mjs) ─────────────────

function get(obj, dotPath) {
  if (!dotPath) return undefined;
  return dotPath
    .split(".")
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function escapeHtml(str) {
  if (str == null || str === "") return "\u2014";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function inferHasEnglish(data) {
  const explicit = get(data, "page.hasEnglish");
  if (typeof explicit === "boolean") return explicit;
  const langs = get(data, "page.languages");
  if (Array.isArray(langs)) return langs.includes("en");
  return Boolean(get(data, "wasteInfo.en") || get(data, "battery.extinguishingAgent.en"));
}

async function buildPage(templateHtml, data, css, js, logoDataUri, options = {}) {
  let html = templateHtml;

  // Language switch
  const langSwitchHTML = options.hasEnglish
    ? `<button class="chip chip--active" type="button" data-action="lang" data-lang="pl" aria-pressed="true">PL</button>
        <button class="chip" type="button" data-action="lang" data-lang="en" aria-pressed="false">EN</button>`
    : "";
  html = html.replace(/<!-- LANG_SWITCH -->/g, langSwitchHTML);

  // 1. data-bind placeholders
  html = html.replace(/data-bind="([^"]+)">([^<]*)</g, (_match, path, fallback) => {
    const value = get(data, path);
    return `>${escapeHtml(value ?? fallback)}<`;
  });

  // 2. data-bind-href
  html = html.replace(/data-bind-href="([^"]+)"/g, (_match, path) => {
    const value = get(data, path);
    return value ? `href="${escapeHtml(value)}"` : 'href="#"';
  });

  // 2b. QR code (index only)
  if (options.kind === "index") {
    const qrValue = get(data, "page.qrValue") || get(data, "page.permalink") || get(data, "page.code") || "";
    let qrSvg = '<p class="muted">\u2014</p>';
    if (qrValue) {
      qrSvg = await QRCode.toString(String(qrValue), {
        type: "svg", errorCorrectionLevel: "M", margin: 0,
        color: { dark: "#000000", light: "#ffffff" },
      });
      qrSvg = qrSvg
        .replace(/<\?xml[^>]*>\s*/i, "")
        .replace(/\s+width="[^"]*"/i, "")
        .replace(/\s+height="[^"]*"/i, "")
        .replace(/<svg\b/i, '<svg role="img" aria-label="QR code"');
    }
    html = html.replace(/<!-- QR_SVG -->/g, qrSvg);
  }

  // 3. Metrics (index only)
  if (options.kind === "index") {
    for (const pos of ["left", "middle", "right"]) {
      const metricsHtml = (data[`battery.${pos}`] || [])
        .map((m) =>
          `<div class="metric"><div class="metric__label">${escapeHtml(m.label)}</div><div class="metric__value">${escapeHtml(m.value)}</div>${m.sub ? `<div class="metric__sub">${escapeHtml(m.sub)}</div>` : ""}</div>`
        )
        .join("\n        ");
      html = html.replace(new RegExp(`<!-- METRICS_${pos.toUpperCase()} -->`, "g"), metricsHtml);
    }
  }

  // 4. Documents
  const docsHTML = (get(data, "documents") || [])
    .map((d) =>
      `<li class="doc"><div><div class="doc__title">${escapeHtml(d.title)}</div><div class="doc__meta">v${escapeHtml(d.version)} \u2022 ${escapeHtml(d.language)}</div></div><a class="btn" href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">Open</a></li>`
    )
    .join("\n    ");
  html = html.replace(/<!-- DOCUMENTS -->/g, docsHTML);

  // 4b. Document versions
  const documents = get(data, "documents") || [];
  const documentVersionsHTML = documents.length
    ? `<ul class="miniList">\n${documents
        .slice()
        .sort((a, b) => {
          const av = Number.parseFloat(String(a.version ?? "0")) || 0;
          const bv = Number.parseFloat(String(b.version ?? "0")) || 0;
          if (bv !== av) return bv - av;
          return String(a.title ?? "").localeCompare(String(b.title ?? ""));
        })
        .map((d) =>
          `  <li><a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">${escapeHtml(d.title)}</a> \u2014 v${escapeHtml(d.version)} \u2022 ${escapeHtml(d.language)}</li>`
        )
        .join("\n")}\n</ul>`
    : '<p class="muted">\u2014</p>';
  html = html.replace(/<!-- DOCUMENT_VERSIONS -->/g, documentVersionsHTML);

  // 5. Video
  const video = get(data, "video");
  const videoHTML =
    video && video.url
      ? `<a class="btn btnPrimary" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">Open video</a>${video.note ? ` <span class="muted">${escapeHtml(video.note)}</span>` : ""}`
      : "\u2014";
  html = html.replace(/<!-- VIDEO -->/g, videoHTML);

  // 6. Safety lists
  const hazardousHTML = (get(data, "battery.hazardousSubstances") || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("\n          ");
  const criticalHTML = (get(data, "battery.criticalRawMaterials") || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("\n          ");
  html = html.replace(/<!-- HAZARDOUS -->/g, hazardousHTML || "<li>\u2014</li>");
  html = html.replace(/<!-- CRITICAL -->/g, criticalHTML || "<li>\u2014</li>");

  // 7. Extinguishing agent
  const extPL = get(data, "battery.extinguishingAgent.pl") || "\u2014";
  const extEN = get(data, "battery.extinguishingAgent.en") || extPL;
  html = html.replace(/<!-- EXTINGUISHING_PL -->/g, escapeHtml(extPL));
  html = html.replace(/<!-- EXTINGUISHING_EN -->/g, escapeHtml(extEN));

  // 8. Waste info
  const wasteKeys = ["a_prevention", "b_collectionRole", "c_whereToReturn", "d_safety", "e_labelsMeaning", "f_healthEnvironment"];
  for (const key of wasteKeys) {
    const plVal = get(data, `wasteInfo.pl.${key}`) || "\u2014";
    const enVal = get(data, `wasteInfo.en.${key}`) || plVal;
    html = html.replace(new RegExp(`<!-- WASTE_${key.toUpperCase()}_PL -->`, "g"), escapeHtml(plVal));
    html = html.replace(new RegExp(`<!-- WASTE_${key.toUpperCase()}_EN -->`, "g"), escapeHtml(enVal));
  }

  // 9. Inline CSS
  html = html.replace(/<link rel="stylesheet" href="\.\/assets\/styles\.css" \/>/, `<style>\n${css}\n</style>`);

  // 10. Inline JS
  html = html.replace(/<script src="\.\/assets\/app\.js" defer><\/script>/, `<script>\n${js}\n</script>`);

  // 11. Inline logo
  html = html.replace(/src="\.\/assets\/logo\.svg"/g, `src="${logoDataUri}"`);

  // 12. Build metadata
  const buildDate = new Date().toISOString();
  html = html.replace(
    /<meta charset="utf-8" \/>/,
    `<meta charset="utf-8" />\n  <meta name="generator" content="Battery Info Static Builder v2.0 (Lambda)" />\n  <meta name="build-date" content="${buildDate}" />`
  );

  return { html, buildDate };
}

// ── Main Handler ─────────────────────────────────────────────────

function apiResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key,X-Tenant-Id",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  const rawCode = event.pathParameters?.code;
  const code = rawCode ? decodeURIComponent(rawCode) : null;

  // Extract tenant from JWT (same logic as CRUD Lambda)
  const authHeader = event.headers?.Authorization || event.headers?.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  let jwt = {};
  try { jwt = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch {}
  const groups = jwt["cognito:groups"] || [];
  const isSuperadmin = groups.includes("superadmin");
  const tenantIdFromToken = jwt["custom:tenantId"] || null;

  let tenantId;
  if (isSuperadmin) {
    tenantId = event.headers?.["x-tenant-id"] || event.headers?.["X-Tenant-Id"] || tenantIdFromToken || "default";
  } else {
    tenantId = tenantIdFromToken;
    if (!tenantId) {
      return apiResponse(403, { error: "No tenantId assigned to your account" });
    }
  }

  if (!code) {
    return apiResponse(400, { error: "Battery code required in URL" });
  }

  console.log(`[Build] Publishing battery '${code}' for tenant '${tenantId}'`);

  try {
    // 1. Get battery data from DynamoDB
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: `TENANT#${tenantId}`, SK: `BATTERY#${code}` },
      })
    );

    if (!result.Item) {
      return apiResponse(404, { error: `Battery '${code}' not found` });
    }

    const data = result.Item.data;

    // 2. Load templates from S3
    const templates = await loadTemplates();
    const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(templates.logo).toString("base64")}`;
    const hasEnglish = inferHasEnglish(data);

    // 3. Build both pages
    const pages = [
      { template: templates.index, kind: "index", fileName: "index.html" },
      { template: templates.instructions, kind: "instructions", fileName: "instructions-safety.html" },
    ];

    const s3Prefix = code.startsWith("b/") ? code : `b/${code}`;
    const uploadedUrls = {};
    const buildResults = [];

    for (const page of pages) {
      const { html, buildDate } = await buildPage(
        page.template, data, templates.css, templates.js, logoDataUri,
        { kind: page.kind, hasEnglish }
      );

      const s3Key = `${s3Prefix}/${page.fileName}`;
      const checksum = sha256(html);

      // 4. Upload to S3
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: html,
          ContentType: "text/html; charset=utf-8",
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: {
            "build-date": buildDate,
            "battery-code": code,
            "sha256": checksum,
          },
        })
      );

      const url = CLOUDFRONT_DOMAIN
        ? `https://${CLOUDFRONT_DOMAIN}/${s3Key}`
        : `s3://${BUCKET_NAME}/${s3Key}`;

      uploadedUrls[page.kind] = url;
      buildResults.push({
        fileName: page.fileName,
        s3Key,
        sizeKB: (Buffer.byteLength(html, "utf8") / 1024).toFixed(2),
        sha256: checksum,
        buildDate,
      });

      console.log(`[Build] Uploaded ${s3Key} (${buildResults.at(-1).sizeKB} KB)`);
    }

    // 5. Invalidate CloudFront cache
    let invalidationId = null;
    if (DISTRIBUTION_ID) {
      const paths = buildResults.map((r) => `/${r.s3Key}`);
      const inv = await cf.send(
        new CreateInvalidationCommand({
          DistributionId: DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `publish-${code}-${Date.now()}`,
            Paths: { Quantity: paths.length, Items: paths },
          },
        })
      );
      invalidationId = inv.Invalidation?.Id;
      console.log(`[Build] CloudFront invalidation: ${invalidationId}`);
    }

    // 6. Update battery status in DynamoDB
    const publishedAt = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `TENANT#${tenantId}`, SK: `BATTERY#${code}` },
        UpdateExpression: "SET #s = :s, publishedAt = :p, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":s": "published",
          ":p": publishedAt,
          ":u": publishedAt,
        },
      })
    );

    return apiResponse(200, {
      message: `Battery '${code}' published successfully`,
      urls: uploadedUrls,
      pages: buildResults,
      invalidationId,
      publishedAt,
    });
  } catch (err) {
    console.error("[Build] Error:", err);
    return apiResponse(500, {
      error: "Build failed",
      details: err.message,
    });
  }
}
