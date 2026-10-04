// src/components/bills/BillConnectionsPanel.tsx
//
// "Which jobs is this bill for?" — the read side of the bill's connections.
//
// A MODAL, NOT A PAGE
// Inspecting a relationship should not cost a navigation. The user opened this from a
// cell in a list they are working down, and making them leave and come back loses that
// place. Everything here is available without leaving: the job numbers, both job
// types, when the link was made, and an Unlink per row.
//
// THE TWO JOB TYPES ARE SEPARATE LISTS
// Same reason as the link picker, and same reason as the rest of the app: labour and
// with-material are different kinds of work and mixing two hundred rows into one
// scroll is how a connection gets missed.

import { Loader2, Trash2 } from "lucide-react";

import Modal from "../ui/Modal";
import type { BillJobConnection } from "../../types/billJobConnections";
import type { JobType } from "../../types/job";
import { getJobTypeLabel } from "../../types/job";

interface Props {
  open: boolean;
  billLabel: string;
  connections: BillJobConnection[];
  loading: boolean;
  onClose: () => void;
  onUnlink: (connection: BillJobConnection) => void;
  /** Opens the "add jobs" picker for this same bill. */
  onAddJobs: () => void;
}

const SECTIONS: { type: JobType; heading: string }[] = [
  { type: "labour", heading: "Labour" },
  { type: "with_material", heading: "With Material" },
];

export default function BillConnectionsPanel({
  open,
  billLabel,
  connections,
  loading,
  onClose,
  onUnlink,
  onAddJobs,
}: Props) {
  const grouped = SECTIONS.map((section) => ({
    ...section,
    rows: connections.filter((c) => c.job_type === section.type),
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Linked jobs"
      subtitle={billLabel}
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onAddJobs}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-sm font-bold text-[var(--theme-primary-text)] hover:bg-primary-hover transition-colors cursor-pointer"
          >
            Link more jobs
          </button>
        </>
      }
    >
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-text-muted py-4">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          Loading linked jobs…
        </p>
      ) : connections.length === 0 ? (
        <p className="text-sm text-text-muted py-4">
          This bill is not linked to any jobs yet. Use “Link more jobs” to connect it to
          labour and/or with-material work.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((section) => (
            <section key={section.type} aria-label={section.heading}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                {section.heading}
                <span className="ml-1.5 font-semibold normal-case tracking-normal">
                  ({section.rows.length})
                </span>
              </h3>
              {section.rows.length === 0 ? (
                <p className="text-xs text-text-muted/70">None linked.</p>
              ) : (
                <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto scrollbar-thin">
                  {section.rows.map((row) => (
                    <li
                      key={row.job_id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-text">
                          {row.job_no || "No job #"}
                        </span>
                        <span className="block text-xs text-text-muted truncate">
                          {[row.tool_description, row.tool_part].filter(Boolean).join(" / ") ||
                            getJobTypeLabel(row.job_type)}
                        </span>
                        <span className="block text-[11px] text-text-muted/80">
                          Linked {new Date(row.linked_at).toLocaleDateString()}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onUnlink(row)}
                        disabled={loading}
                        aria-label={`Unlink job ${row.job_no || row.job_id} from this bill`}
                        title="Unlink this job from this bill"
                        className="shrink-0 rounded-md p-1.5 text-text-muted hover:text-danger hover:bg-danger-muted transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <p className="text-[11px] text-text-muted border-t border-border pt-2">
            Unlinking removes only the connection. Neither the bill nor the job is deleted.
          </p>
        </div>
      )}
    </Modal>
  );
}