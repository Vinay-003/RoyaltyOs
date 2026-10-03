#!/usr/bin/env node
/**
 * One-off maintenance helper: splits the monolithic apps/web/public/app.js into
 * ES modules under apps/web/public/js/. Kept in the repository so the split is
 * reproducible and reviewable. Idempotent: refuses to run on an already-split file.
 *
 * Uses the TypeScript parser (already a devDependency) instead of ad-hoc string
 * handling, so words inside strings, template literals and comments can never
 * produce a bogus import, and every declaration is classified from a real AST.
 * Fails loudly rather than emitting a module it does not understand, and
 * validates afterwards that every generated import resolves to a real export.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("apps/web/public");
const source = path.join(root, "app.js");
const jsDir = path.join(root, "js");
const pagesDir = path.join(jsDir, "pages");

const text = readFileSync(source, "utf8");
if (text.includes('from "./js/')) {
  console.log("app.js is already split; nothing to do.");
  process.exit(0);
}

/** module -> identifiers exported by it */
const registry = {
  utils: ["$", "$$", "app", "toastEl", "toast", "esc", "money", "statusBadge", "path", "hero", "needProject"],
  state: ["state", "clearSession"],
  api: ["api", "withStepUp"],
  nav: ["navItems", "shell"],
  login: ["loginView", "loadMe"],
  router: ["navTo", "render"],
  dashboard: ["overview"],
  insights: ["insights"],
  contracts: ["contracts"],
  "rule-graph": ["ruleGraph"],
  simulator: ["simulator"],
  invoices: ["invoices"],
  settlements: ["settlements"],
  payouts: ["payouts"],
  royalties: ["royalties"],
  recipients: ["recipients"],
  team: ["team"],
  notifications: ["notificationsView"],
  "paypal-ai": ["paypalAi"],
  audit: ["audit"],
};

const CORE_MODULES = ["utils", "state", "api", "nav", "login", "router"];
const pageModules = Object.keys(registry).filter((module) => !CORE_MODULES.includes(module));
const owner = new Map();
for (const [module, identifiers] of Object.entries(registry)) for (const id of identifiers) owner.set(id, module);

