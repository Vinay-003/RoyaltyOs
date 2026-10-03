#!/usr/bin/env node
/**
 * Release checksum generator.
 *
 * Produces reports/SHA256SUMS-<version>.txt covering the shipped source tree.
 * Replaces the stale hand-maintained root FILE_SHA256SUMS.txt, which drifted
 * every time a file changed and therefore carried no trust.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();
const reportsDir = path.join(root, "reports");
mkdirSync(reportsDir, { recursive: true });

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "reports", ".freebuff"]);
const SKIP_FILES = new Set(["package-lock.json"]);

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    files.push(path.join(dir, entry.name));
  }
}
walk(root);

const rows = files
  .map((file) => {
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return { digest, relative: `./${path.relative(root, file).split(path.sep).join("/")}` };
  })
  .sort((a, b) => a.relative.localeCompare(b.relative));

const header = `# RoyaltyOS ${version} source checksums\n# sha256  path\n`;
const outFile = path.join(reportsDir, `SHA256SUMS-${version}.txt`);
writeFileSync(outFile, header + rows.map((row) => `${row.digest}  ${row.relative}`).join("\n") + "\n");

console.log(`wrote ${path.relative(root, outFile)} (${rows.length} files)`);
void statSync;
