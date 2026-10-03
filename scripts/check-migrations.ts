import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = path.resolve("supabase/migrations");
const files = readdirSync(dir).filter((name: string) => name.endsWith(".sql")).sort();
if (!files.length) throw new Error("No SQL migrations found");

let allSql = "";
for (const file of files) {
  const sql = readFileSync(path.join(dir, file), "utf8");
  allSql += `\n-- ${file}\n${sql}`;
  let balance = 0;
  for (const char of sql) {
    if (char === "(") balance++;
    if (char === ")") balance--;
    if (balance < 0) throw new Error(`${file} has unbalanced parentheses`);
  }
  if (balance !== 0) throw new Error(`${file} has unbalanced parentheses`);
  if (!/\b(begin|create|alter|insert|comment|grant|revoke|drop)\b/i.test(sql)) {
    throw new Error(`${file} does not appear to contain SQL migration statements`);
  }
  console.log(`migration static syntax-shape check OK: ${file}`);
}

const required = [
  "create table if not exists workspaces",
  "create table if not exists rulesets",
  "create table if not exists settlements",
  "create table if not exists ledger_entries",
  "create table if not exists payout_items",
  "create or replace function royaltyos_append_audit",
  "create or replace function royaltyos_commit_settlement",
  "create or replace function royaltyos_approve_settlement",
  "create or replace function royaltyos_reserve_payout",
  "create or replace function royaltyos_mark_payout_item",
  "create or replace function royaltyos_verify_audit_chain",
  "create or replace function royaltyos_ledger_integrity",
  "enable row level security",
  "trg_immutable_settlement_lines",
  "trg_guard_settlements",
  "trg_guard_rulesets",
];
for (const needle of required) {
  if (!allSql.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Migration set is missing ${needle}`);
}
console.log(`Checked ${files.length} migration file(s). Execute them against Supabase with supabase db push or psql for authoritative PostgreSQL validation.`);
