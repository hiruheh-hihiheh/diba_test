// regenerationModel.ts — PDF regeneration progress, as the screens present it.
//
// This file is kept byte-identical in Metalworker_admin/src/services and
// Metalworker_desktop/src/services (the self-test `test-regeneration.ts` fails if
// they drift). It has no imports so both apps, and the Node self-tests, can load it.
//
// Every number here comes from the server's job record. Nothing is estimated from
// elapsed time, and where the server cannot say how far along a step is the
// helpers return `null` so the screen shows an indeterminate bar instead of a
// made-up percentage.

export type CopyKind = "original" | "duplicate" | "triplicate";
export type JobStatus = "running" | "completed" | "failed" | "abandoned";
export type JobOutcome = "succeeded" | "partial" | "failed" | "empty" | "cancelled";
export type RegenerationStage =
  | "workbook_prepare"
  | "workbook_bills"
  | "aggregate_render"
  | "aggregate_assemble"
  | "aggregate_publish"
  | "workbook_cleanup"
  | "standalone_bills"
  | "done";
export type CopyState = "pending" | "rendering" | "assembled" | "published" | "failed";

export interface WorkbookResult {
  upload_id: string;
  name: string;
  status: "succeeded" | "partial" | "failed" | "skipped";
  bills_total: number;
  bills_succeeded: number;
  bills_failed: number;
  aggregate: "succeeded" | "failed" | "skipped";
  code?: string;
  message?: string;
  cleanup_warning?: string;
}

export interface BillFailure {
  bill_id: string;
  invoice_no: string | null;
  workbook: string | null;
  code: string;
  message: string;
}

export interface RegenerationCounters {
  bills_processed: number;
  bills_succeeded: number;
  bills_failed: number;
  aggregates_processed: number;
  aggregates_succeeded: number;
  aggregates_failed: number;
}

export interface RegenerationView {
  job_id: string;
  status: JobStatus;
  outcome: JobOutcome | null;
  stage: RegenerationStage;
  started_at: string;
  updated_at: string;
  lease_active: boolean;
  /** The job's own selection, frozen when it started. Null only for pre-scope jobs. */
  scope: {
    workbooks_selected: number;
    all_workbooks: boolean;
    eligible_total: number;
    include_standalone: boolean;
    workbooks: { upload_id: string; name: string; status: "pending" | "in_progress" | WorkbookResult["status"] }[];
  } | null;
  workbooks_total: number;
  workbooks_finished: number;
  current_workbook: null | {
    position: number;
    upload_id: string;
    name: string | null;
    bills_total: number;
    bills_done: number;
    bills_succeeded: number;
    bills_failed: number;
    chunks_total: number;
    copies: Record<CopyKind, { state: CopyState; chunks_rendered: number }>;
    aggregate_blocked: { code: string; message: string } | null;
    aggregate_failure: { code: string; message: string } | null;
  };
  standalone: { total: number; processed: number; succeeded: number; failed: number };
  counters: RegenerationCounters;
  workbook_results: WorkbookResult[];
  bill_failures: BillFailure[];
  bill_failures_total: number;
  last_error: { code: string; message: string; transient: boolean } | null;
  attempts: number;
}

export const COPY_KINDS: readonly CopyKind[] = ["original", "duplicate", "triplicate"];
export const COPY_NAMES: Record<CopyKind, string> = {
  original: "Original",
  duplicate: "Duplicate",
  triplicate: "Triplicate",
};

export function isTerminal(view: RegenerationView | null): boolean {
  return !!view && view.status !== "running";
}

/** The label for what the job is doing right now. */
export function stageLabel(view: RegenerationView): string {
  if (view.status === "abandoned") return "Stopped";
  if (view.status === "failed") return "Failed";
  if (view.status === "completed") return "Completed";
  switch (view.stage) {
    case "workbook_prepare":
      return "Preparing workbook";
    case "workbook_bills":
      return "Regenerating individual PDFs";
    case "aggregate_render":
      return "Rendering aggregate PDFs";
    case "aggregate_assemble":
      return "Merging PDFs";
    case "aggregate_publish":
      return "Saving files";
    case "workbook_cleanup":
      return "Finishing workbook";
    case "standalone_bills":
      return "Regenerating standalone bills";
    case "done":
      return "Finishing";
  }
}

export type StepState = "pending" | "active" | "done" | "failed" | "skipped";

export interface PipelineStep {
  key: "prepare" | "bills" | "render" | "merge" | "save";
  label: string;
  state: StepState;
}

