// supabase/functions/_selftest/test-regeneration.ts
//
// THE PDF REGENERATION JOB, END TO END, AGAINST AN IN-MEMORY DATABASE AND BUCKET.
//
// What it proves, in the order the user asked for:
//   1. chunked aggregate assembly is byte-identical to a single-pass render, so a
//      regenerated combined PDF contains every bill and every line, in order;
//   2. workbooks are processed strictly one at a time, each through prepare →
//      bills → render → assemble → publish → cleanup, then standalone bills;
//   3. a job survives interruption: a reload, a killed worker, transient errors;
//   4. duplicate jobs and concurrent invocations cannot double-count anything;
//   5. missing or corrupt chunks are rebuilt (and only those), and a chunk that
//      keeps failing ends the workbook instead of looping;
//   6. on any failure the previously active PDFs stay referenced and on disk;
//   7. dataset changes mid-job never publish an aggregate with missing or extra bills;
//   8. large workbooks complete, and an over-cap one fails clearly;
//   9. the completion summary never claims success when something failed.
//
// No network, no Supabase: `regeneration-fakes.ts` implements the same contract
// as the PostgREST queries in `regenerate-bill-pdfs/index.ts`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CHUNK_SIZE,
  LEASE_MS,
  MAX_TRANSIENT_RETRIES,
  MAX_UNIT_ATTEMPTS,
  cancelJob,
  jobStatus,
  startJob,
  stepJob,
  type RegenerationDeps,
  type RegenerationView,
} from "../regenerate-bill-pdfs/engine.ts";
import { FakeWorld, WorkerKilled, fixtureBills, REPO } from "./regeneration-fakes.ts";
import {
  billFooterContent,
  billDocumentTitle,
  renderBillDocument,
  renderBillPagesFragment,
} from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { COPY_LABEL, COPY_ORDER, type CopyKind } from "../process-bill-upload/_shared/parseBill.ts";
import { profileForBill, profileFromRow } from "../process-bill-upload/_shared/businessProfile.ts";
import { PdfPageStreamWriter, readPdfStructure, PdfStructureError } from "../process-bill-upload/_shared/pdf.ts";
import * as adminModel from "../../../src/services/regenerationModel.ts";

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  — ${detail}` : ""}`);
};
const section = (title: string): void => console.log(`\n${title}`);

const bill301 = await fixtureBills("BILL 301 TO.xlsx");
const sample = await fixtureBills("SAMPLE.xlsx");
const sanitized = await fixtureBills("test-bills-sanitized.xlsx");

/* ──────────────────────────────────────────────
   Drivers
   ────────────────────────────────────────────── */

interface DriveResult {
  final: RegenerationView;
  views: RegenerationView[];
  calls: number;
  kills: number;
  busy: number;
  retries: number;
}

/** Step a job to a terminal state the way the client does: honour busy and retry hints. */
async function drive(world: FakeWorld, deps: RegenerationDeps, jobId: string, maxCalls = 20_000): Promise<DriveResult> {
  const views: RegenerationView[] = [];
  let calls = 0;
  let kills = 0;
  let busy = 0;
  let retries = 0;
  for (;;) {
    if (++calls > maxCalls) throw new Error(`job ${jobId} did not terminate within ${maxCalls} calls`);
    let res;
    try {
      res = await stepJob(deps, jobId);
    } catch (err) {
      if (err instanceof WorkerKilled) {
        kills++;
        world.clock += 1_000;
        continue;
      }
      throw err;
    }
    const view = res.job as RegenerationView;
    views.push(view);
    if (view.status !== "running") return { final: view, views, calls, kills, busy, retries };
    if (res.busy) {
      busy++;
      world.clock += LEASE_MS + 1;
    } else if (res.retry_after_ms) {
      retries++;
      world.clock += res.retry_after_ms;
    } else {
      world.clock += 10;
    }
  }
}

/** Every eligible workbook plus standalone bills: the explicit "regenerate everything" scope. */
function everything(world: FakeWorld): { upload_ids: string[]; include_standalone: boolean } {
  const ids = [...world.uploads.values()]
    .filter((u) => u.creation_source === "workbook" && u.status === "completed")
    .map((u) => u.id);
  return { upload_ids: ids, include_standalone: true };
}

async function runFresh(world: FakeWorld, deps = world.deps(), scope: unknown = everything(world)): Promise<DriveResult & { jobId: string }> {
  const started = await startJob(deps, "admin-1", scope);
  const jobId = (started.job as RegenerationView).job_id;
  return { jobId, ...(await drive(world, deps, jobId)) };
}

function profileOf(world: FakeWorld) {
  return profileFromRow(world.profileRow);
}

