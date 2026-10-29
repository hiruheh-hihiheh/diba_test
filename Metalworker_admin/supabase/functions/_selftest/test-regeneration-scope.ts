// supabase/functions/_selftest/test-regeneration-scope.ts
//
// "REGENERATE PDFs" FOR CHOSEN WORKBOOKS ONLY.
//
// The admin picks workbooks in a selector; the Edge Function validates that
// selection against the database, freezes it in the job, and must never touch
// anything outside it. This suite drives the real engine (`engine.ts`) against the
// in-memory database and bucket from `regeneration-fakes.ts`, and the real shared
// selection helpers the admin and desktop dialogs use (`regenerationModel.ts`).

import {
  LEASE_MS,
  MAX_UNIT_ATTEMPTS,
  PermanentError,
  jobStatus,
  listWorkbooks,
  startJob,
  stepJob,
  type RegenerationDeps,
  type RegenerationView,
} from "../regenerate-bill-pdfs/engine.ts";
import { FakeWorld, WorkerKilled, fixtureBills } from "./regeneration-fakes.ts";
import * as model from "../../../src/services/regenerationModel.ts";

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  — ${detail}` : ""}`);
};
const section = (title: string): void => console.log(`\n${title}`);

const bill301 = await fixtureBills("BILL 301 TO.xlsx");
const sample = await fixtureBills("SAMPLE.xlsx");
const sanitized = await fixtureBills("test-bills-sanitized.xlsx");

async function drive(world: FakeWorld, deps: RegenerationDeps, jobId: string): Promise<{ final: RegenerationView; views: RegenerationView[] }> {
  const views: RegenerationView[] = [];
  for (let calls = 0; calls < 20_000; calls++) {
    let res;
    try {
      res = await stepJob(deps, jobId);
    } catch (err) {
      if (err instanceof WorkerKilled) {
        world.clock += 1_000;
        continue;
      }
      throw err;
    }
    const view = res.job as RegenerationView;
    views.push(view);
    if (view.status !== "running") return { final: view, views };
    world.clock += res.busy ? LEASE_MS + 1 : res.retry_after_ms ?? 10;
  }
  throw new Error("job did not terminate");
}

async function run(world: FakeWorld, scope: unknown) {
  const deps = world.deps();
  const started = await startJob(deps, "admin", scope);
  const jobId = started.job!.job_id;
  return { jobId, started, ...(await drive(world, deps, jobId)) };
}

/** A snapshot of everything a workbook owns, to prove an unselected one is untouched. */
function fingerprint(world: FakeWorld, uploadId: string): string {
  const u = world.uploads.get(uploadId)!;
  const bills = [...world.bills.values()].filter((b) => b.bill_upload_id === uploadId);
  const paths = [u.original_pdf_path, u.duplicate_pdf_path, u.triplicate_pdf_path, ...bills.flatMap((b) => [b.original_pdf_path, b.duplicate_pdf_path, b.triplicate_pdf_path])];
  return JSON.stringify({
    paths,
    versions: bills.map((b) => b.pdf_version),
    onDisk: paths.map((p) => (p ? world.files.has(p) : null)),
  });
}

function touched(world: FakeWorld, uploadId: string): boolean {
  return world.ops.some((o) => o.target === uploadId || o.target.startsWith(`${uploadId}/`));
}

/** Three workbooks (A, B, C), one unfinished upload (X), and two standalone bills. */
function seed() {
  const world = new FakeWorld();
  const A = world.addWorkbook("October_Production.xlsx", bill301);
  world.clock += 1;
  const B = world.addWorkbook("SAMPLE.xlsx", sample);
  world.clock += 1;
  const C = world.addWorkbook("November.xlsx", [sample[1]]);
  world.clock += 1;
  const X = world.addWorkbook("Half-uploaded.xlsx", [sample[0]], { status: "uploaded" });
  const S1 = world.addManualBill(sanitized[0]);
  const S2 = world.addManualBill(sample[0]);
  return { world, A, B, C, X, S1, S2 };
}

/* ──────────────────────────────────────────────
   The list the selector shows
   ────────────────────────────────────────────── */

