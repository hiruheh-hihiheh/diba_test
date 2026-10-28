// src/components/bills/RegenerationPanel.tsx
//
// The status panel for "Regenerate All PDFs".
//
// Inline on the Bills page, not a blocking overlay: a regeneration can run for
// minutes and the list stays usable meanwhile. Only the button that would start a
// second job is locked.
//
// Every figure comes from the server's job record. Where a step has no countable
// parts (preparing a workbook, saving the three files) the bar is indeterminate
// rather than a guessed percentage, and a workbook is only shown as done once its
// combined PDFs have actually been swapped in.

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, Eye, Info, Loader2, RefreshCw, Square, X, XCircle } from "lucide-react";

import type { RegenerationController } from "../../hooks/useRegeneration";
import {
  COPY_KINDS,
  COPY_NAMES,
  copyStateLabel,
  overallProgress,
  problemWorkbooks,
  stageLabel,
  stageProgress,
  summarize,
  workbookPipeline,
  type CopyState,
  type Fraction,
  type StepState,
  type Summary,
} from "../../services/regenerationModel";

const TONE_TEXT: Record<Summary["tone"], string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-text-muted",
};
const TONE_BG: Record<Summary["tone"], string> = {
  success: "bg-success-muted",
  warning: "bg-warning-muted",
  danger: "bg-danger-muted",
  neutral: "bg-bg-secondary",
};