/** What the aggregate for `uploadId` must be, rendered in one pass from the records. */
function expectedAggregate(world: FakeWorld, uploadId: string, kind: CopyKind): Uint8Array {
  const rows = [...world.bills.values()]
    .filter((b) => b.bill_upload_id === uploadId && b.status === "finalized")
    .sort((a, b) => Number(a.sheet_order) - Number(b.sheet_order));
  const profile = profileForBill(profileOf(world), profileForBill(profileOf(world), rows[0].business_profile_snapshot).snapshot).profile;
  return renderBillDocument(
    rows.map((r) => billFromRecord({ ...(r as unknown as BillRecord), copy: kind }, world.items.get(r.id) ?? [], COPY_LABEL[kind])),
    COPY_LABEL[kind],
    null,
    profile
  );
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return !!a && a.length === b.length && a.every((x, i) => x === b[i]);
}

const uploadPaths = (world: FakeWorld, id: string) => {
  const u = world.uploads.get(id)!;
  return { original: u.original_pdf_path, duplicate: u.duplicate_pdf_path, triplicate: u.triplicate_pdf_path };
};

const tempFiles = (world: FakeWorld) => [...world.files.keys()].filter((p) => p.includes("/regen-"));

/* ──────────────────────────────────────────────
   1. Chunked assembly is the single-pass document
   ────────────────────────────────────────────── */

section("1. chunked aggregate assembly");
{
  for (const [name, parsed] of [["BILL 301 TO", bill301], ["SAMPLE", sample]] as const) {
    const bills = parsed.map((p) => p.original) as never[];
    for (const kind of COPY_ORDER) {
      const label = COPY_LABEL[kind];
      for (const size of [1, 3, CHUNK_SIZE, 7]) {
        const frags = [];
        for (let i = 0; i < bills.length; i += size) frags.push(renderBillPagesFragment(bills.slice(i, i + size), label, null));
        const total = frags.reduce((s, f) => s + f.owners.length, 0);
        const w = new PdfPageStreamWriter({ title: billDocumentTitle(label, bills.length, frags[0].firstInvoiceNo), subject: frags[0].subject }, total);
        let page = 0;
        for (const f of frags) {
          readPdfStructure(f.pdf).contents.forEach((c, i) => w.addPage([c, billFooterContent(label, f.owners[i], page + i, total)]));
          page += f.owners.length;
        }
        const whole = renderBillDocument(bills, label, null, null);
        if (size === CHUNK_SIZE || kind === "original") {
          check(sameBytes(w.finish(), whole), `${name} ${kind}, chunks of ${size}: byte-identical to renderBillDocument (${total} pages, global "Page n of ${total}" footers)`);
        }
      }
    }
  }

  const good = renderBillDocument(bill301.slice(0, 3).map((p) => p.original) as never[], "ORIGINAL", null, null);
  const truncated = good.slice(0, good.length - 40);
  const flipped = good.slice();
  flipped[Math.floor(flipped.length / 2)] ^= 0x20;
  const shifted = new Uint8Array([...good.slice(0, 200), 0x20, ...good.slice(200)]);
  const rejects = (b: Uint8Array) => {
    try {
      readPdfStructure(b);
      return false;
    } catch (e) {
      return e instanceof PdfStructureError;
    }
  };
  check(readPdfStructure(good).pageCount >= 3, "a rendered PDF validates and reports its pages");
  check(rejects(truncated), "a truncated PDF is rejected");
  check(rejects(shifted), "a PDF with shifted object offsets is rejected");
  check(rejects(new TextEncoder().encode("not a pdf at all, just some bytes that are long enough to be checked ok")), "a non-PDF is rejected");
  // A single flipped byte inside a content stream can still be structurally valid;
  // the CRC stored with each chunk is what catches that (section 5).
  void flipped;
}

/* ──────────────────────────────────────────────
   2. Happy path, sequencing and stage order
   ────────────────────────────────────────────── */