section("workbook list");
{
  const { world, A, X } = seed();
  const list = await listWorkbooks(world.deps());
  const a = list.workbooks.find((w) => w.upload_id === A.uploadId)!;
  const x = list.workbooks.find((w) => w.upload_id === X.uploadId)!;
  check(list.workbooks.length === 4, "every Excel workbook upload is listed, manual Bill Creator uploads are not", `${list.workbooks.length}`);
  check(a.name === "October_Production.xlsx" && a.bill_count === 20 && !!a.uploaded_at && a.eligible && a.has_combined_pdfs,
    "a row carries filename, bill count, upload date and eligibility from bill_uploads", JSON.stringify(a));
  check(!x.eligible && /never finished/.test(x.ineligible_reason ?? ""), "an unfinished upload is listed as not eligible, with the reason");
  check(list.standalone_count === 2, "the standalone bill count is reported separately");
}

/* ──────────────────────────────────────────────
   1, 2, 6, 11. Only the selection is regenerated
   ────────────────────────────────────────────── */

section("1. one selected workbook");
{
  const { world, A, B, C, S1, S2 } = seed();
  const before = { A: fingerprint(world, A.uploadId), C: fingerprint(world, C.uploadId) };
  const standaloneBefore = [S1, S2].map((id) => JSON.stringify(world.bills.get(id)));
  const { final } = await run(world, { upload_ids: [B.uploadId], include_standalone: false });
  check(final.outcome === "succeeded" && final.counters.bills_succeeded === 2 && final.counters.aggregates_succeeded === 1,
    "only the selected workbook's 2 bills and 1 aggregate are regenerated", JSON.stringify(final.counters));
  check(world.uploads.get(B.uploadId)!.original_pdf_path?.includes("_v") === true, "the selected workbook's aggregates are replaced");
  check(fingerprint(world, A.uploadId) === before.A && fingerprint(world, C.uploadId) === before.C,
    "unselected workbooks keep their aggregate references, bill PDFs and versions, all still on disk");
  check(!touched(world, A.uploadId) && !touched(world, C.uploadId), "no file of an unselected workbook is read, written or removed");
  check([S1, S2].every((id, i) => JSON.stringify(world.bills.get(id)) === standaloneBefore[i]), "standalone bills are not regenerated during a targeted run");
  check(final.standalone.total === 0, "standalone bills are not counted in a targeted run");
}

section("2. several selected workbooks");
{
  const { world, A, B, C } = seed();
  const before = fingerprint(world, B.uploadId);
  // Sent in reverse order: the job still runs them in upload order.
  const { final } = await run(world, { upload_ids: [C.uploadId, A.uploadId], include_standalone: false });
  check(final.workbook_results.map((r) => r.upload_id).join() === [A.uploadId, C.uploadId].join(),
    "exactly the selected workbooks are processed, oldest upload first", final.workbook_results.map((r) => r.name).join());
  check(fingerprint(world, B.uploadId) === before && !touched(world, B.uploadId), "the workbook in between is untouched");
  check(final.counters.bills_succeeded === 21 && final.counters.aggregates_succeeded === 2, "counts cover the selection only", JSON.stringify(final.counters));
}

/* ──────────────────────────────────────────────
   3, 4, 5. The dialog's selection helpers
   ────────────────────────────────────────────── */

