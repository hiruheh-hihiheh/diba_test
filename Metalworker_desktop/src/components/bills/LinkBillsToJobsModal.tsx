// src/components/bills/LinkBillsToJobsModal.tsx
//
// The bill side of linking: ONE bill → N jobs, labour and with-material together.
//
// WHY TWO TABS AND NOT ONE LIST
// The Jobs pages are already split by type, the sidebar has two entries, and the whole
// app treats "Labour" and "With Material (BO)" as different kinds of work. Dropping
// two hundred mixed rows into one checkbox list would undo that and make the list
// unnavigable. Each tab therefore has its own search, its own select-all and its own
// selected count, and selections are kept across both — so a bill can be linked to
// three labour jobs AND two with-material jobs in one operation, which is the case
// the feature actually exists for.
//
// "SELECT ALL" MEANS WHAT IT SAYS
// It selects the rows currently visible in that tab after its search, and the count
// next to the button is that number. It never silently reaches across pages.

import { useEffect, useMemo, useState } from "react";
import { Link2, Search } from "lucide-react";

import Modal from "../ui/Modal";
import { supabase } from "../../lib/supabase";
import { getBillConnections, linkJobsToBill } from "../../services/billJobConnections";
import type { Job, JobType } from "../../types/job";
import { getJobTypeLabel } from "../../types/job";

interface Props {
  open: boolean;
  /** The bill the jobs will be linked to. */
  billId: string;
  /** Shown in the heading so the admin can see which invoice they are editing. */
  billLabel: string;
  onClose: () => void;
  onLinked: (result: { linked: number; alreadyLinked: number }) => void;
}

const TABS: { type: JobType; label: string }[] = [
  { type: "labour", label: "Labour" },
  { type: "with_material", label: "With Material" },
];

export default function LinkBillsToJobsModal({
  open,
  billId,
  billLabel,
  onClose,
  onLinked,
}: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<JobType>("labour");
  const [search, setSearch] = useState("");
  /* One set for BOTH tabs, so switching tabs never loses what was ticked. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    setJobs([]);
    setSearch("");
    setPicked(new Set());
    setLinkedIds(new Set());
    setTab("labour");
    setLoadError(null);
    setSaveError(null);
    setLoading(open);
  }

  useEffect(() => {
    if (!open || !billId) return;
    let cancelled = false;
    void (async () => {
      try {
        /* Both types in one query rather than one per tab, so switching tabs is
           instant and the "already linked" marks are known before anything is
           ticked. */
        const [{ data, error }, links] = await Promise.all([
          supabase
            .from("jobs")
            .select("*")
            .in("job_type", TABS.map((t) => t.type))
            .order("job_no", { ascending: true, nullsFirst: false })
            .limit(2000),
          getBillConnections(billId),
        ]);
        if (cancelled) return;
        if (error) throw new Error(error.message);
        setJobs((data ?? []) as Job[]);
        setLinkedIds(new Set(links.map((l) => l.job_id)));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load jobs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, billId]);

  const byTab = useMemo(() => {
    const map = new Map<JobType, Job[]>();
    for (const t of TABS) map.set(t.type, []);
    for (const job of jobs) map.get(job.job_type)?.push(job);
    return map;
  }, [jobs]);

  const visible = useMemo(() => {
    const list = byTab.get(tab) ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((j) =>
      [j.job_no, j.tool_description, j.tool_part, j.po_status, j.status].some((f) =>
        (f ?? "").toString().toLowerCase().includes(q)
      )
    );
  }, [byTab, tab, search]);

  const visibleIds = useMemo(() => visible.map((j) => j.id), [visible]);
  const allVisiblePicked =
    visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const pickedInTab = (byTab.get(tab) ?? []).filter((j) => picked.has(j.id)).length;
  const willCreate = [...picked].filter((id) => !linkedIds.has(id)).length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!billId || picked.size === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      /* ONE call for every picked job, labour and with-material together. */
      const result = await linkJobsToBill(billId, [...picked]);
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
      title="Link jobs to this bill"
      subtitle={billLabel}
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
            disabled={saving || picked.size === 0 || willCreate === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-sm font-bold text-[var(--theme-primary-text)] hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Link2 size={14} />
            {willCreate === 0 && picked.size > 0
              ? "Already linked"
              : `Link ${picked.size} job${picked.size === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* ── type tabs ── */}
        <div
          role="tablist"
          aria-label="Job type"
          className="flex bg-surface border border-border rounded-xl p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.type;
            const count = (byTab.get(t.type) ?? []).length;
            const pickedCount = (byTab.get(t.type) ?? []).filter((j) => picked.has(j.id)).length;
            return (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.type)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-primary text-[var(--theme-primary-text)] shadow-md shadow-primary/20"
                    : "text-text-muted hover:text-text hover:bg-surface-hover"
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs opacity-70">
                  {pickedCount > 0 ? `${pickedCount}/${count}` : count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── search + select all ── */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-xl border border-border bg-bg px-3">
            <Search size={15} className="text-text-muted shrink-0" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${getJobTypeLabel(tab).toLowerCase()} jobs…`}
              aria-label={`Search ${getJobTypeLabel(tab)} jobs`}
              className="flex-1 bg-transparent py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              setPicked((prev) => {
                const next = new Set(prev);
                if (allVisiblePicked) for (const id of visibleIds) next.delete(id);
                else for (const id of visibleIds) next.add(id);
                return next;
              })
            }
            disabled={visibleIds.length === 0}
            aria-label={
              allVisiblePicked
                ? `Clear the ${visibleIds.length} visible jobs`
                : `Select all ${visibleIds.length} visible jobs`
            }
            className="shrink-0 px-3 py-2 rounded-xl border border-border text-xs font-bold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
          >
            {allVisiblePicked ? "Clear visible" : `Select all ${visibleIds.length}`}
          </button>
        </div>

        <p className="text-xs text-text-muted" aria-live="polite">
          {loading
            ? "Loading jobs…"
            : `${visible.length} ${getJobTypeLabel(tab)} job${visible.length === 1 ? "" : "s"} shown · ${pickedInTab} selected in this tab · ${picked.size} selected overall`}
        </p>

        {loadError && <p className="text-sm text-danger">{loadError}</p>}

        <ul className="max-h-[22rem] overflow-y-auto scrollbar-thin flex flex-col gap-1">
          {visible.map((job) => {
            const checked = picked.has(job.id);
            const already = linkedIds.has(job.id);
            return (
              <li key={job.id}>
                <label
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                    checked ? "border-primary bg-primary-muted" : "border-border hover:bg-surface-hover"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(job.id)}
                    aria-label={`Link job ${job.job_no || job.id}`}
                    className="mt-1 w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-text">
                        {job.job_no || "No job #"}
                      </span>
                      {already && (
                        <span className="px-1.5 py-0.5 rounded bg-connection-muted text-[10px] font-bold uppercase tracking-wide text-connection">
                          Linked
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-text-muted truncate mt-0.5">
                      {[job.tool_description, job.tool_part].filter(Boolean).join(" / ") || "—"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
          {!loading && visible.length === 0 && (
            <li className="text-sm text-text-muted text-center py-6">
              No {getJobTypeLabel(tab).toLowerCase()} jobs match “{search}”.
            </li>
          )}
        </ul>

        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
    </Modal>
  );
}