section("2. full run: one workbook at a time, then standalone bills");
{
  const world = new FakeWorld();
  world.profileRow = { company_name: "Fixture Works", payment_days: 30 };
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  world.clock += 1;
  const b = world.addWorkbook("SAMPLE.xlsx", sample);
  const s1 = world.addManualBill(sanitized[0]);
  const s2 = world.addManualBill(sample[0]);
  const oldA = uploadPaths(world, a.uploadId);
  const oldBillPaths = new Map([...world.bills.values()].map((x) => [x.id, [x.original_pdf_path, x.duplicate_pdf_path, x.triplicate_pdf_path]]));

  const run = await runFresh(world);
  const f = run.final;
  check(f.status === "completed" && f.outcome === "succeeded", "job completes with outcome succeeded", `${f.status}/${f.outcome}`);
  check(f.counters.bills_succeeded === 24 && f.counters.bills_failed === 0, "24 bills regenerated (20 + 2 workbook, 2 standalone)", JSON.stringify(f.counters));
  check(f.counters.aggregates_succeeded === 2 && f.counters.aggregates_failed === 0, "2 workbook aggregates regenerated");
  check(f.standalone.total === 2 && f.standalone.succeeded === 2, "standalone bills are included, not skipped or grouped", JSON.stringify(f.standalone));

  for (const wbk of [a, b]) {
    const paths = uploadPaths(world, wbk.uploadId);
    for (const kind of COPY_ORDER) {
      const p = paths[kind] as string;
      check(/_v\d+_/.test(p) && sameBytes(world.files.get(p), expectedAggregate(world, wbk.uploadId, kind)),
        `${world.uploads.get(wbk.uploadId)!.original_filename} ${kind}: new aggregate exactly equals a single-pass render of every bill`);
    }
  }
  check(COPY_ORDER.every((k) => !world.files.has(oldA[k] as string)), "superseded aggregates are removed after publish");
  check(tempFiles(world).length === 0, "no temporary chunk files remain");

  let billsOk = true;
  for (const bill of world.bills.values()) {
    const paths = [bill.original_pdf_path, bill.duplicate_pdf_path, bill.triplicate_pdf_path] as string[];
    const valid = paths.every((p) => {
      const bytes = world.files.get(p);
      return !!bytes && readPdfStructure(bytes).pageCount >= 1;
    });
    const oldGone = (oldBillPaths.get(bill.id) as string[]).every((p) => !world.files.has(p));
    if (bill.pdf_version !== 2 || !valid || !oldGone) billsOk = false;
  }
  check(billsOk, "every bill is at pdf_version 2 with three valid PDFs, and its old PDFs are removed");

  // Sequencing: every file operation for workbook A precedes every one for B, and
  // A's aggregate is published before B is touched; standalone bills come last.
  const firstOf = (prefix: string) => world.ops.findIndex((o) => o.target.startsWith(prefix));
  const lastOf = (prefix: string) => world.ops.map((o) => o.target.startsWith(prefix)).lastIndexOf(true);
  const publishA = world.ops.findIndex((o) => o.op === "repoint-upload" && o.target === a.uploadId);
  check(lastOf(`${a.uploadId}/`) < firstOf(`${b.uploadId}/`), "workbook A is completely finished before workbook B starts");
  check(publishA >= 0 && publishA < firstOf(`${b.uploadId}/`), "workbook A's aggregates are published before workbook B starts");
  const standaloneFirst = Math.min(...[s1, s2].map((id) => world.ops.findIndex((o) => o.target === id || o.target.includes(`/${id}_`))));
  check(standaloneFirst > lastOf(`${b.uploadId}/`), "standalone bills are processed after every workbook");

  // Stage order observed by the client, per workbook.
  const order = ["workbook_prepare", "workbook_bills", "aggregate_render", "aggregate_assemble", "aggregate_publish", "workbook_cleanup"];
  let monotonic = true;
  let lastWb = 0;
  let lastIdx = -1;
  const seen = new Set<string>();
  for (const v of run.views) {
    if (!v.current_workbook) continue;
    const idx = order.indexOf(v.stage);
    seen.add(v.stage);
    if (v.current_workbook.position !== lastWb) {
      if (v.current_workbook.position < lastWb) monotonic = false;
      lastWb = v.current_workbook.position;
      lastIdx = idx;
      continue;
    }
    if (idx < lastIdx) monotonic = false;
    lastIdx = idx;
  }
  check(monotonic, "stages only move forward within a workbook, and workbook positions only increase");
  check(["workbook_bills", "aggregate_render", "aggregate_assemble", "aggregate_publish"].every((s) => seen.has(s)), "the client observes every stage");
  const neverEarly = run.views.every((v) => v.workbooks_finished <= (v.current_workbook ? v.current_workbook.position - 1 : v.workbooks_total));
  check(neverEarly, "a workbook is never counted finished before its result is recorded");
  const loadsBounded = world.loadBillsCalls.every((ids) => ids.length <= CHUNK_SIZE);
  check(loadsBounded, `no request loads more than ${CHUNK_SIZE} bill records`);
}

/* ──────────────────────────────────────────────
   3. Duplicate jobs, concurrent invocations, terminal jobs
   ────────────────────────────────────────────── */

