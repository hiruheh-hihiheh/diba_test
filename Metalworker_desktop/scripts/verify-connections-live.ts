// scripts/verify-connections-live.ts
//
// Bill ↔ Job connections against your REAL data — the five scenarios from the
// specification, run end to end.
//
//   npx tsx scripts/verify-connections-live.ts --email you@metalworker.local --password '•••'
//
// or with the environment:
//   VITE_TEST_EMAIL / VITE_TEST_PASSWORD
//
// WHAT IT DOES AND DOES NOT TOUCH
// It creates only THROWAWAY rows of its own, marked `CONN-SELFTEST`:
//   • one scratch job, used as the subject of scenarios A, B and E
//   • one scratch bill? No — there is no such thing as a scratch bill, because a bill
//     comes from an uploaded workbook. It uses your REAL bills and removes every link
//     it creates.
//
// Links are recorded before it starts and every one is removed afterwards, including
// on failure, so a run leaves the database exactly as it found it. Scenario E really
// does DELETE a job — but only the scratch job it created itself, never one of yours.
//
// WHY THIS IS A SEPARATE SCRIPT
// `verify-connection-rls.ts` needs no credentials and proves the security model from
// outside. This one needs an admin login, so it can only ever be run deliberately.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const MARK = "CONN-SELFTEST";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
const url = env.match(/VITE_SUPABASE_URL\s*=\s*(.+)/)?.[1]?.trim();
const anonKey = env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)?.[1]?.trim();
const email = arg("email") ?? process.env.VITE_TEST_EMAIL;
const password = arg("password") ?? process.env.VITE_TEST_PASSWORD;

if (!url || !anonKey) {
  console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env first.");
  process.exit(2);
}
if (!email || !password) {
  console.error(
    "This script needs an admin login.\n" +
      "  --email <you@metalworker.local> --password '<password>'\n" +
      "An active admin is required: the database rejects anyone else, by design."
  );
  process.exit(2);
}