section("3-5. select all, deselect all, search");
{
  const { world, A, B, C, X } = seed();
  const options = (await listWorkbooks(world.deps())).workbooks as model.WorkbookOption[];

  const filtered = model.filterWorkbookOptions(options, "sample");
  check(filtered.length === 1 && filtered[0].upload_id === B.uploadId, "search finds a workbook by filename, case-insensitively");
  const all = model.selectAllEligible(options);
  check(all.size === 3 && [A, B, C].every((w) => all.has(w.uploadId)) && !all.has(X.uploadId),
    "Select all selects every eligible workbook, not the ineligible one");
  check(model.selectAllEligible(options).size === 3 && filtered.length === 1,
    "Select all works on the full list while a search is narrowing the view");
  check(model.selectionLabel(all, options) === "3 of 3 workbooks selected", "the counter reads \"3 of 3 workbooks selected\"", model.selectionLabel(all, options));
  check(model.toggleWorkbook(new Set(), options.find((o) => o.upload_id === X.uploadId)!).size === 0, "an ineligible workbook cannot be ticked");
  const one = model.toggleWorkbook(new Set(), options.find((o) => o.upload_id === B.uploadId)!);
  check(model.selectionLabel(one, options) === "1 of 3 workbooks selected", "individual toggles update the counter");

  check(model.buildScope(new Set(), options, false) === null, "after Deselect all there is no scope, so Regenerate selected stays disabled");
  const standaloneOnly = model.buildScope(new Set(), options, true);
  check(standaloneOnly?.upload_ids.length === 0 && standaloneOnly.include_standalone === true, "ticking only standalone bills is an explicit, non-empty scope");

  let rejected = false;
  try {
    await startJob(world.deps(), "admin", { upload_ids: [], include_standalone: false });
  } catch (err) {
    rejected = err instanceof PermanentError && err.code === "invalid_scope";
  }
  check(rejected && world.jobs.size === 0, "the server refuses an empty selection and creates no job");

  const scope = model.buildScope(all, options, false)!;
  const { final } = await run(world, scope);
  check(final.scope?.all_workbooks === true && final.scope.workbooks_selected === 3 && final.counters.aggregates_succeeded === 3,
    "a Select-all job regenerates every eligible workbook and says so", JSON.stringify(final.scope));
  check(!touched(world, X.uploadId) && final.standalone.total === 0, "it does not include the ineligible upload or, unasked, the standalone bills");
}

/* ──────────────────────────────────────────────
   7. The server validates the selection
   ────────────────────────────────────────────── */

section("7. invalid selections are rejected");
{
  const { world, A, X, S1 } = seed();
  const manualUpload = world.bills.get(S1)!.bill_upload_id;
  const cases: [string, unknown][] = [
    ["no scope at all", undefined],
    ["a scope that is not a list", { upload_ids: A.uploadId, include_standalone: false }],
    ["a workbook id that does not exist", { upload_ids: [A.uploadId, "nope"], include_standalone: false }],
    ["an upload that never finished", { upload_ids: [X.uploadId], include_standalone: false }],
    ["a Bill Creator upload, which is not a workbook", { upload_ids: [manualUpload], include_standalone: false }],
    ["the same workbook twice", { upload_ids: [A.uploadId, A.uploadId], include_standalone: false }],
    ["standalone left unspecified", { upload_ids: [A.uploadId] }],
  ];
  for (const [label, scope] of cases) {
    let code = "";
    try {
      await startJob(world.deps(), "admin", scope);
    } catch (err) {
      code = err instanceof PermanentError ? err.code : String(err);
    }
    check(code === "invalid_scope", `rejected: ${label}`, code);
  }
  check(world.jobs.size === 0 && world.ops.length === 0, "no rejected request created a job or touched a file");
}

/* ──────────────────────────────────────────────
   8, 9. The scope is frozen for the job's lifetime
   ────────────────────────────────────────────── */

section("8-9. resume and second start keep the original scope");
{
  const { world, A, B, C } = seed();
  const before = { A: fingerprint(world, A.uploadId), C: fingerprint(world, C.uploadId) };
  const deps = world.deps();
  const jobId = (await startJob(deps, "admin", { upload_ids: [B.uploadId], include_standalone: false })).job!.job_id;
  for (let i = 0; i < 3; i++) {
    await stepJob(deps, jobId);
    world.clock += 10;
  }

  // Another window asks for everything while the job runs.
  const second = await startJob(world.deps(), "admin", { upload_ids: [A.uploadId, B.uploadId, C.uploadId], include_standalone: true });
  check(second.attached === true && second.job?.job_id === jobId, "a second start attaches to the running job");
  check(second.job?.scope?.workbooks_selected === 1 && second.job.scope.workbooks[0].upload_id === B.uploadId && !second.job.scope.include_standalone,
    "and reports that job's own scope, not the new request", JSON.stringify(second.job?.scope));

  // A reload reconnects through status with no job id.
  const reconnected = (await jobStatus(world.deps(), null)).job!;
  check(reconnected.job_id === jobId && reconnected.scope?.workbooks.map((w) => w.upload_id).join() === B.uploadId,
    "after a reload, status shows the running job's original selection");

  const { final } = await drive(world, world.deps(), jobId);
  check(final.workbook_results.length === 1 && final.workbook_results[0].upload_id === B.uploadId && final.standalone.total === 0,
    "the resumed job finishes exactly its original selection");
  check(fingerprint(world, A.uploadId) === before.A && fingerprint(world, C.uploadId) === before.C, "workbooks named only in the second request are untouched");
}