section("3. one job, one worker at a time");
{
  const world = new FakeWorld();
  world.addWorkbook("SAMPLE.xlsx", sample);
  const deps = world.deps();
  const [first, second] = await Promise.all([startJob(deps, "u1", everything(world)), startJob(deps, "u2", everything(world))]);
  check(first.job?.job_id === second.job?.job_id, "two simultaneous starts return the same job");
  check(!!first.attached !== !!second.attached, "exactly one of them created it");
  const again = await startJob(deps, "u1", everything(world));
  check(again.attached === true && again.job?.job_id === first.job?.job_id, "a later start (double click, other tab) attaches instead of creating");
  check([...world.jobs.values()].filter((j) => j.status === "running").length === 1, "only one running job exists");

  const jobId = first.job!.job_id;
  // Two invocations racing on every step must still count every bill once.
  let done = false;
  let guard = 0;
  while (!done && guard++ < 2_000) {
    const [r1, r2] = await Promise.all([stepJob(deps, jobId), stepJob(world.deps(), jobId)]);
    done = r1.job?.status !== "running" || r2.job?.status !== "running";
    if (r1.busy && r2.busy) world.clock += LEASE_MS + 1;
    world.clock += 10;
  }
  const final = (await jobStatus(deps, jobId)).job!;
  check(final.status === "completed" && final.counters.bills_processed === 2 && final.counters.bills_succeeded === 2,
    "concurrent steps never double-count", JSON.stringify(final.counters));
  check(world.bills.size === 2 && [...world.bills.values()].every((x) => x.pdf_version === 2), "each bill is repointed exactly once");

  const after = await stepJob(deps, jobId);
  check(after.job?.status === "completed" && after.units === 0, "stepping a completed job does nothing and does not reopen it");
  const next = await startJob(deps, "u1", everything(world));
  check(next.attached === false && next.job?.job_id !== jobId, "a new start after completion creates a new job");

  // A job left behind by the previous function version cannot block a new start.
  const legacy = new FakeWorld();
  legacy.jobs.set("old", { ...structuredClone(world.jobs.get(jobId)!), id: "old", status: "running", cursor: '{"upload_id":"x","stage":"merge"}', lease_until: null });
  const fresh = await startJob(legacy.deps(), "u1", { upload_ids: [], include_standalone: true });
  check(legacy.jobs.get("old")!.status === "failed" && fresh.attached === false, "a running job from the old regenerator is closed and a new one starts");
}

/* ──────────────────────────────────────────────
   4. Interruptions: reload, killed worker, transient errors
   ────────────────────────────────────────────── */

