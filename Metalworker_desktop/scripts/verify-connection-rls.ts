// scripts/verify-connection-rls.ts
//
// Proves the SECURITY model of migration 0013 from OUTSIDE, with no credentials.
//
// This needs no admin login, which is the point: every check here is an assertion
// that an UNAUTHENTENTATED caller is refused. Run it any time:
//
//   npx tsx scripts/verify-connection-rls.ts      (or: node --experimental-strip-types)
//
// It is deliberately separate from the authenticated scenario script
// (`verify-connections-live.ts`), which does need a login.
//
// WHAT IT ASSERTS
//   1. anon cannot SELECT the link table            (ACL revoke + RLS)
//   2. anon cannot INSERT a link row                (no INSERT grant — writes are RPC-only)
//   3. anon cannot UPDATE or DELETE a link row      (same)
//   4. anon calling link_bill_jobs is refused       (42501, inside the function)
//   5. anon calling unlink_bill_jobs is refused     (42501)
//   6. anon calling unlink_job_bill_links refused   (42501)
//   7. anon calling the read functions gets NOTHING (gate in WHERE, not an error)
//   8. the functions exist with the signatures the client calls
//
// A failure here is a security bug, not a flaky test.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

/* The anon key is a PUBLIC key — it ships in the browser bundle. Reading it from
   .env is the same value the app uses, and proves the point: a key nobody can
   hide still must not be able to write a relationship. */
const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const url = env.match(/VITE_SUPABASE_URL\s*=\s*(.+)/)?.[1]?.trim();
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)?.[1]?.trim();
if (!url || !anonKey) {
  console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env first.");
  process.exit(2);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok || !detail ? "" : `\n        ${detail}`}`);
};

/* A well-formed but non-existent uuid, so a refusal can only be about WHO is asking
   and never about the ids being wrong. */
const NO_SUCH_ID = "00000000-0000-0000-0000-000000000000";
const JOB_IDS = [NO_SUCH_ID];

console.log("\nBill ↔ Job connections — unauthenticated access must be refused\n");

// 1 ─────────────────────────────────────────────────────────────────────────────
{
  const { data, error } = await supabase
    .from("bill_job_connections")
    .select("bill_id, job_id")
    .limit(5);
  check(
    (data ?? []).length === 0,
    "anon cannot read the link table",
    `got ${(data ?? []).length} row(s)${error ? `, error: ${error.message}` : ""}`
  );
}

// 2, 3 ───────────────────────────────────────────────────────────────────────────
{
  const insert = await supabase
    .from("bill_job_connections")
    .insert({ bill_id: NO_SUCH_ID, job_id: NO_SUCH_ID });
  check(
    !!insert.error,
    "anon cannot INSERT a link row directly",
    `the write was ACCEPTED: ${JSON.stringify(insert.data)}`
  );
}
{
  const update = await supabase
    .from("bill_job_connections")
    .update({ created_by: null })
    .eq("bill_id", NO_SUCH_ID);
  check(!!update.error, "anon cannot UPDATE a link row directly");
}
{
  const del = await supabase
    .from("bill_job_connections")
    .delete()
    .eq("bill_id", NO_SUCH_ID);
  check(!!del.error, "anon cannot DELETE a link row directly");
}

// 4, 5, 6 ─────────────────────────────────────────────────────────────────────────
{
  const { error } = await supabase.rpc("link_bill_jobs", {
    p_bill_id: NO_SUCH_ID,
    p_job_ids: JOB_IDS,
  });
  check(
    !!error && error.message.includes("active administrator"),
    "link_bill_jobs refuses an unauthenticated caller",
    error?.message ?? "the call SUCCEEDED"
  );
}
{
  const { error } = await supabase.rpc("unlink_bill_jobs", {
    p_bill_id: NO_SUCH_ID,
    p_job_ids: JOB_IDS,
  });
  check(
    !!error && error.message.includes("active administrator"),
    "unlink_bill_jobs refuses an unauthenticated caller",
    error?.message ?? "the call SUCCEEDED"
  );
}
{
  const { error } = await supabase.rpc("unlink_job_bill_links", {
    p_job_ids: JOB_IDS,
    p_bill_ids: [NO_SUCH_ID],
  });
  check(
    !!error && error.message.includes("active administrator"),
    "unlink_job_bill_links refuses an unauthenticated caller",
    error?.message ?? "the call SUCCEEDED"
  );
}

// 7 ─────────────────────────────────────────────────────────────────────────────
/* The two count functions put the gate in WHERE, so an unauthorised caller gets zero
   rows rather than an error. The three PL/pgSQL readers raise instead. All four are
   checked for the property that matters: no data comes back. */
for (const fn of [
  "get_job_connection_counts",
  "get_bill_connection_counts",
] as const) {
  const arg = fn === "get_job_connection_counts" ? { p_job_ids: JOB_IDS } : { p_bill_ids: [NO_SUCH_ID] };
  const { data, error } = await supabase.rpc(fn, arg);
  check(
    (data ?? []).length === 0,
    `${fn} returns nothing to an unauthenticated caller`,
    `got ${(data ?? []).length} row(s)${error ? `, error: ${error.message}` : ""}`
  );
}
for (const [fn, arg] of [
  ["get_bill_job_connections", { p_bill_id: NO_SUCH_ID }],
  ["get_job_bill_connections", { p_job_ids: JOB_IDS }],
] as const) {
  const { data, error } = await supabase.rpc(fn, arg);
  check(
    (data ?? []).length === 0 && !!error,
    `${fn} returns nothing to an unauthenticated caller`,
    `got ${(data ?? []).length} row(s), error: ${error?.message ?? "none"}`
  );
}

// 8 ─────────────────────────────────────────────────────────────────────────────
/* Every function must EXIST. PostgREST returns 404 for a missing function, so a
   typo in a name fails here rather than as a silent empty list in the UI. */
const EXPECTED: Record<string, string> = {
  link_bill_jobs: "p_bill_id,p_job_ids",
  unlink_bill_jobs: "p_bill_id,p_job_ids",
  unlink_job_bill_links: "p_job_ids,p_bill_ids",
  get_bill_job_connections: "p_bill_id",
  get_job_bill_connections: "p_job_ids",
  get_job_connection_counts: "p_job_ids",
  get_bill_connection_counts: "p_bill_ids",
};
for (const [fn, argList] of Object.entries(EXPECTED)) {
  const args: Record<string, string | string[]> = {};
  for (const name of argList.split(",")) {
    args[name] = name.includes("_ids") ? [NO_SUCH_ID] : NO_SUCH_ID;
  }
  const { error } = await supabase.rpc(fn, args);
  const missing = error?.message.includes("not found") || error?.code === "42883";
  check(!missing, `${fn} exists with the signature the client calls`, error?.message);
}

console.log(
  failed === 0
    ? "\nCONNECTION RLS: all passed. anon can do nothing to bill_job_connections."
    : `\nCONNECTION RLS: ${failed} FAILED — treat that as a security bug.`
);
process.exit(failed === 0 ? 0 : 1);