// src/components/jobs/LinkJobsToBillModal.tsx
//
// The job side of linking: N selected jobs → ONE bill.
//
// This is the modal the bulk action bar opens. The reverse direction lives in
// `../bills/LinkBillsToJobsModal.tsx`, and the two are deliberately separate doors
// rather than one modal with two modes, because the two questions are genuinely
// different: here the jobs are already chosen and only the bill is open, while there
// the bill is already chosen and the jobs are what has to be picked.
//
// IDEMPOTENCE IS SHOWN, NOT ASSUMED
// Jobs already linked to the chosen bill are marked as such in the list before
// anything is submitted, and the confirm button says how many links will actually be
// created. A job that is already linked is still selectable, because re-running the
// link is harmless — the database absorbs it — and silently dropping it from the list
// would read as "this job cannot be linked to that bill".

import { useEffect, useMemo, useState } from "react";
import { FileText, Link2, Search } from "lucide-react";

import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";
import { getBillConnections, linkJobsToBill } from "../../services/billJobConnections";
import type { Bill } from "../../types/bill";

interface Props {
  open: boolean;
  /** The jobs the user has selected. Their numbers are named in the dialog. */
  jobIds: string[];
  /** e.g. "Labour" — used in the "N selected" line. */
  jobTypeLabel: string;
  onClose: () => void;
  /** Called after a successful link so the page can refresh counts and wires. */
  onLinked: (result: { linked: number; alreadyLinked: number }) => void;
}

/** Shared empty set, so deriving "nothing is linked" allocates nothing per render. */
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export default function LinkJobsToBillModal({
  open,
  jobIds,
  jobTypeLabel,
  onClose,
  onLinked,
}: Props) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [alreadyLinked, setAlreadyLinked] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* Reset on open/close DURING RENDER, the pattern `BillFolderPickerModal` uses in the
     admin app: reopening never shows the previous search, the previous bill, or a
     stale "already linked" set, and the loading flag is already correct by the time
     the fetch effect runs. */
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    setBills([]);
    setSearch("");
    setChosen(null);
    setAlreadyLinked(new Set());
    setLoadError(null);
    setSaveError(null);
    setLoading(open);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("bills")
          .select("id, invoice_no, party_name, sheet_name, invoice_date, job_kind")
          .order("invoice_date", { ascending: false, nullsFirst: false })
          .limit(300);
        if (cancelled) return;
        if (error) throw new Error(error.message);
        setBills((data ?? []) as Bill[]);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load bills.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /* Which of the selected jobs are already linked to the bill under the cursor. Only
     fetched when a bill is actually chosen, and derived to "none" when none is, so
     there is no state to clear. */
  useEffect(() => {
    if (!open || !chosen) return;
    let cancelled = false;
    void (async () => {
      try {
        const links = await getBillConnections(chosen);
        if (cancelled) return;
        const wanted = new Set(jobIds);
        setAlreadyLinked(new Set(links.filter((l) => wanted.has(l.job_id)).map((l) => l.job_id)));
      } catch {
        if (!cancelled) setAlreadyLinked(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, chosen, jobIds]);

  /* No bill chosen means nothing can be "already linked". */
  const linkedAlready = chosen ? alreadyLinked : EMPTY_SET;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bills;
    return bills.filter((b) =>
      [b.invoice_no, b.party_name, b.sheet_name, b.job_kind].some((f) =>
        (f ?? "").toString().toLowerCase().includes(q)
      )
    );
  }, [bills, search]);

  const willCreate = chosen ? jobIds.length - linkedAlready.size : 0;

  const submit = async () => {
    if (!chosen || jobIds.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await linkJobsToBill(chosen, jobIds);
      onLinked(result);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not link these jobs.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Link selected jobs to a bill"
      subtitle={`${jobIds.length} ${jobTypeLabel} job${jobIds.length === 1 ? "" : "s"} selected`}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !chosen || willCreate === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-sm font-bold text-[var(--theme-primary-text)] hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Link2 size={14} />
            {willCreate === 0
              ? "Already linked"
              : `Link ${willCreate} job${willCreate === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3">
          <Search size={15} className="text-text-muted shrink-0" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bill number, customer, invoice…"
            aria-label="Search bills"
            className="flex-1 bg-transparent py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:outline-none"
          />
        </div>

        <p className="text-xs text-text-muted" aria-live="polite">
          {loading
            ? "Loading bills…"
            : `${filtered.length} bill${filtered.length === 1 ? "" : "s"}`}
        </p>

        {loadError && <p className="text-sm text-danger">{loadError}</p>}

        <ul className="max-h-[22rem] overflow-y-auto scrollbar-thin flex flex-col gap-1">
          {filtered.map((bill) => {
            const selected = chosen === bill.id;
            const label = bill.invoice_no?.trim() || bill.sheet_name?.trim() || "this bill";
            return (
              <li key={bill.id}>
                <button
                  type="button"
                  onClick={() => setChosen(bill.id)}
                  aria-pressed={selected}
                  className={`w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                    selected
                      ? "border-primary bg-primary-muted"
                      : "border-border hover:bg-surface-hover"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      selected ? "border-primary" : "border-border"
                    }`}
                  >
                    {selected && <span className="w-2 h-2 rounded-full bg-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <FileText size={13} className="text-text-muted shrink-0" aria-hidden="true" />
                      <span className="text-sm font-bold text-text truncate">{label}</span>
                    </span>
                    {bill.party_name && (
                      <span className="block text-xs text-text-muted truncate mt-0.5">
                        {bill.party_name}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          {!loading && filtered.length === 0 && (
            <li className="text-sm text-text-muted text-center py-6">
              No bills match “{search}”.
            </li>
          )}
        </ul>

        {linkedAlready.size > 0 && (
          <p className="text-xs text-text-muted">
            {linkedAlready.size} of the selected jobs are already linked to this bill. They
            will be left as they are — linking again changes nothing.
          </p>
        )}

        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
    </Modal>
  );
}