/* ──────────────────────────────────────────────
   10. Progress and results describe the selection
   ────────────────────────────────────────────── */

section("10. progress, failures and summary reflect the selection");
{
  const { world, A, B, C } = seed();
  const oldA = fingerprint(world, A.uploadId);
  // A's merge dies every time, so A fails; B succeeds; C is not selected.
  world.killOnCommit = (key, attempts) => key.startsWith("wb0:assemble:original") && attempts <= MAX_UNIT_ATTEMPTS;
  const { final, views } = await run(world, { upload_ids: [A.uploadId, B.uploadId], include_standalone: false });
  check(views.every((v) => v.workbooks_total === 2 && v.scope?.workbooks_selected === 2), "every progress view counts 2 selected workbooks, never the 3 in the database");
  const mid = views.find((v) => v.status === "running" && v.current_workbook?.position === 2);
  check(!!mid && model.overallProgress(mid as unknown as model.RegenerationView)?.total === 2, "overall progress is out of the selected workbooks");
  check(final.scope?.workbooks.map((w) => `${w.name}:${w.status}`).join() === "October_Production.xlsx:failed,SAMPLE.xlsx:succeeded",
    "the job's workbook list names each selected workbook with its result", JSON.stringify(final.scope?.workbooks));
  const summary = model.summarize(final as unknown as model.RegenerationView);
  const problems = model.problemWorkbooks(final as unknown as model.RegenerationView);
  check(final.outcome === "partial" && summary.tone === "warning" && !/All PDFs/.test(summary.title), "a failed selected workbook makes the job partial, not successful");
  check(problems.length === 1 && problems[0].name === "October_Production.xlsx" && !!problems[0].message, "the failed workbook is named with its reason");
  const a = world.uploads.get(A.uploadId)!;
  check(
    a.original_pdf_path === `${A.uploadId}/October_Production_original.pdf` &&
      a.triplicate_pdf_path === `${A.uploadId}/October_Production_triplicate.pdf` &&
      world.files.has(a.original_pdf_path as string) &&
      JSON.parse(fingerprint(world, A.uploadId)).paths.slice(0, 3).join() === JSON.parse(oldA).paths.slice(0, 3).join(),
    "the failed workbook keeps its previous aggregate references and files"
  );
  check(!touched(world, C.uploadId) && model.scopeLabel(final as unknown as model.RegenerationView) === "2 selected workbooks · standalone bills not included",
    "the unselected workbook is untouched and the scope label says what ran", model.scopeLabel(final as unknown as model.RegenerationView));
}

/* ──────────────────────────────────────────────
   11. Standalone bills are their own explicit choice
   ────────────────────────────────────────────── */

section("11. standalone bills");
{
  const { world, A, B, C, S1, S2 } = seed();
  const before = [A, B, C].map((w) => fingerprint(world, w.uploadId));
  const { final } = await run(world, { upload_ids: [], include_standalone: true });
  check(final.outcome === "succeeded" && final.standalone.total === 2 && final.standalone.succeeded === 2 && final.workbooks_total === 0,
    "a standalone-only job regenerates exactly the standalone bills", JSON.stringify(final.standalone));
  check([S1, S2].every((id) => world.bills.get(id)!.pdf_version === 2), "both standalone bills are repointed");
  check([A, B, C].every((w, i) => fingerprint(world, w.uploadId) === before[i]), "no workbook is touched by a standalone-only job");
}
{
  const { world, S1, S2 } = seed();
  const options = (await listWorkbooks(world.deps())).workbooks as model.WorkbookOption[];
  const { final } = await run(world, model.buildScope(model.selectAllEligible(options), options, true));
  check(final.counters.aggregates_succeeded === 3 && final.standalone.succeeded === 2 && [S1, S2].every((id) => world.bills.get(id)!.pdf_version === 2),
    "Select all plus the standalone option is the explicit full regeneration");
  check(model.scopeLabel(final as unknown as model.RegenerationView) === "All 3 eligible workbooks · standalone bills included", "and its scope label says so");
}

console.log(failures === 0 ? "\nREGENERATION SCOPE CHECKS: all passed." : `\nREGENERATION SCOPE CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
