import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const dataPath = path.join(root, "data", "page.json");
const cssPath = path.join(root, "assets", "styles.css");
const jsPath = path.join(root, "assets", "app.js");
const logoPath = path.join(root, "assets", "logo.svg");
const distDir = path.join(root, "dist");

const templates = [
  { 
    tpl: "battery-info.template.html", 
    out: "battery-info.html" 
  },
  { 
    tpl: "instructions-safety.template.html", 
    out: "instructions-safety.html" 
  }
];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function get(obj, path) {
  if (!path) return undefined;
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function escapeHtml(str) {
  if (str == null || str === "") return "—";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPage(tplName, outputName, data, css, js, logoDataUri) {
  const tplPath = path.join(root, tplName);
  let html = fs.readFileSync(tplPath, "utf8");
  
  // 1. Replace all data-bind placeholders with actual values
  html = html.replace(/data-bind="([^"]+)">([^<]*)</g, (match, path, fallback) => {
    const value = get(data, path);
    return `>${escapeHtml(value ?? fallback)}<`;
  });

  // 2. Replace data-bind-href
  html = html.replace(/data-bind-href="([^"]+)"/g, (match, path) => {
    const value = get(data, path);
    return value ? `href="${escapeHtml(value)}"` : 'href="#"';
  });

  // 3. Generate metrics HTML from data (only for battery-info page)
  if (tplName.includes("battery-info")) {
    const metricsHTML = {
      left: (data["battery.left"] || []).map(m => 
        `<div class="metric"><div class="metric__label">${escapeHtml(m.label)}</div><div class="metric__value">${escapeHtml(m.value)}</div>${m.sub ? `<div class="metric__sub">${escapeHtml(m.sub)}</div>` : ''}</div>`
      ).join("\n        "),
      middle: (data["battery.middle"] || []).map(m => 
        `<div class="metric"><div class="metric__label">${escapeHtml(m.label)}</div><div class="metric__value">${escapeHtml(m.value)}</div>${m.sub ? `<div class="metric__sub">${escapeHtml(m.sub)}</div>` : ''}</div>`
      ).join("\n        "),
      right: (data["battery.right"] || []).map(m => 
        `<div class="metric"><div class="metric__label">${escapeHtml(m.label)}</div><div class="metric__value">${escapeHtml(m.value)}</div>${m.sub ? `<div class="metric__sub">${escapeHtml(m.sub)}</div>` : ''}</div>`
      ).join("\n        ")
    };

    html = html.replace(/<!-- METRICS_LEFT -->/g, metricsHTML.left);
    html = html.replace(/<!-- METRICS_MIDDLE -->/g, metricsHTML.middle);
    html = html.replace(/<!-- METRICS_RIGHT -->/g, metricsHTML.right);
  }

  // 4. Generate documents HTML
  const docsHTML = (get(data, "documents") || []).map(d =>
    `<li class="doc">
      <div>
        <div class="doc__title">${escapeHtml(d.title)}</div>
        <div class="doc__meta">v${escapeHtml(d.version)} • ${escapeHtml(d.language)}</div>
      </div>
      <a class="btn" href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">Open</a>
    </li>`
  ).join("\n    ");
  html = html.replace(/<!-- DOCUMENTS -->/g, docsHTML);

  // 4b. Generate document history / versions list (for battery-info template)
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
        .map(
          (d) =>
            `  <li><a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">${escapeHtml(d.title)}</a> — v${escapeHtml(d.version)} • ${escapeHtml(d.language)}</li>`
        )
        .join("\n")}\n</ul>`
    : '<p class="muted">—</p>';
  html = html.replace(/<!-- DOCUMENT_VERSIONS -->/g, documentVersionsHTML);

  // 5. Generate video HTML (if exists)
  const video = get(data, "video");
  const videoHTML = video && video.url 
    ? `<a class="btn btnPrimary" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">Open video</a>
        ${video.note ? `<span class="muted">${escapeHtml(video.note)}</span>` : ''}`
    : "—";
  html = html.replace(/<!-- VIDEO -->/g, videoHTML);

  // 6. Generate safety lists
  const hazardousHTML = (get(data, "battery.hazardousSubstances") || [])
    .map(x => `<li>${escapeHtml(x)}</li>`).join("\n          ");
  const criticalHTML = (get(data, "battery.criticalRawMaterials") || [])
    .map(x => `<li>${escapeHtml(x)}</li>`).join("\n          ");
  html = html.replace(/<!-- HAZARDOUS -->/g, hazardousHTML || "<li>—</li>");
  html = html.replace(/<!-- CRITICAL -->/g, criticalHTML || "<li>—</li>");

  // 7. Extinguishing agent (with lang support)
  const extPL = get(data, "battery.extinguishingAgent.pl") || "—";
  const extEN = get(data, "battery.extinguishingAgent.en") || extPL;
  html = html.replace(/<!-- EXTINGUISHING_PL -->/g, escapeHtml(extPL));
  html = html.replace(/<!-- EXTINGUISHING_EN -->/g, escapeHtml(extEN));

  // 8. Waste info (with lang support for accordions)
  const wasteKeys = ["a_prevention", "b_collectionRole", "c_whereToReturn", "d_safety", "e_labelsMeaning", "f_healthEnvironment"];
  wasteKeys.forEach(key => {
    const plVal = get(data, `wasteInfo.pl.${key}`) || "—";
    const enVal = get(data, `wasteInfo.en.${key}`) || plVal;
    html = html.replace(new RegExp(`<!-- WASTE_${key.toUpperCase()}_PL -->`, 'g'), escapeHtml(plVal));
    html = html.replace(new RegExp(`<!-- WASTE_${key.toUpperCase()}_EN -->`, 'g'), escapeHtml(enVal));
  });

  // 9. Inline CSS (replace <link> with <style>)
  html = html.replace(
    /<link rel="stylesheet" href="\.\/assets\/styles\.css" \/>/,
    `<style>\n${css}\n</style>`
  );

  // 10. Inline JS (replace <script src> with inline <script>)
  html = html.replace(
    /<script src="\.\/assets\/app\.js" defer><\/script>/,
    `<script>\n${js}\n</script>`
  );

  // 11. Inline logo SVG as data URI
  html = html.replace(
    /src="\.\/assets\/logo\.svg"/g,
    `src="${logoDataUri}"`
  );

  // 12. Add meta for future-proofing
  const buildDate = new Date().toISOString();
  html = html.replace(
    /<meta charset="utf-8" \/>/,
    `<meta charset="utf-8" />\n  <meta name="generator" content="Battery Info Static Builder v2.0 (Hardcoded)" />\n  <meta name="build-date" content="${buildDate}" />`
  );

  // Write output
  const outputPath = path.join(distDir, outputName);
  fs.writeFileSync(outputPath, html, "utf8");

  // Generate SHA-256 checksum
  const checksum = sha256(html);
  const checksumPath = path.join(distDir, `${outputName}.sha256`);
  fs.writeFileSync(checksumPath, `${checksum}  ${outputName}\n`, "utf8");

  return {
    fileName: outputName,
    size: Buffer.byteLength(html, "utf8"),
    checksum,
    buildDate
  };
}

// Main build process
console.log("🔨 Building static HTML pages...\n");

// Read all source files once
const dataJson = fs.readFileSync(dataPath, "utf8");
const data = JSON.parse(dataJson);
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");
const logo = fs.readFileSync(logoPath, "utf8");

// Convert SVG to data URI
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;

// Ensure dist directory exists
ensureDir(distDir);

// Build all pages
const buildResults = templates.map(({ tpl, out }) => {
  console.log(`📄 Building ${out}...`);
  return buildPage(tpl, out, data, css, js, logoDataUri);
});

// Copy battery-info.html as index.html (main landing page)
console.log("📄 Copying battery-info.html → index.html...");
const batteryInfoPath = path.join(distDir, "battery-info.html");
const indexPath = path.join(distDir, "index.html");
fs.copyFileSync(batteryInfoPath, indexPath);

// Generate checksum for index.html
const indexContent = fs.readFileSync(indexPath, "utf8");
const indexChecksum = sha256(indexContent);
fs.writeFileSync(
  path.join(distDir, "index.html.sha256"),
  `${indexChecksum}  index.html\n`,
  "utf8"
);

buildResults.push({
  fileName: "index.html",
  size: Buffer.byteLength(indexContent, "utf8"),
  checksum: indexChecksum,
  buildDate: buildResults[0].buildDate
});

// Generate overall metadata
const metadata = {
  buildDate: buildResults[0].buildDate,
  version: "2.0",
  pages: buildResults.map(r => ({
    fileName: r.fileName,
    fileSizeBytes: r.size,
    fileSizeKB: (r.size / 1024).toFixed(2),
    sha256: r.checksum
  })),
  sources: {
    data: path.basename(dataPath),
    css: path.basename(cssPath),
    js: path.basename(jsPath),
    logo: path.basename(logoPath)
  }
};

fs.writeFileSync(
  path.join(distDir, "build-metadata.json"),
  JSON.stringify(metadata, null, 2),
  "utf8"
);

// Print summary
console.log("\n✅ Build complete!\n");
buildResults.forEach(r => {
  console.log(`📦 ${r.fileName}`);
  console.log(`   📏 Size: ${(r.size / 1024).toFixed(2)} KB`);
  console.log(`   🔒 SHA-256: ${r.checksum.substring(0, 16)}...`);
});
console.log(`\n🕐 Build date: ${metadata.buildDate}`);
console.log("💾 Data hardcoded in HTML (no JSON runtime dependency)");
console.log("🎯 Works without JavaScript - maximum 10+ year stability!");

