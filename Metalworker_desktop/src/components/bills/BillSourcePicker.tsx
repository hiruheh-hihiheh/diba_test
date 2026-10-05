// src/components/bills/BillSourcePicker.tsx
//
// "Copy from Previous Bill": find one bill, confirm it, hand back its id.
//
// WHY A MODAL AND NOT A SECOND PAGE
//
// Copying is a choice made in the middle of a task, not a destination. A page would mean
// choosing a source, then choosing a destination, and the destination is always the same —
// the Bill Creator. So this is a dialog over the creator's entry screen, and it returns
// nothing but a bill id.
//
// TWO STEPS, AND THE SECOND ONE IS THE POINT
//
// Search, then confirm. The confirm step exists because a copy is a new financial document
// and the worst possible outcome is copying the wrong bill: the admin gets a bill that
// looks like one they recognise, carrying another customer's name. The confirm step forces
// the source to be read once, in full, on purpose — "You're creating a new bill from
// INV/2024/018, Zaveri & Sons, 14 Mar 2024" — before a single value is read from it.
//
// WHAT IS SHOWN, AND WHY
//
// Invoice number, party, date, job type, linked-job count, and the sheet it came from.
// Sheet name and folder are in the search because those are how an admin who remembers a
// bill *as an imported page* finds it; they are not in the list because they are about
// provenance rather than about the bill. The linked-job count is in the list because
// copying a bill that already has three jobs attached is a decision somebody needs to make
// deliberately — the jobs are NOT copied, and the count is what tells them that.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

import Modal from "../ui/Modal";
import SearchInput from "../ui/SearchInput";
import { fetchBills } from "../../services/bills";
import { getBillConnectionCounts } from "../../services/billJobConnections";
import { formatBillDate, formatJobKind } from "../../services/billFormat";
import type { Bill } from "../../types/bill";

/** How many bills to ask for at a time. Small: this is a picker, not a report. */
const PAGE_SIZE = 25;

export interface BillSourcePickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the confirmed source bill. The original is never modified. */
  onConfirm: (billId: string) => void;
}

export default function BillSourcePicker({ open, onClose, onConfirm }: BillSourcePickerProps) {
  /* A thin shell around a keyed child. The reset-on-close behaviour this dialog needs —
     never reopen pointing at the last bill somebody looked at — is what a fresh mount
     gives for free, so it is expressed as a `key` rather than as a list of setState calls
     in an effect that a fourth piece of state would silently be left out of. */
  if (!open) return null;
  return <BillSourcePickerBody onClose={onClose} onConfirm={onConfirm} />;
}