export default function RegenerationPanel({ controller }: { controller: RegenerationController }) {
  const [showDetails, setShowDetails] = useState(true);
  const { mode, view, wait, error, cancelling } = controller;
  if (mode === "idle") return null;

  const running = mode === "starting" || mode === "running";
  const finished = mode === "finished" && !!view && view.status !== "running";
  const summary = view ? summarize(view) : null;

  let title = "Regenerating PDFs";
  let subtitle = view ? stageLabel(view) : "Starting…";
  if (mode === "starting") subtitle = "Checking for a running job…";
  if (mode === "detached") {
    title = "Regeneration in progress";
    subtitle = view?.lease_active
      ? "Running in another window or session. Progress updates every few seconds."
      : "Paused — no window is advancing it. Resume to continue where it stopped.";
  }
  if (mode === "interrupted") {
    title = "Regeneration paused";
    subtitle = "Lost contact with the server. Nothing was lost: resume to continue from the last saved step.";
  }
  if (mode === "error") {
    title = "Regeneration problem";
    subtitle = error ?? "The request failed.";
  }
  if (finished && summary) {
    title = summary.title;
    subtitle = summary.detail;
  }

  const overall = view ? overallProgress(view) : null;
  const stage = view ? stageProgress(view) : null;
  const wb = view?.current_workbook ?? null;
  const problems = view ? problemWorkbooks(view) : [];
  const canResume = mode === "detached" || mode === "interrupted" || (mode === "error" && view?.status === "running");

  return (
    <section
      className="mb-4 rounded-xl border border-border bg-surface p-4 shadow-sm flex flex-col gap-3"
      aria-live="polite"
      aria-busy={running}
      aria-label="PDF regeneration status"
    >
      <div className="flex items-start gap-3">
        {running || cancelling ? (
          <Loader2 size={22} className="text-primary animate-spin shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <span
            className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${
              finished && summary ? TONE_BG[summary.tone] : mode === "error" ? "bg-danger-muted" : "bg-primary-muted"
            }`}
            aria-hidden="true"
          >
            {finished && summary ? (
              summary.tone === "success" ? (
                <CheckCircle2 size={17} className={TONE_TEXT.success} />
              ) : summary.tone === "neutral" ? (
                <Info size={17} className={TONE_TEXT.neutral} />
              ) : (
                <AlertTriangle size={17} className={TONE_TEXT[summary.tone]} />
              )
            ) : mode === "error" ? (
              <AlertTriangle size={17} className="text-danger" />
            ) : (
              <RefreshCw size={17} className="text-primary" />
            )}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text">{title}</p>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canResume && (
            <button type="button" className="btn btn-primary btn-sm" onClick={controller.resume} disabled={cancelling}>
              <RefreshCw size={14} /> Resume
            </button>
          )}
          {view?.status === "running" && mode !== "starting" && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={controller.cancel} disabled={cancelling}>
              <Square size={13} /> {cancelling ? "Stopping…" : "Stop"}
            </button>
          )}
          {view && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              <Eye size={14} /> {showDetails ? "Hide details" : "Show details"}
            </button>
          )}
          {(finished || (mode === "error" && view?.status !== "running")) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={controller.dismiss} aria-label="Close regeneration status">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {wait && <Notice tone="warning">{wait.message}</Notice>}
      {error && mode !== "error" && <Notice tone="danger">{error}</Notice>}

      {view && (
        <>
          <ProgressRow
            label="Overall"
            value={overall ? `${overall.done} of ${overall.total} items · ${overall.percent}%` : running ? "Working…" : "—"}
            fraction={overall}
            indeterminate={!overall && running}
          />

          {showDetails && wb && view.status === "running" && (
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Workbook {wb.position} of {view.workbooks_total}
                </p>
                <p className="text-sm font-bold text-text truncate" title={wb.name ?? undefined}>
                  {wb.name ?? "Loading workbook…"}
                </p>
              </div>

              <ol className="flex flex-wrap gap-1.5" aria-label="Workbook steps">
                {workbookPipeline(view).map((step) => (
                  <StepChip key={step.key} label={step.label} state={step.state} />
                ))}
              </ol>

              <ProgressRow
                label={stage?.label ?? stageLabel(view)}
                value={stage ? `${stage.done} of ${stage.total}` : "In progress"}
                fraction={stage}
                indeterminate={!stage}
              />

              {wb.bills_total > 0 && (
                <p className="text-xs text-text-muted">
                  Bills: {wb.bills_done} of {wb.bills_total} processed · {wb.bills_succeeded} regenerated
                  {wb.bills_failed > 0 ? ` · ${wb.bills_failed} failed` : ""}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                {COPY_KINDS.map((k) => (
                  <CopyCard
                    key={k}
                    label={COPY_NAMES[k]}
                    state={wb.copies[k].state}
                    detail={
                      wb.copies[k].state === "rendering" && wb.chunks_total > 0
                        ? `${wb.copies[k].chunks_rendered}/${wb.chunks_total} parts`
                        : copyStateLabel(wb.copies[k].state)
                    }
                  />
                ))}
              </div>

              {(wb.aggregate_failure || wb.aggregate_blocked) && (
                <Notice tone={wb.aggregate_failure ? "danger" : "warning"}>
                  {(wb.aggregate_failure ?? wb.aggregate_blocked)?.message}
                </Notice>
              )}
            </div>
          )}

          {showDetails && view.status === "running" && view.stage === "standalone_bills" && (
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Standalone bills (not from a workbook)</p>
              <p className="text-xs text-text-muted mt-1">
                {view.standalone.processed} of {view.standalone.total} processed · {view.standalone.succeeded} regenerated
                {view.standalone.failed > 0 ? ` · ${view.standalone.failed} failed` : ""}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Bills regenerated" value={view.counters.bills_succeeded} />
            <Stat label="Bills failed" value={view.counters.bills_failed} bad={view.counters.bills_failed > 0} />
            <Stat label="Workbooks done" value={view.counters.aggregates_succeeded} />
            <Stat label="Workbooks failed" value={view.counters.aggregates_failed} bad={view.counters.aggregates_failed > 0} />
          </dl>

          {showDetails && (problems.length > 0 || view.bill_failures_total > 0) && (
            <div className="border-t border-border pt-3 flex flex-col gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Needs attention</p>
              <ul className="flex flex-col gap-2">
                {problems.slice(0, 8).map((r) => (
                  <li key={r.upload_id} className="flex items-start gap-2">
                    {r.status === "skipped" ? (
                      <Info size={14} className="text-text-muted mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle size={14} className={`${r.status === "failed" ? "text-danger" : "text-warning"} mt-0.5 shrink-0`} />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text truncate">
                        {r.name} · {r.status === "failed" ? "combined PDFs not replaced" : r.status === "partial" ? "some bills failed" : "skipped"}
                      </p>
                      {r.message && <p className="text-xs text-text-muted">{r.message}</p>}
                    </div>
                  </li>
                ))}
                {view.bill_failures.slice(0, 6).map((f) => (
                  <li key={f.bill_id} className="flex items-start gap-2">
                    <XCircle size={14} className="text-danger mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text truncate">
                        Bill {f.invoice_no ?? f.bill_id}
                        {f.workbook ? ` · ${f.workbook}` : " · standalone"}
                      </p>
                      <p className="text-xs text-text-muted">{f.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {problems.length > 8 && <p className="text-xs text-text-muted">…and {problems.length - 8} more workbooks.</p>}
              {view.bill_failures_total > 6 && (
                <p className="text-xs text-text-muted">…and {view.bill_failures_total - 6} more bills could not be regenerated.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Notice({ tone, children }: { tone: "warning" | "danger"; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-text ${tone === "danger" ? "bg-danger-muted" : "bg-warning-muted"}`} role="status">
      <AlertTriangle size={14} className={`${tone === "danger" ? "text-danger" : "text-warning"} mt-0.5 shrink-0`} aria-hidden="true" />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}

function ProgressRow({ label, value, fraction, indeterminate }: { label: string; value: string; fraction: Fraction | null; indeterminate: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-xs">
        <span className="font-semibold text-text">{label}</span>
        <span className="text-text-secondary tabular-nums">{value}</span>
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-bg-secondary border border-border"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : fraction?.percent ?? 0}
      >
        {indeterminate ? (
          /* A segment sweeping the track: "working, amount unknown". The global
             reduced-motion rule in index.css stops it for users who ask. */
          <div className="absolute inset-y-0 w-[35%] rounded-full bg-primary/80 animate-[progressSlide_1.3s_ease-in-out_infinite]" />
        ) : (
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${fraction?.percent ?? 0}%` }} />
        )}
      </div>
    </div>
  );
}

const STEP_STYLE: Record<StepState, string> = {
  pending: "bg-bg-secondary text-text-muted",
  active: "bg-primary-muted text-text",
  done: "bg-success-muted text-text",
  failed: "bg-danger-muted text-text",
  skipped: "bg-warning-muted text-text",
};

function StepChip({ label, state }: { label: string; state: StepState }) {
  return (
    <li className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STEP_STYLE[state]}`} aria-label={`${label}: ${state}`}>
      {state === "active" ? (
        <Loader2 size={11} className="animate-spin text-primary" aria-hidden="true" />
      ) : state === "done" ? (
        <Check size={11} className="text-success" aria-hidden="true" />
      ) : state === "failed" ? (
        <XCircle size={11} className="text-danger" aria-hidden="true" />
      ) : state === "skipped" ? (
        <Info size={11} className="text-warning" aria-hidden="true" />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60" aria-hidden="true" />
      )}
      {label}
    </li>
  );
}

const COPY_STYLE: Record<CopyState, string> = {
  pending: "border-border text-text-muted",
  rendering: "border-primary text-primary",
  assembled: "border-success text-success",
  published: "border-success text-success",
  failed: "border-danger text-danger",
};

function CopyCard({ label, state, detail }: { label: string; state: CopyState; detail: string }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${COPY_STYLE[state]}`} aria-label={`${label}: ${detail}`}>
      <p className="text-xs font-bold text-text">{label}</p>
      <p className="text-[11px] font-semibold">{detail}</p>
    </div>
  );
}

function Stat({ label, value, bad = false }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-bg-secondary px-3 py-2">
      <dd className={`text-lg font-extrabold tabular-nums ${bad ? "text-danger" : "text-text"}`}>{value}</dd>
      <dt className="text-[11px] font-semibold text-text-muted">{label}</dt>
    </div>
  );
}