const sourceFile = ts.createSourceFile("app.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const parseDiagnostics = sourceFile.parseDiagnostics ?? [];
if (parseDiagnostics.length > 0) {
  const first = parseDiagnostics[0];
  throw new Error(`app.js does not parse: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
}

/** Identifiers referenced from code position (property names excluded). */
function referencedIdentifiers(node) {
  const found = new Set();
  const visit = (current) => {
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
        (ts.isPropertyAssignment(parent) && parent.name === current) ||
        (ts.isMethodDeclaration(parent) && parent.name === current) ||
        (ts.isPropertyDeclaration(parent) && parent.name === current) ||
        (ts.isBindingElement(parent) && parent.propertyName === current) ||
        (ts.isQualifiedName(parent) && parent.right === current) ||
        ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent)) &&
          parent.name === current);
      if (!isPropertyName) found.add(current.text);
      return;
    }
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/** Name for a top-level declaration statement, or null for a plain statement. */
function declarationName(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) return statement.name.text;
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0];
    if (declaration && ts.isIdentifier(declaration.name)) return declaration.name.text;
  }
  return null;
}

const topLevelStatements = [];
const grouped = new Map();
const declared = new Set();

for (const statement of sourceFile.statements) {
  const statementText = text.slice(statement.getStart(sourceFile), statement.end).trim();
  if (!statementText) continue;
  const name = declarationName(statement);
  if (!name) {
    topLevelStatements.push(statementText);
    continue;
  }
  const module = owner.get(name);
  if (!module) throw new Error(`no module mapping for top-level declaration: ${name}`);
  if (declared.has(name)) throw new Error(`duplicate top-level declaration: ${name}`);
  declared.add(name);
  if (!grouped.has(module)) grouped.set(module, []);
  grouped.get(module).push({ text: statementText, name, identifiers: referencedIdentifiers(statement) });
}

function importSpecifier(fromModule, toModule) {
  const fromIsPage = pageModules.includes(fromModule) || fromModule === "login";
  const toIsPage = pageModules.includes(toModule) || toModule === "login";
  if (fromIsPage && !toIsPage) return `../${toModule}.js`;
  if (!fromIsPage && toIsPage) return `./pages/${toModule}.js`;
  return `./${toModule}.js`;
}

function modulePath(module) {
  return pageModules.includes(module) || module === "login"
    ? path.join(pagesDir, `${module}.js`)
    : path.join(jsDir, `${module}.js`);
}

function buildModule(module, entries) {
  const used = new Set();
  for (const entry of entries) {
    for (const name of entry.identifiers) {
      if (name === entry.name) continue;
      if (!owner.has(name)) continue;
      used.add(name);
    }
  }
  const byModule = new Map();
  for (const name of used) {
    const ownerModule = owner.get(name);
    if (ownerModule === module) continue;
    if (!byModule.has(ownerModule)) byModule.set(ownerModule, new Set());
    byModule.get(ownerModule).add(name);
  }
  const importLines = [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ownerModule, names]) => {
      const list = [...names].sort().join(", ");
      return `import { ${list} } from "${importSpecifier(module, ownerModule)}";`;
    });

  const body = entries
    .map(({ text: statementText }) => statementText.replace(/^(async\s+function|function|const)\s/, "export $1 "))
    .join("\n\n");

  return `${importLines.join("\n")}${importLines.length ? "\n\n" : ""}${body}\n`;
}

mkdirSync(pagesDir, { recursive: true });
const emitted = [];
for (const [module, entries] of grouped) {
  writeFileSync(modulePath(module), buildModule(module, entries));
  emitted.push(path.relative(root, modulePath(module)));
}

const hasRenderCall = topLevelStatements.some((statement) => statement.startsWith("render();"));
const entry = `import { navTo, render } from "./js/router.js";

${topLevelStatements.join("\n\n")}${hasRenderCall ? "" : "\n\nrender();"}
`;
writeFileSync(source, entry);
emitted.push("app.js");

// ---- validation -----------------------------------------------------------
const exportsByModule = new Map(
  Object.entries(registry).map(([module, names]) => [module, new Set(names)]),
);
const importPattern = /import \{ ([^}]+) \} from "([^"]+)";/g;

for (const [module] of grouped) {
  const file = modulePath(module);
  const moduleText = readFileSync(file, "utf8");
  const parsed = ts.createSourceFile(file, moduleText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if ((parsed.parseDiagnostics ?? []).length > 0) {
    throw new Error(`generated module does not parse: ${file}`);
  }
  for (const match of moduleText.matchAll(importPattern)) {
    const names = match[1].split(",").map((name) => name.trim());
    const targetFile = path.resolve(path.dirname(file), match[2]);
    const targetModule = Object.keys(registry).find((name) => targetFile.endsWith(`/${name}.js`));
    if (!targetModule) throw new Error(`import target not in registry: ${match[2]} (from ${file})`);
    for (const name of names) {
      if (!exportsByModule.get(targetModule).has(name)) {
        throw new Error(`${file} imports ${name} but ${targetModule} does not export it`);
      }
    }
  }
  // Every registry identifier used in this module must be declared or imported here.
  const imported = new Set();
  for (const match of moduleText.matchAll(importPattern)) {
    for (const name of match[1].split(",")) imported.add(name.trim());
  }
  const moduleOwned = new Set(registry[module]);
  const usedHere = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        (ts.isQualifiedName(parent) && parent.right === node) ||
        ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent)) &&
          parent.name === node);
      if (!isPropertyName && owner.has(node.text)) usedHere.add(node.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(parsed, visit);
  for (const name of usedHere) {
    if (moduleOwned.has(name)) continue;
    if (!imported.has(name)) {
      throw new Error(`${file} uses ${name} but does not import it`);
    }
  }
}

console.log(`emitted ${emitted.length} files:`);
console.log(emitted.sort().join("\n"));
