// src/components/bills/BillUploadPanel.tsx
//
// The upload flow: pick a workbook, watch it go through the seven server
// pipeline steps, get told precisely why it failed if it does.
//
// The step list is the real pipeline from the `process-bill-upload` edge
// function. Steps 1-2 happen in this browser and are observed directly; steps
// 3-7 all happen inside one HTTP call whose response is a single JSON document,
// so their individual completion cannot be seen from here — they are advanced
// while the request is in flight and the *response* decides the final state.
// That is why this is a list of named steps and not a percentage: a bar would
// imply a precision the API does not offer.

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";

import { BillUploadError, uploadBillWorkbook } from "../../services/bills";
import {
  BILL_UPLOAD_STAGE_LABEL,
  BILL_UPLOAD_STAGE_ORDER,
  type BillUploadResult,
  type BillUploadStage,
} from "../../types/bill";
import { useToast } from "../../hooks/useToast";
import { useBillDocumentType } from "../../contexts/BillDocumentTypeContext";
import {
  DOCUMENT_TYPE_INFO,
  describeMixedPreview,
  type MixedWorkbookPreview,
} from "../../services/billDocumentTypes";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Steps shown before the file is chosen. `completed` has its own summary card.
 * Typed as the full union on purpose: `indexOf` must also accept "completed"
 * and "failed" so that those two states resolve to -1 rather than failing to
 * type-check against the narrowed result of `.filter()`.
 */
const ALL_STEPS: BillUploadStage[] = BILL_UPLOAD_STAGE_ORDER.filter((s) => s !== "completed");