section("4. resuming after interruptions");
{
  // Reload: a fresh client reconnects through status and finishes the same job.
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const deps = world.deps();
  const started = await startJob(deps, "u1", everything(world));
  const jobId = started.job!.job_id;
  for (let i = 0; i < 40; i++) {
    await stepJob(deps, jobId);
    world.clock += 10;
  }
  const mid = (await jobStatus(world.deps(), null)).job!;
  check(mid.status === "running" && mid.job_id === jobId && !!mid.current_workbook, "after a reload, status returns the running job and its position");
  const progressBefore = mid.counters.bills_processed;
  const resumed = await drive(world, world.deps(), jobId);
  check(resumed.final.outcome === "succeeded" && resumed.final.counters.bills_succeeded === 20 && progressBefore > 0,
    "the resumed job finishes from where it was, without redoing or skipping bills", JSON.stringify(resumed.final.counters));
  check(COPY_ORDER.every((k) => sameBytes(world.files.get(uploadPaths(world, a.uploadId)[k] as string), expectedAggregate(world, a.uploadId, k))),
    "the resumed workbook's aggregates are complete");
}
{
  // The worker is killed after doing a unit's work but before committing it.
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  // Each of these units is killed once, after its side effects and before its commit.
  const killed = new Set<string>();
  world.killOnCommit = (key) => {
    const hit = [":chunk1:duplicate", ":bill3:triplicate", ":publish", ":assemble:original"].find((k) => key.includes(k));
    if (!hit || killed.has(hit)) return false;
    killed.add(hit);
    return true;
  };
  const run = await runFresh(world);
  check(run.kills === 4 && run.final.outcome === "succeeded", "four killed invocations (bill commit, chunk, assemble, publish) are recovered", `${run.kills} kills, ${run.final.outcome}`);
  check(run.final.counters.bills_succeeded === 20 && run.final.counters.bills_processed === 20 && run.final.counters.aggregates_succeeded === 1,
    "counters are exact after re-running killed units", JSON.stringify(run.final.counters));
  check([...world.bills.values()].every((x) => x.pdf_version === 2), "a bill whose commit was interrupted is not bumped twice");
  check(COPY_ORDER.every((k) => sameBytes(world.files.get(uploadPaths(world, a.uploadId)[k] as string), expectedAggregate(world, a.uploadId, k))),
    "the aggregate published after a killed publish is complete");
  check(tempFiles(world).length === 0, "no temporary files are left behind");
}
{
  // A unit that kills the worker every time is abandoned after MAX_UNIT_ATTEMPTS.
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const b = world.addWorkbook("SAMPLE.xlsx", sample);
  const oldA = uploadPaths(world, a.uploadId);
  // Dies on every real attempt; the abandonment that follows is a cheap bookkeeping
  // unit and is allowed to finish.
  world.killOnCommit = (key, attempts) => key.startsWith("wb0:assemble:original") && attempts <= MAX_UNIT_ATTEMPTS;
  const run = await runFresh(world);
  const ra = run.final.workbook_results.find((r) => r.upload_id === a.uploadId)!;
  check(run.kills === MAX_UNIT_ATTEMPTS, `a unit that always dies is tried ${MAX_UNIT_ATTEMPTS} times, not forever`, `${run.kills}`);
  check(ra.status === "failed" && ra.code === "repeated_failure" && /stopped this step/.test(ra.message ?? ""), "the workbook is failed with an explanation", JSON.stringify(ra));
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA) && COPY_ORDER.every((k) => world.files.has(oldA[k] as string)),
    "the failed workbook's active aggregates are untouched and still on disk");
  check(world.uploads.get(b.uploadId)!.original_pdf_path?.includes("_v") === true, "the job moves on and the next workbook succeeds");
  check(run.final.outcome === "partial" && run.final.counters.aggregates_failed === 1 && run.final.counters.aggregates_succeeded === 1,
    "the job reports partial success with exact counts", `${run.final.outcome} ${JSON.stringify(run.final.counters)}`);
  check(tempFiles(world).length === 0, "the failed workbook's temporary files are removed");
}
{
  // The publish lands in the database, then the worker dies before the job records
  // it - every time, until the unit is abandoned. Cleanup must believe the database:
  // the new aggregates are live and must not be deleted.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample);
  const oldA = uploadPaths(world, a.uploadId);
  world.killOnCommit = (key, attempts) => key.startsWith("wb0:publish") && attempts <= MAX_UNIT_ATTEMPTS;
  const run = await runFresh(world);
  const live = uploadPaths(world, a.uploadId);
  check(run.kills === MAX_UNIT_ATTEMPTS, "the publish commit is killed every time until the unit is abandoned", `${run.kills}`);
  check(COPY_ORDER.every((k) => sameBytes(world.files.get(live[k] as string), expectedAggregate(world, a.uploadId, k))),
    "the aggregates the database now references still exist and are complete");
  check(COPY_ORDER.every((k) => !world.files.has(oldA[k] as string)) && tempFiles(world).length === 0,
    "the superseded aggregates and chunks are cleaned up as for a normal publish");
  check(run.final.workbook_results[0].status === "succeeded" && run.final.counters.aggregates_succeeded === 1,
    "the workbook is reported as published, because it was", JSON.stringify(run.final.workbook_results[0]));
}
{
  // Transient errors are retried with backoff and do not change the result.
  const world = new FakeWorld();
  world.addWorkbook("SAMPLE.xlsx", sample);
  world.transient.set("upload", 2);
  world.transient.set("loadLineItems", 1);
  world.transient.set("download", 2);
  const run = await runFresh(world);
  check(run.retries === 5 && run.final.outcome === "succeeded" && run.final.counters.bills_succeeded === 2,
    "five transient failures are retried and the job still succeeds exactly once per bill", `${run.retries} retries, ${JSON.stringify(run.final.counters)}`);
}
{
  // A dependency that never comes back fails its unit permanently, then moves on.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample);
  const oldA = uploadPaths(world, a.uploadId);
  world.alwaysFail.add("updateUploadAggregates");
  const run = await runFresh(world);
  const ra = run.final.workbook_results[0];
  check(run.calls < 200 && run.final.status === "completed" && run.retries === MAX_TRANSIENT_RETRIES,
    `a permanently failing publish is retried ${MAX_TRANSIENT_RETRIES} times with backoff, then ends instead of looping`, `${run.calls} calls, ${run.retries} retries`);
  check(/kept failing after/.test(run.final.workbook_results[0].message ?? ""), "its reason carries the last error");
  check(ra.status === "failed" && ra.aggregate === "failed" && ra.bills_succeeded === 2, "bills succeed, the aggregate fails, and the workbook says so", JSON.stringify(ra));
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA), "the database update failure keeps the old aggregate references");
  check(COPY_ORDER.every((k) => world.files.has(oldA[k] as string)) && tempFiles(world).length === 0 && ![...world.files.keys()].some((p) => p.includes("/SAMPLE_v")),
    "old aggregates stay on disk; the unpublished new ones and the chunks are removed");
  check(run.final.counters.aggregates_failed === 1 && run.final.counters.aggregates_processed === 1, "the failure is counted once");
}

/* ──────────────────────────────────────────────
   5. Missing and corrupt chunks
   ────────────────────────────────────────────── */

