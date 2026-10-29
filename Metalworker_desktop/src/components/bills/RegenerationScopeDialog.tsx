// src/components/bills/RegenerationScopeDialog.tsx
//
// "Regenerate PDFs" → choose exactly which workbooks.
//
// The list comes from the Edge Function (`list_workbooks`), which is also what
// validates the selection when the job starts, so the eligibility shown here and
// the eligibility enforced there are the same rule. "Select all workbooks" selects
// every eligible workbook in the full list — never just the rows a search shows.
// Standalone Bill Creator bills are a separate, unticked option: choosing
// workbooks never pulls them in silently.
//
// Mounted only while open (see Bills.tsx), so each opening loads a fresh list and
// starts with nothing selected.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import Modal from "../ui/Modal";
import SearchInput from "../ui/SearchInput";
import { listRegenerationWorkbooks } from "../../services/regenerateBillPdfs";
import {
  buildScope,
  eligibleCount,
  filterWorkbookOptions,
  selectAllEligible,
  selectionLabel,
  toggleWorkbook,
  type RegenerationScope,
  type WorkbookOption,
} from "../../services/regenerationModel";

interface Props {
  onCancel: () => void;
  onConfirm: (scope: RegenerationScope) => void;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`w-[18px] h-[18px] shrink-0 rounded-[5px] border flex items-center justify-center ${
        checked ? "bg-primary border-primary text-primary-text" : "border-border-hover bg-surface"
      }`}
      aria-hidden="true"
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

export default function RegenerationScopeDialog({ onCancel, onConfirm }: Props) {
  const [options, setOptions] = useState<WorkbookOption[] | null>(null);
  const [standaloneCount, setStandaloneCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [includeStandalone, setIncludeStandalone] = useState(false);

  useEffect(() => {
    let alive = true;
    listRegenerationWorkbooks()
      .then((res) => {
        if (!alive) return;
        setOptions(res.workbooks);
        setStandaloneCount(res.standalone_count);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo(() => options ?? [], [options]);
  const shown = useMemo(() => filterWorkbookOptions(all, query), [all, query]);
  const scope = buildScope(selected, all, includeStandalone);
  const eligible = eligibleCount(all);

  return (
    <Modal
      open
      onClose={onCancel}
      title="Regenerate PDFs"
      subtitle="Choose the workbooks to rebuild from their saved bill records. No Excel file is uploaded again."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <p className="text-xs text-text-muted hidden sm:block">
            Each workbook&apos;s combined PDFs are replaced only after all three new copies are verified.
          </p>
          <div className="flex gap-2 ml-auto">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!scope} onClick={() => scope && onConfirm(scope)}>
              Regenerate selected
            </button>
          </div>
        </div>
      }
    >
      {error ? (
        <div className="flex items-start gap-2 rounded-lg bg-danger-muted px-3 py-2 text-sm text-text" role="alert">
          <AlertTriangle size={15} className="text-danger mt-0.5 shrink-0" />
          {error}
        </div>
      ) : !options ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-text-muted">
          <Loader2 size={22} className="animate-spin text-primary" />
          Loading workbooks…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            scope="workbooks by filename"
            unit="workbook"
            resultCount={shown.length}
            totalCount={all.length}
            placeholder="Search by filename"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-text tabular-nums" aria-live="polite">
              {selectionLabel(selected, all)}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={eligible === 0}
                onClick={() => setSelected(selectAllEligible(all))}
                title="Selects every eligible workbook, including ones hidden by the search"
              >
                Select all workbooks
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                Deselect all
              </button>
            </div>
          </div>
          {query.trim() !== "" && (
            <p className="text-xs text-text-muted -mt-1">
              &ldquo;Select all workbooks&rdquo; still selects every eligible workbook, not only the ones shown.
            </p>
          )}

          <ul className="max-h-[22rem] overflow-y-auto rounded-xl border border-border divide-y divide-border" aria-label="Workbooks">
            {shown.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-text-muted">
                {all.length === 0 ? "No Excel workbooks have been uploaded." : "No workbook matches that search."}
              </li>
            )}
            {shown.map((o) => {
              const checked = selected.has(o.upload_id);
              const date = formatDate(o.uploaded_at);
              return (
                <li key={o.upload_id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={!o.eligible}
                    onClick={() => setSelected((s) => toggleWorkbook(s, o))}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <CheckBox checked={checked} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-text truncate" title={o.name}>
                        {o.name}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {[`${o.bill_count} ${o.bill_count === 1 ? "bill" : "bills"}`, date ? `uploaded ${date}` : null, o.eligible && !o.has_combined_pdfs ? "no combined PDFs yet" : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {!o.eligible && o.ineligible_reason && (
                        <span className="block text-xs text-warning">Not eligible: {o.ineligible_reason}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {standaloneCount > 0 && (
            <button
              type="button"
              role="checkbox"
              aria-checked={includeStandalone}
              onClick={() => setIncludeStandalone((v) => !v)}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-surface-hover cursor-pointer"
            >
              <CheckBox checked={includeStandalone} />
              <span>
                <span className="block text-sm font-semibold text-text">
                  Also regenerate {standaloneCount} standalone {standaloneCount === 1 ? "bill" : "bills"}
                </span>
                <span className="block text-xs text-text-muted">
                  Bills made in Bill Creator, which belong to no workbook. Not included unless ticked.
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