const ORDER: RegenerationStage[] = [
  "workbook_prepare",
  "workbook_bills",
  "aggregate_render",
  "aggregate_assemble",
  "aggregate_publish",
  "workbook_cleanup",
];

/** The current workbook's five steps, each pending, active, done, failed or skipped. */
export function workbookPipeline(view: RegenerationView): PipelineStep[] {
  const wb = view.current_workbook;
  const at = ORDER.indexOf(view.stage);
  const steps: { key: PipelineStep["key"]; label: string; stage: RegenerationStage }[] = [
    { key: "prepare", label: "Prepare", stage: "workbook_prepare" },
    { key: "bills", label: "Bill PDFs", stage: "workbook_bills" },
    { key: "render", label: "Render", stage: "aggregate_render" },
    { key: "merge", label: "Merge", stage: "aggregate_assemble" },
    { key: "save", label: "Save", stage: "aggregate_publish" },
  ];
  const aggregateStopped = !!wb && (!!wb.aggregate_failure || !!wb.aggregate_blocked);
  return steps.map((s) => {
    const idx = ORDER.indexOf(s.stage);
    let state: StepState;
    if (at < 0) state = "pending";
    else if (idx < at) state = "done";
    else if (idx === at) state = "active";
    else state = "pending";
    const isAggregateStep = s.key === "render" || s.key === "merge" || s.key === "save";
    if (isAggregateStep && aggregateStopped && state !== "done") {
      state = wb?.aggregate_failure ? "failed" : "skipped";
    }
    if (s.key === "bills" && state === "done" && wb && wb.bills_failed > 0) state = "failed";
    return { key: s.key, label: s.label, state };
  });
}

export interface Fraction {
  done: number;
  total: number;
  percent: number;
}

function fraction(done: number, total: number): Fraction | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const d = Math.max(0, Math.min(Math.floor(done), Math.floor(total)));
  return { done: d, total: Math.floor(total), percent: Math.round((d / total) * 100) };
}

/**
 * Overall progress in work items the job has actually finished: whole workbooks
 * (counted only once their result is recorded) plus standalone bills.
 */
export function overallProgress(view: RegenerationView): Fraction | null {
  const total = view.workbooks_total + view.standalone.total;
  const done = view.workbooks_finished + view.standalone.processed;
  if (view.status === "completed") return fraction(total, total);
  return fraction(done, total);
}

/** Progress inside the current step, or null where the step has no countable parts. */
export function stageProgress(view: RegenerationView): (Fraction & { label: string }) | null {
  const wb = view.current_workbook;
  if (view.status !== "running") return null;
  if (view.stage === "standalone_bills") {
    const f = fraction(view.standalone.processed, view.standalone.total);
    return f ? { ...f, label: "Standalone bills" } : null;
  }
  if (!wb) return null;
  switch (view.stage) {
    case "workbook_bills": {
      const f = fraction(wb.bills_done, wb.bills_total);
      return f ? { ...f, label: "Bill PDFs" } : null;
    }
    case "aggregate_render": {
      const rendered = COPY_KINDS.reduce((sum, k) => sum + wb.copies[k].chunks_rendered, 0);
      const f = fraction(rendered, wb.chunks_total * COPY_KINDS.length);
      return f ? { ...f, label: "Aggregate chunks rendered" } : null;
    }
    case "aggregate_assemble": {
      const merged = COPY_KINDS.filter((k) => wb.copies[k].state === "assembled").length;
      const f = fraction(merged, COPY_KINDS.length);
      return f ? { ...f, label: "Copies merged" } : null;
    }
    default:
      return null;
  }
}

