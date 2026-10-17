// src/components/bills/BulkDownloadZipModal.tsx
//
// "Download ZIP" is not one action, it is a small choice: WHICH print copies the
// archive should hold. This is that choice.
//
// WHY A DIALOG AND NOT THREE BUTTONS
// Three buttons in the bulk bar ("Original ZIP", "All copies ZIP", ...) would grow
// to seven for every combination, and a bulk bar that has become a menu is harder to
// read than the two clicks this takes. One entry point, one clear question.
//
// WHY THE COUNT IS SHOWN BEFORE STARTING
// The user is about to fetch hundreds of documents. "412 bills x 3 copies = up to
// 1236 PDFs" is the number that lets them decide whether to narrow the selection
// first, and it is stated here rather than discovered from a progress bar.
//
// The count is the CEILING, not a promise: a bill whose copy was never generated is
// skipped, and the completion message reports what really went in. Saying "up to"
// here and the truth afterwards is the honest pair.

import { useState } from "react";
import { Check, FileArchive } from "lucide-react";

import Modal, { ModalCancel } from "../ui/Modal";
import { BILL_COPIES, BILL_COPY_LABEL, type BillCopy } from "../../types/bill";

interface BulkDownloadZipModalProps {
  open: boolean;
  onClose: () => void;
  /** How many bills are selected right now, across every page and filter. */
  count: number;
  /** True when the selection is the whole matching set; the bar says this too. */
  allMatching?: boolean;
  /** `copies` is always in print order, never the order they were ticked. */
  onConfirm: (copies: BillCopy[]) => void;
}

/** One tick row. A real checkbox input, so keyboard and screen readers work. */
function CopyChoice({
  copy,
  checked,
  onToggle,
}: {
  copy: BillCopy;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border bg-surface hover:bg-surface-hover transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="sr-only"
        aria-label={BILL_COPY_LABEL[copy]}
      />
      <span
        aria-hidden="true"
        className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
          checked ? "bg-primary border-primary text-white" : "border-border bg-surface"
        }`}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="text-sm font-semibold text-text">{BILL_COPY_LABEL[copy]}</span>
    </label>
  );
}

export default function BulkDownloadZipModal({
  open,
  onClose,
  count,
  allMatching,
  onConfirm,
}: BulkDownloadZipModalProps) {
  /* Original is the default because it is the copy that is actually sent to the
     customer; the other two are for the file. Reset on the closed→open edge by
     adjusting state during render — the pattern React documents for "reset state
     when a prop changes" — rather than in an effect, which would paint the previous
     selection for a frame. */
  const [copies, setCopies] = useState<BillCopy[]>(["original"]);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setCopies(["original"]);
  }

  const toggle = (copy: BillCopy) => {
    setCopies((prev) => (prev.includes(copy) ? prev.filter((c) => c !== copy) : [...prev, copy]));
  };

  const maxDocuments = count * copies.length;
  const billWord = count === 1 ? "bill" : "bills";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download as ZIP"
      subtitle={`${count} ${billWord} selected${allMatching ? ", every bill matching these filters" : ""}`}
      footer={
        <>
          <ModalCancel onClick={onClose} />
          <button
            type="button"
            autoFocus
            disabled={copies.length === 0}
            onClick={() => onConfirm(BILL_COPIES.filter((c) => copies.includes(c)))}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-primary hover:bg-primary-hover shadow-lg shadow-primary/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileArchive size={15} />
            {maxDocuments === 1 ? "Download 1 PDF" : `Download ${maxDocuments} PDFs`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Choose the print copies to include. The chosen copies are downloaded for{" "}
          <strong className="text-text">every selected bill</strong>.
        </p>

        <div className="flex flex-col gap-2">
          {BILL_COPIES.map((copy) => (
            <CopyChoice
              key={copy}
              copy={copy}
              checked={copies.includes(copy)}
              onToggle={() => toggle(copy)}
            />
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface-secondary px-3.5 py-3">
          <p className="text-[13px] text-text">
            <strong className="text-text">{count}</strong> {billWord}
            {copies.length > 0 ? (
              <>
                {" × "}
                <strong className="text-text">{copies.length}</strong>{" "}
                {copies.length === 1 ? "copy" : "copies"} = up to{" "}
                <strong className="text-text">{maxDocuments}</strong>{" "}
                {maxDocuments === 1 ? "PDF" : "PDFs"}
              </>
            ) : (
              " — select at least one copy"
            )}
          </p>
          <p className="text-[12px] text-text-muted mt-1">
            Copies a bill does not have are skipped, and the result says how many went in.
            These are the PDFs already stored for each bill; nothing is re-generated.
          </p>
        </div>
      </div>
    </Modal>
  );
}
