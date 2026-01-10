import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tplPath = path.join(root, "index.template.html");
const dataPath = path.join(root, "data", "page.json");
const distDir = path.join(root, "dist");

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

const tpl = fs.readFileSync(tplPath, "utf8");
const data = fs.readFileSync(dataPath, "utf8");

const injected = tpl.replace(
  /<script id="__PAGE_DATA__" type="application\/json"><\/script>/,
  `<script id="__PAGE_DATA__" type="application/json">\n${data}\n</script>`
);

ensureDir(distDir);
fs.writeFileSync(path.join(distDir, "index.html"), injected, "utf8");

// Copy assets
ensureDir(path.join(distDir, "assets"));
for (const f of ["styles.css", "app.js", "logo.svg"]) {
  fs.copyFileSync(path.join(root, "assets", f), path.join(distDir, "assets", f));
}

console.log("Built dist/index.html with embedded JSON ✅");