export interface Summary {
  tone: "success" | "warning" | "danger" | "neutral";
  title: string;
  detail: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The headline for a finished job. Success is claimed only when nothing failed. */
export function summarize(view: RegenerationView): Summary {
  const c = view.counters;
  const done = `${plural(c.bills_succeeded, "bill")} and ${plural(c.aggregates_succeeded, "workbook aggregate")} regenerated`;
  const failedParts: string[] = [];
  if (c.bills_failed > 0) failedParts.push(plural(c.bills_failed, "bill"));
  if (c.aggregates_failed > 0) failedParts.push(plural(c.aggregates_failed, "workbook aggregate"));
  const failed = failedParts.join(" and ");

  if (view.status === "abandoned" || view.outcome === "cancelled") {
    return {
      tone: "neutral",
      title: "Regeneration stopped",
      detail: `${done} before it was stopped.${failed ? ` ${failed} could not be regenerated.` : ""} Anything not regenerated still has its previous PDFs.`,
    };
  }
  if (view.status === "failed") {
    return {
      tone: "danger",
      title: "Regeneration could not continue",
      detail: view.last_error?.message ?? "The job stopped with an error. Existing PDFs were kept.",
    };
  }
  if (view.status === "running") {
    return { tone: "neutral", title: "Regenerating PDFs", detail: stageLabel(view) };
  }
  switch (view.outcome) {
    case "succeeded":
      return { tone: "success", title: "All PDFs regenerated", detail: `${done}.` };
    case "partial":
      return {
        tone: "warning",
        title: "Finished with some failures",
        detail: `${done}. ${failed} could not be regenerated; their existing PDFs were kept.`,
      };
    case "failed":
      return {
        tone: "danger",
        title: "Regeneration failed",
        detail: `${failed} could not be regenerated; their existing PDFs were kept.`,
      };
    case "empty":
    default:
      return { tone: "neutral", title: "Nothing to regenerate", detail: "No finalized bills or workbooks were found." };
  }
}

/** Workbooks that did not fully succeed, worst first. */
export function problemWorkbooks(view: RegenerationView): WorkbookResult[] {
  const rank = { failed: 0, partial: 1, skipped: 2, succeeded: 3 } as const;
  return view.workbook_results
    .filter((r) => r.status !== "succeeded")
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

export function copyStateLabel(state: CopyState): string {
  switch (state) {
    case "pending":
      return "Waiting";
    case "rendering":
      return "In progress";
    case "assembled":
      return "Merged";
    case "published":
      return "Saved";
    case "failed":
      return "Not replaced";
  }
}

/* ──────────────────────────────────────────────
   Workbook selection
   ────────────────────────────────────────────── */

/** One row of the selector, as `list_workbooks` returns it. */
export interface WorkbookOption {
  upload_id: string;
  name: string;
  uploaded_at: string | null;
  bill_count: number;
  eligible: boolean;
  ineligible_reason: string | null;
  has_combined_pdfs: boolean;
}

/** What a start request asks for. The server validates every part of it. */
export interface RegenerationScope {
  upload_ids: string[];
  include_standalone: boolean;
}

/** Rows whose filename contains `query` (case-insensitive). Display only. */
export function filterWorkbookOptions(options: WorkbookOption[], query: string): WorkbookOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.name.toLowerCase().includes(q));
}

/**
 * Every eligible workbook — deliberately from the full list, never from the
 * filtered one, so "Select all" means all even while a search is narrowing what
 * is on screen.
 */
export function selectAllEligible(options: WorkbookOption[]): Set<string> {
  return new Set(options.filter((o) => o.eligible).map((o) => o.upload_id));
}

/** Toggle one workbook. Ineligible workbooks cannot be selected. */
export function toggleWorkbook(selected: ReadonlySet<string>, option: WorkbookOption): Set<string> {
  const next = new Set(selected);
  if (next.has(option.upload_id)) next.delete(option.upload_id);
  else if (option.eligible) next.add(option.upload_id);
  return next;
}

export function eligibleCount(options: WorkbookOption[]): number {
  return options.filter((o) => o.eligible).length;
}

/** e.g. "3 of 24 workbooks selected". Counts only selections that are still eligible. */
export function selectionLabel(selected: ReadonlySet<string>, options: WorkbookOption[]): string {
  const total = eligibleCount(options);
  const count = options.filter((o) => o.eligible && selected.has(o.upload_id)).length;
  return `${count} of ${total} workbook${total === 1 ? "" : "s"} selected`;
}

/**
 * The request for the current selection, or null when nothing would be done —
 * the start button is disabled on null, so an empty job can never be requested.
 * Ids are sent in list order and only if eligible.
 */
export function buildScope(selected: ReadonlySet<string>, options: WorkbookOption[], includeStandalone: boolean): RegenerationScope | null {
  const ids = options.filter((o) => o.eligible && selected.has(o.upload_id)).map((o) => o.upload_id);
  if (ids.length === 0 && !includeStandalone) return null;
  return { upload_ids: ids, include_standalone: includeStandalone };
}

/** How a job's scope reads in the progress panel. */
export function scopeLabel(view: RegenerationView): string {
  const sc = view.scope;
  if (!sc) return "All workbooks and standalone bills";
  const workbooks = sc.all_workbooks
    ? `All ${sc.workbooks_selected} eligible workbook${sc.workbooks_selected === 1 ? "" : "s"}`
    : sc.workbooks_selected === 0
      ? "No workbooks"
      : `${sc.workbooks_selected} selected workbook${sc.workbooks_selected === 1 ? "" : "s"}`;
  return `${workbooks} · standalone bills ${sc.include_standalone ? "included" : "not included"}`;
}
