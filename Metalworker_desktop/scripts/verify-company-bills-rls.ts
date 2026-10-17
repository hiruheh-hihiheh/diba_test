import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const url = env.match(/VITE_SUPABASE_URL\s*=\s*(.+)/)?.[1]?.trim();
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)?.[1]?.trim();
if (!url || !anonKey) { console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env first."); process.exit(2); }

const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
let failed = 0;
const check = (ok: boolean, what: string, detail = "") => { if (!ok) failed++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok || !detail ? "" : `\n        ${detail}`}`); };

const NO_ID = "00000000-0000-0000-0000-000000000000";

console.log("\nCompany Bills — unauthenticated access must be refused\n");

for (const table of ["company_bill_folders", "company_bill_documents"]) {
  const r = await supabase.from(table).select("*").limit(5);
  check((r.data ?? []).length === 0, `anon cannot read ${table}`, `got ${(r.data ?? []).length} row(s)`);
  const ins = await supabase.from(table).insert({ name: "x", display_name: "x", original_filename: "x", storage_path: "x" });
  check(!!ins.error, `anon cannot insert into ${table}`);
  const upd = await supabase.from(table).update({ name: "x" }).eq("id", NO_ID);
  check(!!upd.error, `anon cannot update ${table}`);
  const del = await supabase.from(table).delete().eq("id", NO_ID);
  check(!!del.error, `anon cannot delete from ${table}`);
}

console.log(failed === 0 ? "\nCOMPANY BILLS RLS: all passed." : `\nCOMPANY BILLS RLS: ${failed} FAILED.`);
process.exit(failed === 0 ? 0 : 1);
