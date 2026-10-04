// src/components/jobs/BillNodeRail.tsx
//
// The right-hand rail: ONE card per unique bill among the rows on screen.
//
// WHY THIS IS A SEPARATE LAYER AND NOT A CELL
// The problem this solves is duplication. Rendering a chip inside every ConnectionsCell
// draws the same invoice three times when three jobs point at it, and the eye reads
// three invoices. So the bill leaves the row entirely: the row keeps a compact count,
// and the rail owns one card per bill with every wire converging on it.
//
// PLACEMENT
// Absolutely positioned inside the same scrolling box as the table, at the vertical
// position `layoutBillNodes` computed. The layer is `pointer-events-none` with
// `pointer-events-auto` on the cards themselves, so the cards are clickable while
// everything the layer covers — row actions, checkboxes, the other cells — is not
// intercepted. It sits ABOVE the table in the stacking order because a card behind the
// table's own boxes could not be clicked.
//
// ABOVE THE TABLE, BUT NOT OVER THE FROZEN COLUMN
// The Actions column is `sticky` with an opaque background. A card at this z-index
// would paint on top of it, so the rail is clipped to the columns that precede it.

import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";

import AnchoredPopover from "../ui/AnchoredPopover";
import type { BillNodeBox, WireHover } from "./wireGeometry";
import { isBillEmphasised } from "./wireGeometry";
import type { JobBillConnection } from "../../types/billJobConnections";
import { jobCountLabel } from "../../types/billJobConnections";

/**
 * What the page already knows about a visible job.
 *
 * Passed in rather than fetched: the node's job list is built from the rows that are
 * MOUNTED, and the page has those rows in hand. `get_job_bill_connections` returns the
 * BILL's fields, not the job's, so asking the database again for job numbers would be
 * one request per opened card to learn something already in memory.
 */
export interface RailJobMeta {
  jobNo: string | null;
  jobType: "labour" | "with_material";
}

interface Props {
  nodes: BillNodeBox[];
  railX: number;
  railWidth: number;
  height: number;
  hovered: WireHover | null;
  /** Job id -> number and type, for the rows currently on screen. */
  jobMeta: Map<string, RailJobMeta>;
  onHover: (hover: WireHover | null) => void;
  onUnlink: (node: BillNodeBox, link: JobBillConnection) => void;
  busy?: boolean;
}

export default function BillNodeRail({
  nodes,
  railX,
  railWidth,
  height,
  hovered,
  jobMeta,
  onHover,
  onUnlink,
  busy = false,
}: Props) {
  /* Which card's popover is open, and the element to anchor it to.
     Captured from the click event rather than read back out of a ref during render:
     a ref read during render is exactly the pattern React's rules forbid, because it
     makes the output depend on something that is not part of the render's inputs. */
  const [open, setOpen] = useState<{ billId: string; anchor: HTMLButtonElement } | null>(null);

  if (nodes.length === 0 || railWidth <= 0) return null;

  const openNode = open ? nodes.find((n) => n.billId === open.billId) : undefined;

  return (
    <>
      <div
        aria-hidden={open ? undefined : true}
        className="absolute top-0 z-[3] pointer-events-none"
        style={{ left: railX, width: railWidth, height }}
      >
        {nodes.map((node) => {
          const emphasised = isBillEmphasised(node.billId, hovered);
          return (
            <button
              key={node.billId}
              type="button"
              onMouseEnter={() => onHover({ jobId: null, billId: node.billId })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ jobId: null, billId: node.billId })}
              onBlur={() => onHover(null)}
              onClick={(e) =>
                setOpen((v) =>
                  v?.billId === node.billId ? null : { billId: node.billId, anchor: e.currentTarget }
                )
              }
              aria-expanded={open?.billId === node.billId}
              aria-haspopup="dialog"
              aria-label={`${node.label}${node.partyName ? `, ${node.partyName}` : ""}. ${jobCountLabel(
                node.jobCount
              )}. Show which jobs`}
              title={`${node.label} — ${jobCountLabel(node.jobCount)}`}
              className={`pointer-events-auto absolute left-0 flex items-center gap-2 rounded-lg border px-2 py-1 text-left transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-connection ${
                emphasised
                  ? "border-connection bg-connection-muted shadow-md shadow-connection/20"
                  : "border-connection/30 bg-surface hover:border-connection hover:bg-connection-muted"
              }`}
              style={{ top: node.y, height: 46, transform: "translateY(-50%)" }}
            >
              <Link2 size={13} className="text-connection shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-text truncate leading-tight">
                  {node.label}
                </span>
                <span className="block text-[11px] text-text-muted truncate leading-tight">
                  {node.partyName ? `${node.partyName} · ` : ""}
                  {jobCountLabel(node.jobCount)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The same portal + viewport-flip machinery the row popover uses, so a card near
          the bottom of a long table opens upward instead of being clipped by the table's
          scroll container. */}
      <AnchoredPopover
        open={!!openNode}
        anchorRef={{ current: open?.anchor ?? null }}
        onClose={() => setOpen(null)}
        ariaLabel={`Jobs linked to ${openNode?.label ?? "this bill"}`}
      >
        {openNode && (
          <>
            <p className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
              Jobs on this bill
            </p>
            <ul className="flex flex-col gap-1.5">
              {openNode.jobs.map((link) => {
                const meta = jobMeta.get(link.job_id);
                const jobNo = meta?.jobNo ?? null;
                return (
                  <li
                    key={link.job_id}
                    onMouseEnter={() => onHover({ jobId: null, billId: openNode.billId })}
                    onMouseLeave={() => onHover(null)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-text truncate">
                        {jobNo || "No job #"}
                      </span>
                      <span className="block text-[11px] text-text-muted truncate">
                        {meta?.jobType === "with_material" ? "With Material" : "Labour"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onUnlink(openNode, link)}
                      disabled={busy}
                      aria-label={`Unlink job ${jobNo || link.job_id} from this bill`}
                      title={`Unlink ${jobNo || "this job"}`}
                      className="shrink-0 rounded-md p-1 text-text-muted hover:text-danger hover:bg-danger-muted transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
              Unlinking removes only the connection. The bill and the job are untouched.
            </p>
          </>
        )}
      </AnchoredPopover>
    </>
  );
}