/**
 * Upload built HTML pages to S3 and optionally invalidate CloudFront cache.
 *
 * Usage:
 *   node tools/upload.mjs                    # upload only
 *   node tools/upload.mjs --invalidate       # upload + CloudFront invalidation
 *   node tools/upload.mjs --dry-run          # preview what would be uploaded
 *
 * Required env vars (or .env file):
 *   BUCKET_NAME          - S3 bucket name
 *   DISTRIBUTION_ID      - CloudFront distribution ID (only for --invalidate)
 *   AWS_REGION           - AWS region (default: eu-central-1)
 *
 * AWS credentials: via AWS CLI profile, env vars (AWS_ACCESS_KEY_ID etc.), or IAM role.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const root = process.cwd();

// Obsługa .env (bez zewnętrznej zależności — prosty parser)
function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();

const BUCKET_NAME = process.env.BUCKET_NAME;
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;
const AWS_REGION = process.env.AWS_REGION || "eu-central-1";

const shouldInvalidate = process.argv.includes("--invalidate");
const dryRun = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Resolve battery code from page.json
// ---------------------------------------------------------------------------
const pageDataPath = path.join(root, "data", "page.json");
const distDir = path.join(root, "dist");

if (!fs.existsSync(pageDataPath)) {
  console.error("❌ data/page.json not found. Cannot determine battery code.");
  process.exit(1);
}

if (!BUCKET_NAME) {
  console.error("❌ BUCKET_NAME not set. Add it to .env or set as environment variable.");
  console.error("   You can find it in CDK deploy output: BatteryStaticHosting.BucketName");
  process.exit(1);
}

const pageData = JSON.parse(fs.readFileSync(pageDataPath, "utf8"));
const batteryCode = pageData?.page?.code; // e.g. "b/abc123"

if (!batteryCode) {
  console.error("❌ page.code not found in data/page.json");
  process.exit(1);
}

// Ensure code starts with "b/" for URL structure
const s3Prefix = batteryCode.startsWith("b/") ? batteryCode : `b/${batteryCode}`;

// ---------------------------------------------------------------------------
// Files to upload
// ---------------------------------------------------------------------------
const filesToUpload = [
  { local: "index.html", s3Key: `${s3Prefix}/index.html`, contentType: "text/html; charset=utf-8" },
  { local: "instructions-safety.html", s3Key: `${s3Prefix}/instructions-safety.html`, contentType: "text/html; charset=utf-8" },
];

// Verify all files exist
for (const file of filesToUpload) {
  const fullPath = path.join(distDir, file.local);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ ${file.local} not found in dist/. Run 'npm run build' first.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
console.log(`\n📤 Uploading battery pages to S3...`);
console.log(`   Bucket:  ${BUCKET_NAME}`);
console.log(`   Region:  ${AWS_REGION}`);
console.log(`   Prefix:  ${s3Prefix}/`);
console.log(`   Files:   ${filesToUpload.length}`);
if (dryRun) console.log(`   Mode:    DRY RUN (no actual upload)\n`);
else console.log();

// Dynamic import AWS SDK v3 (installed as devDependency)
let S3Client, PutObjectCommand, CloudFrontClient, CreateInvalidationCommand;
try {
  ({ S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3"));
  if (shouldInvalidate) {
    ({ CloudFrontClient, CreateInvalidationCommand } = await import("@aws-sdk/client-cloudfront"));
  }
} catch {
  console.error("❌ AWS SDK not found. Install it:");
  console.error("   npm install --save-dev @aws-sdk/client-s3 @aws-sdk/client-cloudfront");
  process.exit(1);
}

const s3 = new S3Client({ region: AWS_REGION });

const uploadedPaths = [];

for (const file of filesToUpload) {
  const fullPath = path.join(distDir, file.local);
  const body = fs.readFileSync(fullPath);
  const hash = crypto.createHash("md5").update(body).digest("base64");

  console.log(`  📄 ${file.local} → s3://${BUCKET_NAME}/${file.s3Key}`);
  console.log(`     Size: ${(body.length / 1024).toFixed(1)} KB | MD5: ${hash.slice(0, 12)}...`);

  if (!dryRun) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.s3Key,
      Body: body,
      ContentType: file.contentType,
      CacheControl: "public, max-age=31536000, immutable",
      ContentMD5: hash,
      Metadata: {
        "build-date": new Date().toISOString(),
        "battery-code": batteryCode,
      },
    }));
    console.log(`     ✅ Uploaded`);
  } else {
    console.log(`     ⏭️  Skipped (dry run)`);
  }

  uploadedPaths.push(`/${file.s3Key}`);
}

// ---------------------------------------------------------------------------
// CloudFront invalidation (optional)
// ---------------------------------------------------------------------------
if (shouldInvalidate && !dryRun) {
  if (!DISTRIBUTION_ID) {
    console.warn("\n⚠️  DISTRIBUTION_ID not set — skipping CloudFront invalidation.");
    console.warn("   Set it in .env to enable cache invalidation.");
  } else {
    console.log(`\n🔄 Invalidating CloudFront cache...`);
    console.log(`   Distribution: ${DISTRIBUTION_ID}`);

    const cf = new CloudFrontClient({ region: "us-east-1" }); // CloudFront is global
    const invalidation = await cf.send(new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `upload-${Date.now()}`,
        Paths: {
          Quantity: uploadedPaths.length,
          Items: uploadedPaths,
        },
      },
    }));

    console.log(`   ✅ Invalidation created: ${invalidation.Invalidation?.Id}`);
    console.log(`   ⏳ Takes 1-2 minutes to propagate globally.`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n✅ Upload complete!`);
console.log(`\n🌐 Pages will be available at:`);

if (process.env.DOMAIN_NAME) {
  console.log(`   https://${process.env.DOMAIN_NAME}/${s3Prefix}/index.html`);
  console.log(`   https://${process.env.DOMAIN_NAME}/${s3Prefix}/instructions-safety.html`);
} else {
  console.log(`   https://<cloudfront-domain>/${s3Prefix}/index.html`);
  console.log(`   https://<cloudfront-domain>/${s3Prefix}/instructions-safety.html`);
  console.log(`\n   (CloudFront domain is in CDK deploy output: BatteryStaticHosting.DistributionDomainName)`);
}