section("5. chunk recovery");
for (const damage of ["missing", "corrupt", "truncated"] as const) {
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const target = `${a.uploadId}/regen-`;
  let damaged = false;
  // Damage chunk 2 of the duplicate copy once, after the whole set is rendered.
  world.beforeCommit = (key) => {
    if (damaged || !key.endsWith(":chunk3:triplicate")) return;
    const path = [...world.files.keys()].find((p) => p.startsWith(target) && p.endsWith("chunk-0002-duplicate.pdf"));
    if (!path) return;
    damaged = true;
    const bytes = world.files.get(path)!;
    if (damage === "missing") world.files.delete(path);
    else if (damage === "corrupt") {
      const copy = bytes.slice();
      copy[Math.floor(copy.length / 2)] ^= 0x01;
      world.files.set(path, copy);
    } else world.files.set(path, bytes.slice(0, bytes.length - 100));
  };
  const run = await runFresh(world);
  const counts = [...world.uploadCounts.entries()].filter(([p]) => p.startsWith(target));
  const rebuilt = counts.filter(([, n]) => n > 1).map(([p]) => p);
  check(damaged && run.final.outcome === "succeeded", `a ${damage} chunk is detected and the workbook still succeeds`);
  check(rebuilt.length === 1 && rebuilt[0].endsWith("chunk-0002-duplicate.pdf"), `only the ${damage} chunk is re-rendered`, rebuilt.join(","));
  check(sameBytes(world.files.get(uploadPaths(world, a.uploadId).duplicate as string), expectedAggregate(world, a.uploadId, "duplicate")),
    `the repaired duplicate aggregate is complete (no missing or duplicated pages)`);
}
{
  // A chunk that is damaged every time it is written ends the workbook, not the job.
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const b = world.addWorkbook("SAMPLE.xlsx", sample);
  const oldA = uploadPaths(world, a.uploadId);
  world.afterUpload = (path) => {
    if (path.startsWith(`${a.uploadId}/regen-`) && path.endsWith("chunk-0001-original.pdf")) world.files.delete(path);
  };
  const run = await runFresh(world);
  const ra = run.final.workbook_results.find((r) => r.upload_id === a.uploadId)!;
  const writes = world.uploadCounts.get([...world.uploadCounts.keys()].find((p) => p.endsWith("chunk-0001-original.pdf"))!) ?? 0;
  check(ra.status === "failed" && ra.code === "chunk_unrecoverable", "a chunk that keeps disappearing is a terminal workbook failure", JSON.stringify(ra));
  check(writes === 3, "it is rebuilt a bounded number of times (1 + 2 repairs)", `${writes}`);
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA), "the active aggregates are preserved");
  check(run.final.workbook_results.find((r) => r.upload_id === b.uploadId)?.status === "succeeded", "the next workbook is still processed");
}

/* ──────────────────────────────────────────────
   6. Dataset changes while the job runs
   ────────────────────────────────────────────── */

