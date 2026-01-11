#!/usr/bin/env node
/**
 * Verify integrity of dist/index.html
 * Usage: node tools/verify.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const htmlPath = path.join(root, "dist", "index.html");
const checksumPath = path.join(root, "dist", "index.html.sha256");
const metadataPath = path.join(root, "dist", "build-metadata.json");

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

console.log("🔍 Verifying file integrity...\n");

// Check if files exist
if (!fs.existsSync(htmlPath)) {
  console.error("❌ index.html not found. Run 'node tools/build.mjs' first.");
  process.exit(1);
}

if (!fs.existsSync(checksumPath)) {
  console.error("❌ index.html.sha256 not found.");
  process.exit(1);
}

// Calculate current checksum
const htmlContent = fs.readFileSync(htmlPath, "utf8");
const currentChecksum = sha256(htmlContent);

// Read expected checksum
const expectedChecksum = fs.readFileSync(checksumPath, "utf8").split(" ")[0];

// Read metadata
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

console.log("File: dist/index.html");
console.log(`Size: ${(htmlContent.length / 1024).toFixed(2)} KB`);
console.log(`Build date: ${metadata.buildDate}`);
console.log(`\nExpected SHA-256: ${expectedChecksum}`);
console.log(`Current  SHA-256: ${currentChecksum}`);

if (currentChecksum === expectedChecksum) {
  console.log("\n✅ VERIFIED - File integrity confirmed!");
  console.log("File has not been modified since build.");
} else {
  console.log("\n❌ FAILED - File has been modified!");
  console.log("The file may be corrupted or tampered with.");
  process.exit(1);
}

// Additional checks
const checks = [
  { name: "DOCTYPE declaration", test: /^<!doctype html>/i.test(htmlContent.trimStart()) },
  { name: "Inline CSS present", test: htmlContent.includes("<style>") },
  { name: "Inline JS present", test: htmlContent.includes("<script>") && htmlContent.includes("function setupTabs()") },
  { name: "Data hardcoded in HTML", test: !htmlContent.includes('id="__PAGE_DATA__"') && htmlContent.includes("ACME-TRIM-01") },
  { name: "SVG logo (data URI)", test: htmlContent.includes("data:image/svg+xml;base64") },
  { name: "No external CSS links", test: !htmlContent.match(/<link[^>]*href="[^"]*\.css"/) },
  { name: "No external JS scripts", test: !htmlContent.match(/<script[^>]*src="[^"]*\.js"/) },
  { name: "No CDN dependencies", test: !htmlContent.includes("cdn.") && !htmlContent.includes("unpkg.") },
  { name: "No data-bind attributes", test: !htmlContent.match(/data-bind="[^"]+"/) },
  { name: "Minimal JS (no data binding)", test: !htmlContent.includes("function loadData()") && !htmlContent.includes("fetch(") },
];

console.log("\n📋 Additional checks:");
let allPassed = true;
for (const check of checks) {
  const status = check.test ? "✅" : "❌";
  console.log(`${status} ${check.name}`);
  if (!check.test) allPassed = false;
}

if (allPassed) {
  console.log("\n🎉 All checks passed! File is ready for long-term archival.");
} else {
  console.log("\n⚠️  Some checks failed. Review the file before deployment.");
  process.exit(1);
}