export function BillUploadPanel({
  onUploaded,
  onClose,
}: {
  /** Called after a successful upload so the list behind the dialog refreshes. */
  onUploaded: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  /* The selected File is held in state, NOT read back off the <input> when the
     upload starts. The input is unmounted as soon as a file is chosen (the
     picker gives way to the "chosen file" card), so `inputRef.current.files`
     is null by the time "Upload workbook" is pressed — reading it there made
     the button do nothing at all, with no error. The upload must not depend on
     a DOM node still existing. Name and size are derived from this one object
     so they cannot disagree with it. */
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<BillUploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillUploadResult | null>(null);
  /** Set when the workbook holds both document types and needs a confirmation. */
  const [mixed, setMixed] = useState<{ message: string; preview: MixedWorkbookPreview } | null>(null);
  const documentType = useBillDocumentType();
  const info = DOCUMENT_TYPE_INFO[documentType];

  const fileName = file?.name ?? null;
  const fileSize = file?.size ?? null;

  const finished = stage === "completed" || stage === "failed";
  const busy = stage !== null && !finished;

  function reset() {
    setFile(null);
    setStage(null);
    setError(null);
    setResult(null);
    setMixed(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const choose = useCallback((picked: File | null | undefined) => {
    if (!picked) return;
    setError(null);
    setResult(null);
    setMixed(null);

    /* Retained even when validation rejects it, so the "chosen file" card can
       name the file the user actually picked — that is the whole point of the
       error. `start()` re-checks before uploading, and its button is disabled,
       so a rejected file can never be sent. */
    setFile(picked);
    setStage(null);

    if (!/\.xlsx$/i.test(picked.name)) {
      setStage("failed");
      setError(
        `“${picked.name}” is not an Excel workbook. Upload the original .xlsx file — not .xls, .csv or a PDF.`
      );
      return;
    }
    if (picked.size === 0) {
      setStage("failed");
      setError("That file is empty.");
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setStage("failed");
      setError(
        `“${picked.name}” is ${(picked.size / 1024 / 1024).toFixed(1)} MB, over the 50 MB limit.`
      );
    }
  }, []);

  async function start(confirmMixed = false) {
    if (busy) return;
    /* Explicit failure, never a silent no-op: a missing file is a bug in the
       flow or a stale click, and the user must be told which it was. */
    if (!file) {
      setStage("failed");
      setError("Choose a workbook to upload first.");
      return;
    }
    setError(null);
    setMixed(null);
    setStage("reading");
    try {
      const res = await uploadBillWorkbook(file, { onStage: setStage, documentType, confirmMixed });
      setResult(res);
      onUploaded();
      const groups = res.uploads ?? [];
      toast.success({
        title: res.mixed
          ? `Workbook split: ${groups.map((g) => `${g.invoice_count} in ${g.section}`).join(", ")}`
          : `${res.invoice_count} ${res.invoice_count === 1 ? "bill" : "bills"} added to ${info.section}`,
        description: res.mixed
          ? "Each document type has its own upload, bills and combined PDFs."
          : `${res.base_name}_original.pdf, ${res.base_name}_duplicate.pdf and ${res.base_name}_triplicate.pdf are ready.`,
      });
    } catch (err) {
      // A workbook holding both document types is not an error: nothing has been
      // imported yet, and the admin is asked to confirm the split.
      if (err instanceof BillUploadError && err.reason === "mixed_workbook" && err.preview) {
        setStage(null);
        setMixed({ message: err.message, preview: err.preview });
        return;
      }
      setStage("failed");
      setError(
        err instanceof BillUploadError || err instanceof Error
          ? err.message
          : "That workbook could not be processed. Please try again."
      );
    }
  }

  /* `completed` and `failed` are not in ALL_STEPS, so they resolve to -1, which
     is exactly what the "failed" and "all done" branches below want. */
  const currentIndex = stage ? ALL_STEPS.indexOf(stage) : -1;
  const failedAt = stage === "failed" ? Math.max(currentIndex, 0) : -1;
  return (
    <div className="space-y-4">
      {/* ── Picker ─────────────────────────────────────────── */}
      {!fileName && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging ? "border-primary bg-primary-muted" : "border-border bg-bg-secondary"
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-primary-muted flex items-center justify-center mx-auto mb-4">
            <FileSpreadsheet size={26} className="text-primary" />
          </div>
          <p className="text-sm font-bold text-text">Drop an Excel workbook here</p>
          <p className="text-sm text-text-muted mt-1 max-w-md mx-auto leading-relaxed">
            One .xlsx file holding every invoice. Each sheet becomes one bill, and the
            workbook produces three PDFs — original, duplicate and triplicate. Each
            sheet needs at least one invoice copy; missing duplicate or triplicate
            copies are generated automatically.
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label="Choose an Excel workbook"
            onChange={(e) => choose(e.target.files?.[0])}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn btn-primary"
          >
            <UploadCloud size={17} />
            Choose workbook
          </button>
          <p className="text-xs text-text-muted mt-3">.xlsx only · up to 50 MB</p>
        </div>
      )}

      {/* ── Chosen file + pipeline ──────────────────────────── */}
      {fileName && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-bg-secondary">
            <FileSpreadsheet size={20} className="text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-text truncate">{fileName}</p>
              {fileSize !== null && (
                <p className="text-xs text-text-muted">{(fileSize / 1024 / 1024).toFixed(2)} MB</p>
              )}
            </div>
            {!busy && stage !== "completed" && (
              <button
                type="button"
                onClick={reset}
                aria-label="Choose a different workbook"
                title="Choose a different workbook"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <ol className="space-y-1.5" aria-live="polite">
            {ALL_STEPS.map((step, i) => {
              const done = stage === "completed" || currentIndex > i;
              const active = busy && i === currentIndex;
              const failed = failedAt === i;

              return (
                <li key={step} className="flex items-center gap-2.5 text-sm">
                  <span className="w-5 shrink-0 flex items-center justify-center">
                    {failed ? (
                      <AlertTriangle size={15} className="text-danger" />
                    ) : done ? (
                      <CheckCircle2 size={15} className="text-success" />
                    ) : active ? (
                      <Loader2 size={15} className="text-primary animate-spin" />
                    ) : (
                      <Circle size={13} className="text-text-muted/40" />
                    )}
                  </span>
                  <span
                    className={
                      active
                        ? "font-bold text-text"
                        : done
                          ? "text-text-secondary"
                          : "text-text-muted/70"
                    }
                  >
                    {BILL_UPLOAD_STAGE_LABEL[step]}
                  </span>
                </li>
              );
            })}
          </ol>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-muted px-4 py-3 text-[13px] text-danger"
            >
              <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">The workbook was not accepted</p>
                <p className="text-sm text-text-secondary mt-0.5 break-words">{error}</p>
              </div>
            </div>
          )}

          {mixed && (
            <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-muted px-4 py-3" role="status">
              <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">This workbook holds both document types</p>
                <p className="text-sm text-text-secondary mt-0.5">{describeMixedPreview(mixed.preview)}</p>
                <ul className="text-xs text-text-muted mt-1 space-y-0.5">
                  {mixed.preview.groups.map((g) => (
                    <li key={g.document_type} className="break-words">
                      {g.section}: sheets {g.sheets.join(", ")}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-text-secondary mt-1.5">
                  Nothing has been imported yet. Confirm to import each type into its own section, with its own bills and
                  combined PDFs.
                </p>
              </div>
            </div>
          )}

          {result && (
            <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success-muted px-4 py-3">
              <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">
                  {result.mixed
                    ? "Workbook split into both sections"
                    : `${result.invoice_count} ${result.invoice_count === 1 ? "bill" : "bills"} created`}
                </p>
                <ul className="text-sm text-text-secondary mt-1 space-y-0.5">
                  {result.mixed
                    ? (result.uploads ?? []).map((g) => (
                        <li key={g.upload_id}>
                          {g.section}: {g.invoice_count} {g.invoice_count === 1 ? "bill" : "bills"}
                        </li>
                      ))
                    : result.bills.map((b) => (
                        <li key={b.id} className="truncate">
                          Sheet “{b.sheet_name}”
                        </li>
                      ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
        >
          {result ? "Done" : "Close"}
        </button>
        {fileName && !result && mixed && (
          <button type="button" onClick={() => void start(true)} disabled={busy} className="btn btn-primary">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {busy ? "Processing…" : "Import into both sections"}
          </button>
        )}
        {fileName && !result && !mixed && (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || stage === "failed" || !/\.xlsx$/i.test(fileName)}
            className="btn btn-primary"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {busy ? "Processing…" : "Upload workbook"}
          </button>
        )}
      </div>
    </div>
  );
}
