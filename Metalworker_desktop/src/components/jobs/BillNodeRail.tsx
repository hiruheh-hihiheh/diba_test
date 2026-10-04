// src/components/jobs/BillNodeRail.tsx
//
// The shared bill targets: ONE compact badge per unique bill among the rows on screen.
//
// WHY THIS IS A SEPARATE LAYER AND NOT A CELL
// The problem this solves is duplication. Drawing a chip inside every ConnectionsCell
// draws the same invoice three times when three jobs point at it, and the eye reads three
// invoices. So the bill leaves the row: the row keeps its count, and this rail owns one
// badge per bill with every wire converging on it.
//
// COMPACT ON PURPOSE
// The badge is the size of the count badge it replaces — one line, an icon and a count.
// The invoice number is not painted on it: a rail of wide cards turns the table into a
// dashboard, which is not what was asked for, and the number is what the title, the
// accessible name and the popover are for. It is the wires converging on it, not a label
// on it, that identify which bill it is — hover any wire and its target lights up.
//
// PLACEMENT
// Absolutely positioned inside the same scrolling box as the table, at the vertical
// position `layoutBillNodes` computed: the centre of the rows pointing at it. The layer is
// `pointer-events-none` with `pointer-events-auto` on the badges, so the badges are
// clickable while everything the layer covers — row actions, checkboxes, the other cells —
// is not intercepted. It sits ABOVE the table in the stacking order because a badge behind
// the table's own boxes could not be clicked.

import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";

import AnchoredPopover from "../ui/AnchoredPopover";
import { BILL_NODE_HEIGHT } from "../../hooks/useConnectionWires";
import type { BillNodeBox, WireHover } from "./wireGeometry";
import { billEmphasis } from "./wireGeometry";
import type { JobBillConnection } from "../../types/billJobConnections";
import { jobCountLabel } from "../../types/billJobConnections";

/**
 * What the page already knows about a visible job.
 *
 * Passed in rather than fetched: the target's job list is built from the rows that are
 * MOUNTED, and the page has those rows in hand. `get_job_bill_connections` returns the
 * BILL's fields, not the job's, so asking the database again for job numbers would be one
 * request per opened badge to learn something already in memory.
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
  /* Which badge's popover is open, and the element to anchor it to. Captured from the
     click event rather than read back out of a ref during render: a ref read during render
     is exactly the pattern React's rules forbid, because it makes the output depend on
     something that is not one of the render's inputs. */
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
          const emphasis = billEmphasis(node.billId, hovered);
          return (
            <button
              key={node.billId}
              type="button"
              onMouseEnter={() => onHover({ jobId: null, billId: node.billId, billIds: [node.billId] })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ jobId: null, billId: node.billId, billIds: [node.billId] })}
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
              )} on this bill. Show which jobs`}
              title={`${node.label}${node.partyName ? ` — ${node.partyName}` : ""} · ${jobCountLabel(
                node.jobCount
              )}`}
              className={`pointer-events-auto absolute left-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 font-bold transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-connection ${
                emphasis === 2
                  ? "border-connection bg-connection-muted text-connection shadow-sm shadow-connection/30"
                  : emphasis === 1
                    ? "border-connection/60 bg-connection-muted text-connection"
                    : "border-connection/35 bg-surface/95 text-text-muted hover:border-connection hover:text-connection"
              }`}
              style={{
                top: node.y,
                height: BILL_NODE_HEIGHT,
                transform: "translateY(-50%)",
              }}
            >
              <Link2 size={12} className="text-connection shrink-0" aria-hidden="true" />
              {/* The JOB count, not the bill count. This badge stands for exactly one bill,
                  so "6 Bills" here would contradict the very consolidation it exists to
                  show. */}
              <span className="text-[11px] leading-none">{jobCountLabel(node.jobCount)}</span>
            </button>
          );
        })}
      </div>

      {/* The same portal + viewport-flip machinery the row popover uses, so a badge near
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
            <p className="text-xs font-bold text-text truncate">{openNode.label}</p>
            {openNode.partyName && (
              <p className="text-[11px] text-text-muted truncate mb-2">{openNode.partyName}</p>
            )}
            <ul className="flex flex-col gap-1.5 mt-1">
              {openNode.jobs.map((link) => {
                const meta = jobMeta.get(link.job_id);
                const jobNo = meta?.jobNo ?? null;
                return (
                  <li
                    key={link.job_id}
                    onMouseEnter={() =>
                      onHover({ jobId: null, billId: openNode.billId, billIds: [openNode.billId] })
                    }
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