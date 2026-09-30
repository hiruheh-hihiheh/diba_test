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
import { useToast } from "../ui/Toast";

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
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [stage, setStage] = useState<BillUploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillUploadResult | null>(null);

  const finished = stage === "completed" || stage === "failed";
  const busy = stage !== null && !finished;

  function reset() {
    setFileName(null);
    setFileSize(null);
    setStage(null);
    setError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const choose = useCallback((file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);

    setFileName(file.name);
    setFileSize(file.size);

    if (!/\.xlsx$/i.test(file.name)) {
      setStage("failed");
      setError(
        `“${file.name}” is not an Excel workbook. Upload the original .xlsx file — not .xls, .csv or a PDF.`
      );
      return;
    }
    if (file.size === 0) {
      setStage("failed");
      setError("That file is empty.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setStage("failed");
      setError(
        `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 50 MB limit.`
      );
      return;
    }
    setStage(null);
  }, []);

  async function start() {
    const file = inputRef.current?.files?.[0];
    if (!file || busy) return;
    setError(null);
    setStage("reading");
    try {
      const res = await uploadBillWorkbook(file, { onStage: setStage });
      setResult(res);
      onUploaded();
      toast.success({
        title: `${res.invoice_count} ${res.invoice_count === 1 ? "bill" : "bills"} added`,
        description: `${res.base_name}_original.pdf, ${res.base_name}_duplicate.pdf and ${res.base_name}_triplicate.pdf are ready.`,
      });
    } catch (err) {
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
            workbook produces three PDFs — original, duplicate and triplicate.
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
            className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer"
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
              className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-danger-muted border border-danger/30"
            >
              <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">The workbook was not accepted</p>
                <p className="text-sm text-text-secondary mt-0.5 break-words">{error}</p>
              </div>
            </div>
          )}

          {result && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-success-muted border border-success/30">
              <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">
                  {result.invoice_count} {result.invoice_count === 1 ? "bill" : "bills"} created
                </p>
                <ul className="text-sm text-text-secondary mt-1 space-y-0.5">
                  {result.bills.map((b) => (
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
        {fileName && !result && (
          <button
            type="button"
            onClick={start}
            disabled={busy || stage === "failed" || !/\.xlsx$/i.test(fileName)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {busy ? "Processing…" : "Upload workbook"}
          </button>
        )}
      </div>
    </div>
  );
}