section("6. dataset changes mid-job");
{
  // A bill deleted while chunks are rendering.
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const oldA = uploadPaths(world, a.uploadId);
  let removed = false;
  world.beforeCommit = (key) => {
    if (!removed && key.includes(":chunk1:")) {
      removed = true;
      world.bills.delete(a.billIds[12]);
    }
  };
  const run = await runFresh(world);
  const ra = run.final.workbook_results[0];
  check(ra.status === "failed" && ra.code === "workbook_changed", "a bill deleted mid-render fails the aggregate instead of publishing it without that bill", JSON.stringify(ra));
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA), "old aggregate references are kept");
}
{
  // A bill added to the workbook after its chunks were rendered.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample);
  const oldA = uploadPaths(world, a.uploadId);
  let added = false;
  world.beforeCommit = (key) => {
    if (!added && key.includes(":assemble:triplicate")) {
      added = true;
      const extra = world.addWorkbook("tmp.xlsx", [sample[0]]);
      const bill = world.bills.get(extra.billIds[0])!;
      bill.bill_upload_id = a.uploadId;
      bill.sheet_order = 99;
      world.uploads.delete(extra.uploadId);
    }
  };
  const run = await runFresh(world);
  const ra = run.final.workbook_results.find((r) => r.upload_id === a.uploadId)!;
  check(ra.status === "failed" && ra.code === "workbook_changed", "a bill added before publish blocks publishing an aggregate that would miss it", JSON.stringify(ra));
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA), "old aggregate references are kept");
}
{
  // Someone else replaces the aggregates while the job is running.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample);
  world.beforeCommit = (key) => {
    if (key.includes(":assemble:triplicate")) {
      const u = world.uploads.get(a.uploadId)!;
      if (!u.original_pdf_path?.includes("other")) {
        u.original_pdf_path = `${a.uploadId}/other_original.pdf`;
        world.files.set(u.original_pdf_path, new Uint8Array([1]));
      }
    }
  };
  const run = await runFresh(world);
  const ra = run.final.workbook_results[0];
  check(ra.code === "workbook_changed_during_regeneration", "a concurrent repoint is detected by the compare-and-set publish", JSON.stringify(ra));
  check(world.uploads.get(a.uploadId)!.original_pdf_path === `${a.uploadId}/other_original.pdf` && world.files.has(`${a.uploadId}/other_original.pdf`),
    "the other action's files are kept, not overwritten or deleted");
}
{
  // A bill edited (re-rendered elsewhere) while its copies were being uploaded.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample);
  const target = a.billIds[1];
  world.beforeCommit = (key) => {
    if (key === "wb0:bill1:duplicate") {
      const bill = world.bills.get(target)!;
      bill.pdf_version = 2;
      bill.original_pdf_path = `${a.uploadId}/edited_original.pdf`;
      world.files.set(bill.original_pdf_path, new Uint8Array([7]));
    }
  };
  const run = await runFresh(world);
  const bf = run.final.bill_failures.find((x) => x.bill_id === target);
  check(bf?.code === "bill_edited" && world.bills.get(target)!.original_pdf_path === `${a.uploadId}/edited_original.pdf`,
    "a bill edited mid-job keeps the edit's PDFs and is reported, not overwritten", JSON.stringify(bf));
  check(![...world.files.keys()].some((p) => p.includes(`${target}_`) && p.includes("_v2_")), "the abandoned copies for that bill are removed");
}
{
  // Pre-0023 workbooks have no sheet order: their bills regenerate, the aggregate is kept.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample, { nullOrder: true });
  const oldA = uploadPaths(world, a.uploadId);
  const run = await runFresh(world);
  const ra = run.final.workbook_results[0];
  check(ra.code === "order_not_recorded" && ra.bills_succeeded === 2 && run.final.counters.bills_succeeded === 2,
    "a workbook without sheet order still regenerates its bills and explains why the aggregate was kept", JSON.stringify(ra));
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA), "its aggregate references are untouched");
}
{
  // Bills saved with different company details cannot share one combined document.
  const world = new FakeWorld();
  world.addWorkbook("SAMPLE.xlsx", sample);
  const [x, y] = [...world.bills.values()];
  x.business_profile_snapshot = { company_name: "A Works", payment_days: 30 };
  y.business_profile_snapshot = { company_name: "B Works", payment_days: 45 };
  const run = await runFresh(world);
  check(run.final.workbook_results[0].code === "inconsistent_profile_snapshot", "mixed company snapshots block the aggregate with a clear reason");
}
{
  // A bill whose logo has gone missing fails alone; the rest of its workbook succeeds.
  const world = new FakeWorld();
  const a = world.addWorkbook("SAMPLE.xlsx", sample);
  world.bills.get(a.billIds[0])!.logo_id = "logo-gone";
  const run = await runFresh(world);
  const ra = run.final.workbook_results[0];
  check(ra.status === "partial" && ra.aggregate === "succeeded" && run.final.bill_failures[0]?.code === "logo_unreadable",
    "an unreadable logo fails that bill only; the workbook aggregate is still published", JSON.stringify(ra));
  check(run.final.outcome === "partial", "the job reports partial success");
}

/* ──────────────────────────────────────────────
   7. Large workbooks
   ────────────────────────────────────────────── */

section("7. large workbooks");
{
  const world = new FakeWorld();
  const big = Array.from({ length: 63 }, (_, i) => structuredClone(bill301[i % bill301.length]));
  big.forEach((p, i) => {
    p.sheetName = `S${i + 1}`;
    (p.original as Record<string, unknown>).invoiceNo = `BIG/${i + 1}`;
  });
  const a = world.addWorkbook("Big workbook.xlsx", big);
  const run = await runFresh(world, world.deps({ budgetMs: 50 }));
  check(run.final.outcome === "succeeded" && run.final.counters.bills_succeeded === 63, "a 63-bill workbook (more than the old 20-bill cap) completes", `${run.final.outcome}`);
  const original = world.files.get(uploadPaths(world, a.uploadId).original as string)!;
  check(sameBytes(original, expectedAggregate(world, a.uploadId, "original")), `its aggregate holds every page (${readPdfStructure(original).pageCount}) in sheet order`);
  const downloads = world.ops.filter((o) => o.op === "download");
  check(downloads.every((o) => o.target.startsWith(`${a.uploadId}/`)), "assembly reads only that workbook's own files");
}
{
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const oldA = uploadPaths(world, a.uploadId);
  const run = await runFresh(world, world.deps({ maxAggregateBytes: 100 * 1024 }));
  const ra = run.final.workbook_results[0];
  check(ra.code === "aggregate_too_large" && /dedicated PDF worker/.test(ra.message ?? "") && ra.bills_succeeded === 20,
    "an aggregate over the size cap fails with an actionable message after its bills are regenerated", JSON.stringify(ra));
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA) && tempFiles(world).length === 0, "the old aggregate is kept and temporary chunks are removed");
}

/* ──────────────────────────────────────────────
   8. Cancel
   ────────────────────────────────────────────── */