function BillSourcePickerBody({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (billId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Bill[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number }>>(new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The row the admin picked. Null until they pick one. */
  const [chosen, setChosen] = useState<Bill | null>(null);

  /* Search as the admin types, but not on every keystroke: this is a server query
     against a table that can hold thousands of bills, and a four-letter prefix matches
     most of them. The 250ms is long enough to coalesce a fast typist into one request
     and short enough that it still feels like typing. */
  useEffect(() => {
    let live = true;
    /* The loading flag goes up inside the timer rather than above it, so the effect body
       itself touches no state and the dialog does not render a second time just to say it
       is fetching. `loading` also gates nothing — the previous rows stay on screen while
       the next page loads, which is what makes typing feel continuous. */
    const timer = setTimeout(() => {
      setLoading(true);
      fetchBills({ search: search.trim(), page: 1, pageSize: PAGE_SIZE })
        .then((page) => {
          if (!live) return;
          setRows(page.rows);
          setTotal(page.total);
          /* Counts in a second call rather than a join: the list query is already the
             slowest thing here, and a count per row inline would add a second round trip
             to the critical path of typing. */
          if (page.rows.length === 0) {
            setCounts(new Map());
            return null;
          }
          return getBillConnectionCounts(page.rows.map((row) => row.id)).then((found) => {
            if (live) setCounts(found);
          });
        })
        .catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : "Could not load bills.");
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, search.trim() === "" ? 0 : 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  const escRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (chosen) escRef.current?.focus();
  }, [chosen]);

  const confirm = useCallback(() => {
    if (!chosen) return;
    onConfirm(chosen.id);
  }, [chosen, onConfirm]);

  /* One line describing the source, assembled from the same fields the row showed, so the
     confirmation reads as the same document rather than as a new piece of information. */
  const describe = useMemo(() => {
    if (!chosen) return null;
    return {
      invoice: chosen.invoice_no?.trim() || "no invoice number",
      party: chosen.party_name?.trim() || "no customer named",
      date: formatBillDate(chosen.invoice_date) || "no date",
      kind: formatJobKind(chosen.job_kind) || "no job type",
    };
  }, [chosen]);

  /* Step two: the confirmation. Rendered in the same dialog rather than a second one, so
     Esc and the close button keep meaning "step back" instead of "abandon". */
  if (chosen && describe) {
    return (
      <Modal
        open
        onClose={() => setChosen(null)}
        title="Create from Previous Bill"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Back to the list
            </button>
            <button
              type="button"
              onClick={confirm}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Copy size={16} />
              Copy as Draft
            </button>
          </div>
        }
      >
        <div className="px-6 py-5">
          <p className="text-sm text-text-secondary">
            You&rsquo;re creating a new bill from
          </p>
          <dl className="mt-3 rounded-xl border border-border bg-bg-secondary divide-y divide-border">
            {[
              ["Invoice number", describe.invoice],
              ["Customer", describe.party],
              ["Invoice date", describe.date],
              ["Job type", describe.kind],
              [
                "Jobs already linked to that bill",
                (counts.get(chosen.id)?.total ?? 0) === 0
                  ? "none"
                  : `${counts.get(chosen.id)?.total} — these are NOT copied, and the original keeps them`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="px-4 py-2.5 flex items-baseline gap-4">
                <dt className="w-56 shrink-0 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  {label}
                </dt>
                <dd className="text-sm text-text break-words">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 rounded-xl border border-primary/30 bg-primary-muted/30 px-4 py-3">
            <p className="text-xs font-bold text-primary uppercase tracking-wider mb-1">
              The original is not touched
            </p>
            <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
              <li>
                A new <strong>draft</strong> bill is created. The bill you picked keeps its
                invoice number, its three PDFs and everything else it already had.
              </li>
              <li>
                The draft starts with this bill&rsquo;s customer, address, line items,
                taxes, bank details, terms and letterhead.
              </li>
              <li>
                Fields you are likely to change &mdash; the invoice number, the date, the
                challan numbers &mdash; are kept but highlighted, never cleared.
              </li>
              <li>
                The bill&rsquo;s own business-profile wording is preserved. You can choose to
                use the current profile instead.
              </li>
            </ul>
          </div>

          <button ref={escRef} type="button" className="sr-only">
            Focused while confirming
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Create from Previous Bill"
      subtitle="Pick a bill to copy from. Only its stored data is read — the PDF is never opened or re-parsed."
      size="xl"
    >
      <div className="px-6 py-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          scope="all bills"
          unit="bill"
          resultCount={rows.length}
          totalCount={total}
          placeholder="Invoice number, customer, sheet name, date, job type, folder or bill id"
        />
        {search.trim() !== "" && (
          <p className="mt-1 text-xs text-text-muted">
            Also matches the sheet a bill was imported from, the folder it sits in, and its
            bill id &mdash; because those are how somebody who remembers an invoice as
            &ldquo;the third page of that workbook&rdquo; finds it.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-text-muted">
            <Loader2 size={16} className="animate-spin" />
            Loading bills…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-muted">
            {search.trim() === ""
              ? "No bills yet. Create one first, then it can be copied."
              : "No bill matches that search."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border overflow-hidden">
            {rows.map((row) => {
              const jobs = counts.get(row.id)?.total ?? 0;
              return (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-bold text-text">
                        {row.invoice_no?.trim() || "No invoice number"}
                      </span>
                      <span className="text-sm text-text-secondary truncate">
                        {row.party_name?.trim() || "No customer named"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted flex-wrap">
                      <span>{formatBillDate(row.invoice_date) || "No date"}</span>
                      {formatJobKind(row.job_kind) && <span>&middot; {formatJobKind(row.job_kind)}</span>}
                      <span>&middot; {jobs === 0 ? "no linked jobs" : `${jobs} linked job${jobs === 1 ? "" : "s"}`}</span>
                      {row.sheet_name && <span>&middot; sheet {row.sheet_name}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChosen(row)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-muted text-primary text-xs font-bold hover:bg-primary hover:text-[var(--theme-primary-text)] transition-colors cursor-pointer"
                  >
                    <Check size={14} />
                    Copy
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {total > rows.length && (
          <p className="mt-3 text-xs text-text-muted text-center">
            Showing the first {rows.length}. Narrow the search to see a specific bill.
          </p>
        )}
      </div>
    </Modal>
  );
}