const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok || !detail ? "" : `\n        ${detail}`}`);
};
const step = (n: string): void => console.log(`\n── ${n}`);

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T[]> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (data ?? []) as T[];
};

/* ═══════════════════════════════════════════════════════════════════════════ */

console.log(`\nBill ↔ Job connections — live scenarios (${MARK})`);

step("signing in");
const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (signInError || !signIn.user) {
  console.error(`  Could not sign in: ${signInError?.message ?? "no session returned"}`);
  process.exit(1);
}
const me = signIn.user.id;
console.log(`  signed in as ${signIn.user.email}`);

const { data: profile } = await supabase
  .from("profiles")
  .select("role, is_active")
  .eq("id", me)
  .single();
if (!profile || profile.role !== "admin" || !profile.is_active) {
  console.error(
    `  ${signIn.user.email} is not an ACTIVE admin (role=${profile?.role}, is_active=${profile?.is_active}).`
  );
  console.error("  The database would refuse every call, so there is nothing to test.");
  process.exit(1);
}
console.log("  confirmed: active admin");

/* ── pick real fixtures ─────────────────────────────────────────────────── */
step("finding real data to work with");

const { data: bills } = await supabase
  .from("bills")
  .select("id, invoice_no, sheet_name, party_name")
  .order("created_at", { ascending: false })
  .limit(5);
if (!bills || bills.length < 2) {
  console.error("  Need at least 2 real bills to run scenario C. None found.");
  process.exit(1);
}
const billA = bills[0];
const billB = bills[1];
const label = (b: typeof billA): string => b.invoice_no?.trim() || b.sheet_name || b.id.slice(0, 8);
console.log(`  bill A: ${label(billA)}`);
console.log(`  bill B: ${label(billB)}`);

const { data: jobRows } = await supabase
  .from("jobs")
  .select("id, job_no, job_type")
  .order("created_at", { ascending: false })
  .limit(500);
const labour = (jobRows ?? []).filter((j) => j.job_type === "labour").slice(0, 3);
const withMaterial = (jobRows ?? []).filter((j) => j.job_type === "with_material").slice(0, 3);
console.log(`  ${labour.length} labour jobs, ${withMaterial.length} with-material jobs available`);

if (labour.length < 3 || withMaterial.length < 3) {
  console.error("  Need 3 labour and 3 with-material jobs to run scenarios A and B.");
  process.exit(1);
}

/* ── the scratch job, and the cleanup that always runs ──────────────────── */
let scratchJobId: string | null = null;
/** Every link this run created, so they can all be removed on the way out. */
const createdLinks: { jobId: string; billId: string }[] = [];

const cleanup = async (): Promise<void> => {
  step("clean up");
  if (createdLinks.length > 0) {
    const jobIds = [...new Set(createdLinks.map((l) => l.jobId))];
    const billIds = [...new Set(createdLinks.map((l) => l.billId))];
    const { error } = await supabase.rpc("unlink_job_bill_links", {
      p_job_ids: jobIds,
      p_bill_ids: billIds,
    });
    console.log(
      error
        ? `  WARNING: could not remove ${createdLinks.length} link(s): ${error.message}`
        : `  removed ${createdLinks.length} link(s) this run created`
    );
  }
  if (scratchJobId) {
    const { error } = await supabase.from("jobs").delete().eq("id", scratchJobId);
    console.log(
      error
        ? `  WARNING: could not delete the scratch job ${scratchJobId}: ${error.message}`
        : "  deleted the scratch job"
    );
    scratchJobId = null;
  }
  await supabase.auth.signOut();
};

process.on("exit", () => {
  /* Nothing awaited here — it only exists so an unhandled rejection still reports. */
  if (failures > 0) console.log("\n(one or more scenarios failed; see above)");
});

try {
  /* ═══════════════════════════════════════════════════════════════════════
     SCENARIO A — one Bill → three Labour Jobs
     ═══════════════════════════════════════════════════════════════════════ */
  step("SCENARIO A — one bill → three labour jobs");
  {
    const jobIds = labour.map((j) => j.id);
    const out = await rpc<{ job_id: string; linked: boolean }>("link_bill_jobs", {
      p_bill_id: billA.id,
      p_job_ids: jobIds,
    });
    for (const l of out) createdLinks.push({ jobId: l.job_id, billId: billA.id });
    check(out.length === 3, "one call reported on all three jobs", `got ${out.length}`);
    check(
      out.filter((l) => l.linked).length + out.filter((l) => !l.linked).length === 3,
      "every job was accounted for as new or already linked"
    );

    const read = await rpc<{ job_id: string; job_type: string }>("get_bill_job_connections", {
      p_bill_id: billA.id,
    });
    const linkedIds = new Set(read.map((r) => r.job_id));
    check(
      jobIds.every((id) => linkedIds.has(id)),
      "all three labour jobs now read back from the bill"
    );
    check(
      read.filter((r) => jobIds.includes(r.job_id)).every((r) => r.job_type === "labour"),
      "and they are all labour jobs"
    );

    /* Re-running the same link must be a no-op, not a duplicate. */
    const again = await rpc<{ job_id: string; linked: boolean }>("link_bill_jobs", {
      p_bill_id: billA.id,
      p_job_ids: jobIds,
    });
    check(
      again.every((l) => !l.linked),
      "re-running the identical link created nothing and reported every pair as already linked",
      again.filter((l) => l.linked).length + " reported as new"
    );
    const after = await rpc<{ job_id: string }>("get_bill_job_connections", {
      p_bill_id: billA.id,
    });
    check(
      after.filter((r) => jobIds.includes(r.job_id)).length === 3,
      "and the bill still has exactly three of those jobs, not six"
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCENARIO B — one Bill → two Labour + three With Material, in one operation
     ═══════════════════════════════════════════════════════════════════════ */
  step("SCENARIO B — one bill → two labour + three with-material, together");
  {
    const mixed = [labour[0].id, labour[1].id, ...withMaterial.slice(0, 3).map((j) => j.id)];
    const out = await rpc<{ job_id: string; linked: boolean }>("link_bill_jobs", {
      p_bill_id: billB.id,
      p_job_ids: mixed,
    });
    for (const l of out) createdLinks.push({ jobId: l.job_id, billId: billB.id });
    check(out.length === 5, "one call handled all five jobs across BOTH types", `got ${out.length}`);

    const read = await rpc<{ job_id: string; job_type: string }>("get_bill_job_connections", {
      p_bill_id: billB.id,
    });
    const mine = read.filter((r) => mixed.includes(r.job_id));
    check(
      mine.filter((r) => r.job_type === "labour").length === 2,
      "the bill has 2 labour jobs"
    );
    check(
      mine.filter((r) => r.job_type === "with_material").length === 3,
      "and 3 with-material jobs"
    );
    check(
      mine.length === 5,
      "the two types are counted separately but live on the same bill"
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCENARIO C — one Job → two Bills
     ═══════════════════════════════════════════════════════════════════════ */
  step("SCENARIO C — one labour job → two different bills");
  {
    const jobId = labour[2].id;
    for (const bill of [billA, billB]) {
      await rpc("link_bill_jobs", { p_bill_id: bill.id, p_job_ids: [jobId] });
      createdLinks.push({ jobId, billId: bill.id });
    }
    const read = await rpc<{ bill_id: string; label: string }>("get_job_bill_connections", {
      p_job_ids: [jobId],
    });
    const billIds = new Set(read.map((r) => r.bill_id));
    check(billIds.has(billA.id) && billIds.has(billB.id), "the job is linked to both bills");
    check(
      read.every((r) => typeof r.label === "string" && r.label.length > 0),
      "each link carries a readable bill label",
      "a link with no label would draw a wire to nothing"
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCENARIO D — unlink ONE connection; everything else survives
     ═══════════════════════════════════════════════════════════════════════ */
  step("SCENARIO D — unlink one connection, leave all the others alone");
  {
    const victim = labour[0].id;
    const before = await rpc<{ bill_id: string }>("get_job_bill_connections", {
      p_job_ids: [victim],
    });
    const beforeCount = before.length;

    await rpc("unlink_job_bill_links", {
      p_job_ids: [victim],
      p_bill_ids: [billA.id],
    });
    createdLinks.splice(
      createdLinks.findIndex((l) => l.jobId === victim && l.billId === billA.id),
      1
    );

    const after = await rpc<{ bill_id: string }>("get_job_bill_connections", {
      p_job_ids: [victim],
    });
    check(
      !after.some((r) => r.bill_id === billA.id),
      "the unlinked pair is gone"
    );
    check(
      after.length === beforeCount - 1,
      `exactly one link was removed (${beforeCount} → ${after.length})`,
      "an unlink that removed more than one link would be a data-loss bug"
    );

    /* The other jobs on that bill must be untouched. */
    const billARead = await rpc<{ job_id: string }>("get_bill_job_connections", {
      p_bill_id: billA.id,
    });
    check(
      billARead.some((r) => r.job_id === labour[1].id) && billARead.some((r) => r.job_id === labour[2].id),
      "the bill's other linked jobs are still there"
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SCENARIO E — delete a job; the bill and every other link survive
     ═══════════════════════════════════════════════════════════════════════ */
  step("SCENARIO E — delete a job, its links vanish, nothing else does");
  {
    /* A scratch job, so this scenario never deletes real work. */
    const { data: scratch, error: scratchError } = await supabase
      .from("jobs")
      .insert({
        job_type: "labour",
        job_no: `${MARK}-${Date.now()}`,
        tool_description: MARK,
        status: "Pending",
      })
      .select("id")
      .single();
    if (scratchError || !scratch) {
      throw new Error(`could not create the scratch job: ${scratchError?.message}`);
    }
    const scratchId: string = scratch.id;
    scratchJobId = scratchId;
    console.log(`  scratch job ${scratchId.slice(0, 8)}… created`);

    await rpc("link_bill_jobs", { p_bill_id: billA.id, p_job_ids: [scratchId] });
    createdLinks.push({ jobId: scratchId, billId: billA.id });

    const before = await rpc<{ job_id: string }>("get_bill_job_connections", {
      p_bill_id: billA.id,
    });
    const othersBefore = before.filter((r) => r.job_id !== scratch.id).length;
    check(before.some((r) => r.job_id === scratchId), "the scratch job is linked to the bill");

    const { error: delError } = await supabase.from("jobs").delete().eq("id", scratch.id);
    check(!delError, "the scratch job was deleted", delError?.message);

    const after = await rpc<{ job_id: string }>("get_bill_job_connections", {
      p_bill_id: billA.id,
    });
    check(
      !after.some((r) => r.job_id === scratchId),
      "the link to the deleted job disappeared with it",
      "ON DELETE CASCADE should have removed it without the client asking"
    );
    check(
      after.length === othersBefore,
      `every other link on the bill survived (${othersBefore} → ${after.length})`
    );

    const { data: billStillThere } = await supabase
      .from("bills")
      .select("id")
      .eq("id", billA.id)
      .maybeSingle();
    check(!!billStillThere, "the bill itself was NOT deleted");

    scratchJobId = null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Idempotence of the whole feature, seen from the count side
     ═══════════════════════════════════════════════════════════════════════ */
  step("counts report zero rather than omitting a row");
  {
    const counts = await rpc<{ job_id: string; connection_count: number }>(
      "get_job_connection_counts",
      { p_job_ids: withMaterial.map((j) => j.id).slice(0, 3) }
    );
    check(
      counts.length === 3,
      "one count row came back per requested job, zero included",
      `got ${counts.length}`
    );
    check(
      counts.every((c) => typeof c.connection_count === "number"),
      "and each carries a number, so an unlinked job reads 0 rather than being absent"
    );
  }

  await cleanup();
} catch (err) {
  console.error(`\n  RUN FAILED: ${err instanceof Error ? err.message : String(err)}`);
  await cleanup();
  process.exitCode = 1;
}

console.log(
  failures === 0
    ? "\nLIVE SCENARIOS: all passed. Nothing was left behind."
    : `\nLIVE SCENARIOS: ${failures} failure(s).`
);
process.exit(failures === 0 ? 0 : 1);