section("8. stopping a job");
{
  const world = new FakeWorld();
  const a = world.addWorkbook("BILL 301 TO.xlsx", bill301);
  const oldA = uploadPaths(world, a.uploadId);
  const deps = world.deps();
  const jobId = (await startJob(deps, "u1", everything(world))).job!.job_id;
  let view: RegenerationView;
  do {
    view = (await stepJob(deps, jobId)).job!;
    world.clock += 10;
  } while (view.stage !== "aggregate_assemble");
  const stopped = await cancelJob(deps, jobId);
  check(stopped.job?.status === "abandoned" && stopped.job.outcome === "cancelled", "cancel stops the job");
  check(JSON.stringify(uploadPaths(world, a.uploadId)) === JSON.stringify(oldA) && COPY_ORDER.every((k) => world.files.has(oldA[k] as string)),
    "the workbook's active aggregates are untouched");
  check(tempFiles(world).length === 0 && ![...world.files.keys()].some((p) => p.startsWith(`${a.uploadId}/BILL_301_TO_v`)),
    "its temporary chunks and staged files are removed");
  const after = await stepJob(deps, jobId);
  check(after.job?.status === "abandoned" && after.units === 0, "a cancelled job is not reopened by a late step");
}

/* ──────────────────────────────────────────────
   9. What the screens say
   ────────────────────────────────────────────── */

section("9. client view model");
{
  const adminSrc = readFileSync(resolve(REPO, "Metalworker_admin/src/services/regenerationModel.ts"), "utf8");
  const desktopSrc = readFileSync(resolve(REPO, "Metalworker_desktop/src/services/regenerationModel.ts"), "utf8");
  check(adminSrc === desktopSrc, "admin and desktop share an identical regenerationModel.ts");
  const adminHook = readFileSync(resolve(REPO, "Metalworker_admin/src/hooks/useRegeneration.ts"), "utf8");
  const desktopHook = readFileSync(resolve(REPO, "Metalworker_desktop/src/hooks/useRegeneration.ts"), "utf8");
  check(adminHook === desktopHook, "admin and desktop share an identical useRegeneration.ts");

  const okWorld = new FakeWorld();
  okWorld.addWorkbook("SAMPLE.xlsx", sample);
  const ok = (await runFresh(okWorld)).final as unknown as adminModel.RegenerationView;
  const okSummary = adminModel.summarize(ok);
  check(okSummary.tone === "success" && okSummary.title === "All PDFs regenerated", "a clean run is summarised as success");
  check(adminModel.overallProgress(ok)?.percent === 100, "a finished job shows 100%");

  const badWorld = new FakeWorld();
  const a = badWorld.addWorkbook("BILL 301 TO.xlsx", bill301);
  badWorld.addWorkbook("SAMPLE.xlsx", sample);
  badWorld.killOnCommit = (key, attempts) => key.startsWith("wb0:assemble:original") && attempts <= MAX_UNIT_ATTEMPTS;
  const bad = (await runFresh(badWorld)).final as unknown as adminModel.RegenerationView;
  const badSummary = adminModel.summarize(bad);
  const problems = adminModel.problemWorkbooks(bad);
  check(badSummary.tone === "warning" && !/All PDFs/.test(badSummary.title), "a run with a failed workbook is never summarised as success", badSummary.title);
  check(/1 workbook aggregate could not be regenerated/.test(badSummary.detail), "the summary counts the failure", badSummary.detail);
  check(problems.length === 1 && problems[0].upload_id === a.uploadId && problems[0].name === "BILL 301 TO.xlsx" && !!problems[0].message,
    "the failed workbook is named with its reason");

  // Mid-run views: indeterminate where nothing is countable, real counts elsewhere.
  const w = new FakeWorld();
  w.addWorkbook("BILL 301 TO.xlsx", bill301);
  const deps = w.deps();
  const jobId = (await startJob(deps, "u", everything(w))).job!.job_id;
  let sawBillsFraction = false;
  let sawChunkFraction = false;
  let publishIndeterminate = true;
  for (let i = 0; i < 500; i++) {
    const v = (await stepJob(deps, jobId)).job as unknown as adminModel.RegenerationView;
    w.clock += 10;
    if (v.status !== "running") break;
    const sp = adminModel.stageProgress(v);
    if (v.stage === "workbook_bills" && sp && sp.total === 20) sawBillsFraction = true;
    if (v.stage === "aggregate_render" && sp && sp.total === Math.ceil(20 / CHUNK_SIZE) * 3) sawChunkFraction = true;
    if (v.stage === "aggregate_publish" && sp !== null) publishIndeterminate = false;
    const pipe = adminModel.workbookPipeline(v);
    if (v.stage === "aggregate_render" && pipe.find((s) => s.key === "render")?.state !== "active") publishIndeterminate = false;
  }
  check(sawBillsFraction, "the bill stage reports real bill counts");
  check(sawChunkFraction, "the render stage reports chunks rendered out of chunks × 3 copies");
  check(publishIndeterminate, "saving has no invented percentage, and the pipeline marks the active step");
}

console.log(
  failures === 0 ? "\nREGENERATION CHECKS: all passed." : `\nREGENERATION CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
