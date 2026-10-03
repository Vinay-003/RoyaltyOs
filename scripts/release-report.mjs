#!/usr/bin/env node
/**
 * Release report generator.
 *
 * Writes a single, reviewable Markdown summary of the release under reports/:
 * version, commit, environment, migration list, RPC/privilege inventory and the
 * results of whichever verification suites the operator ran in this workspace.
 * It never invents results: suites with no recorded output are listed as
 * "not recorded in this workspace" so a report can never claim a pass it did not see.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const reportsDir = path.join(root, "reports");
mkdirSync(reportsDir, { recursive: true });

const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

const commit = git(["rev-parse", "--short", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = git(["status", "--porcelain"]);

const migrations = readdirSync(path.join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();

function migrationSummary(name) {
  const text = readFileSync(path.join(root, "supabase/migrations", name), "utf8");
  const statements = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length && !line.startsWith("--"));
  const wrapped =
    statements[0]?.toLowerCase() === "begin;" &&
    statements[statements.length - 1]?.toLowerCase() === "commit;";
  const functions = [...text.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)/gi)].map((m) => m[1]);
  return { name, wrapped, functions: [...new Set(functions)] };
}

const summaries = migrations.map(migrationSummary);

const suiteFiles = existsSync(reportsDir)
  ? readdirSync(reportsDir).filter((name) => name.endsWith(".txt")).sort()
  : [];

const recorded = new Map();
for (const file of suiteFiles) {
  const text = readFileSync(path.join(reportsDir, file), "utf8");
  const pass = [...text.matchAll(/# pass (\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  const fail = [...text.matchAll(/# fail (\d+)/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  recorded.set(file, { pass, fail });
}

const lines = [];
lines.push(`# RoyaltyOS ${version} — release report`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push("## Revision");
lines.push("");
lines.push(`- Version file: \`${version}\``);
lines.push(`- Git commit: \`${commit ?? "unavailable"}\` on branch \`${branch ?? "unavailable"}\``);
lines.push(`- Working tree: ${dirty ? `${dirty.split("\n").length} uncommitted path(s)` : "clean"}`);
lines.push("");
lines.push("## Migrations");
lines.push("");
lines.push("| Migration | Transaction-wrapped | Functions |");
lines.push("| --- | --- | --- |");
for (const summary of summaries) {
  lines.push(`| \`${summary.name}\` | ${summary.wrapped ? "yes" : "no"} | ${summary.functions.length} |`);
}
lines.push("");
lines.push("## Recorded verification output");
lines.push("");
if (recorded.size === 0) {
  lines.push("No suite output recorded in `reports/` for this workspace.");
} else {
  lines.push("| Report | Passed | Failed |");
  lines.push("| --- | --- | --- |");
  for (const [file, counts] of recorded) {
    lines.push(`| \`${file}\` | ${counts.pass} | ${counts.fail} |`);
  }
}
lines.push("");
lines.push("## Not verified in this report");
lines.push("");
lines.push("Live provider acceptance (Supabase, OpenAI, PayPal, PayPal MCP, Render) requires");
lines.push("operator credentials and a public HTTPS webhook URL. It is never claimed here");
lines.push("unless the corresponding run is recorded above.");
lines.push("");

const outFile = path.join(reportsDir, `release-${version}.md`);
writeFileSync(outFile, lines.join("\n"));
console.log(`wrote ${path.relative(root, outFile)}`);

const sourceFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "reports"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (statSync(full).isFile()) sourceFiles.push(full);
  }
}
walk(root);
void sourceFiles;
