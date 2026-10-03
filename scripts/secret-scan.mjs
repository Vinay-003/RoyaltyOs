#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git','dist','node_modules','.supabase','.temp','reports']);
const ignoredFiles = new Set(['.env.example']);
const textExtensions = new Set(['.ts','.tsx','.js','.mjs','.cjs','.json','.md','.yml','.yaml','.sql','.toml','.txt','.html','.css','.example']);
const patterns = [
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'PayPal access token', re: /\bA21AA[A-Za-z0-9_-]{20,}\b/g },
  { name: 'JWT-like token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Supabase service-role assignment', re: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!YOUR_|\$\{|<)[^\s#]{16,}/g },
  { name: 'PayPal secret assignment', re: /PAYPAL_CLIENT_SECRET\s*=\s*(?!YOUR_|\$\{|<)[^\s#]{12,}/g },
  { name: 'OpenAI key assignment', re: /OPENAI_API_KEY\s*=\s*(?!YOUR_|\$\{|<)[^\s#]{12,}/g },
];

const findings = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(full); continue; }
    if (ignoredFiles.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(ext) && !['Dockerfile','VERSION','.gitignore','.dockerignore'].includes(entry.name)) continue;
    const size = (await stat(full)).size;
    if (size > 2_000_000) continue;
    const text = await readFile(full, 'utf8');
    for (const pattern of patterns) {
      pattern.re.lastIndex = 0;
      if (pattern.re.test(text)) findings.push(`${path.relative(root,full)}: ${pattern.name}`);
    }
  }
}
await walk(root);
if (findings.length) {
  console.error('Potential committed secret(s) detected:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log('secret scan OK: no obvious committed credential patterns found');
