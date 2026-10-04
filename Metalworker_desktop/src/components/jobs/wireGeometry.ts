// src/components/jobs/wireGeometry.ts
//
// Pure geometry for the Bill ↔ Job connection layer. No DOM, no React — so it can be
// unit tested directly, and so the measuring hook, the wire layer and the bill-node
// rail have exactly one definition of what a wire and a node are.
//
// ONE BILL, ONE NODE
// The rule this file exists to enforce: a bill is drawn ONCE per page however many
// visible jobs point at it. Rendering one chip per connection made three jobs on the
// same invoice look like three invoices, which is the opposite of what the data says.
// So links are grouped by `bill_id` into a node, every wire for that bill terminates on
// that one node, and the node's own text names the invoice.

import type { JobBillConnection } from "../../types/billJobConnections";

export interface Point {
  x: number;
  y: number;
}

/** One drawn wire: a job row's anchor to a bill node's edge. */
export interface WireSegment {
  /** `${jobId}->${billId}` — stable across re-measures, so React can key on it. */
  id: string;
  jobId: string;
  billId: string;
  from: Point;
  to: Point;
}

/**
 * A cubic bezier whose control points leave and arrive horizontally.
 *
 * Horizontal tangents are what make a bundle of wires read as a bundle: every wire
 * leaves its row in the same direction and arrives at its node in the same direction,
 * so several rows converging on one node look like one deliberate junction rather than
 * a set of unrelated arcs.
 *
 * The handle is pushed AWAY from each endpoint along the direction of travel, so a
 * wire drawn rightwards bows right and one drawn leftwards bows left. Computing the
 * handle as an unsigned amount instead sent a leftward wire's first control point off
 * to the right, so the curve doubled back on itself before reaching its target.
 *
 * The handle is a third of the gap, clamped, so two wires whose endpoints nearly touch
 * do not bulge past each other. A zero-length gap gets the minimum handle, which
 * degenerates to a straight vertical line rather than a divide by zero.
 */
export function wirePath(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const handle = Math.max(12, Math.min(Math.abs(dx) / 3, 70));
  const direction = Math.sign(dx);
  const c1 = { x: from.x + handle * direction, y: from.y };
  const c2 = { x: to.x - handle * direction, y: to.y };
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(
    2
  )}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

/**
 * Group a flat link list by the job it belongs to.
 *
 * The count badge is per job, so this is what answers "how many bills is this job
 * linked to". Insertion order is preserved so the badge's list order matches the order
 * the wires are drawn in.
 */
export function groupLinksByJob(
  links: JobBillConnection[]
): Map<string, JobBillConnection[]> {
  const grouped = new Map<string, JobBillConnection[]>();
  for (const link of links) {
    const list = grouped.get(link.job_id);
    if (list) list.push(link);
    else grouped.set(link.job_id, [link]);
  }
  return grouped;
}

/** Group by the BILL, which is the whole point: one entry per unique invoice. */
export function groupLinksByBill(
  links: JobBillConnection[]
): Map<string, JobBillConnection[]> {
  const grouped = new Map<string, JobBillConnection[]>();
  for (const link of links) {
    const list = grouped.get(link.bill_id);
    if (list) list.push(link);
    else grouped.set(link.bill_id, [link]);
  }
  return grouped;
}

/** One bill, drawn once, with every visible job that points at it. */
export interface BillNode {
  billId: string;
  label: string;
  partyName: string | null;
  /** The links that arrived here, in the order they were seen. */
  jobs: JobBillConnection[];
}

/** A bill node with a position on the page. */
export interface BillNodeBox extends BillNode {
  /** Vertical CENTRE of the node, in overlay coordinates. */
  y: number;
  /** How many rows point at this node. Drives the "N Jobs" line on it. */
  jobCount: number;
}

/**
 * One node per unique bill, restricted to jobs that are actually on screen.
 *
 * `mountedJobIds` is what keeps a node from outliving its rows: paginate away from a
 * bill and it disappears, because no mounted row points at it any more. Passing null
 * skips the filter, which is only useful in a test.
 *
 * The label and party name come from the FIRST link seen for that bill. They cannot
 * disagree — they are read from the same `bills` row on every link — so taking one is
 * not a choice between competing values.
 */
export function buildBillNodes(
  links: JobBillConnection[],
  mountedJobIds?: ReadonlySet<string> | null
): BillNode[] {
  const grouped = groupLinksByBill(links);
  const nodes: BillNode[] = [];
  for (const [billId, all] of grouped) {
    const jobs = mountedJobIds
      ? all.filter((l) => mountedJobIds.has(l.job_id))
      : all;
    if (jobs.length === 0) continue;
    nodes.push({
      billId,
      label: jobs[0].label,
      partyName: jobs[0].party_name ?? null,
      jobs,
    });
  }
  return nodes;
}

export interface NodeLayoutOptions {
  /** Height of one node, used only to keep nodes from overlapping. */
  nodeHeight: number;
  /** Smallest vertical gap between two nodes. */
  minGap: number;
  /** Top of the drawable area, in overlay coordinates. */
  minY: number;
  /** Bottom of the drawable area, in overlay coordinates. */
  maxY: number;
}

/**
 * Give each node a vertical position.
 *
 * A node wants to sit at the MIDDLE of the rows pointing at it, so the wires into it
 * fan symmetrically above and below and the group reads as one bundle. That is only a
 * wish: two bills whose jobs interleave on the page would both want the middle, so the
 * positions are then pushed apart by a single downward sweep, and if the stack
 * overruns the bottom it is lifted back by a single upward sweep. Two linear passes,
 * no iteration to convergence, no chance of oscillation.
 *
 * Nodes are returned top-to-bottom, so painting order is stable frame to frame.
 */
export function layoutBillNodes(
  nodes: BillNode[],
  anchorY: ReadonlyMap<string, number>,
  opts: NodeLayoutOptions
): BillNodeBox[] {
  if (nodes.length === 0) return [];
  const gap = Math.max(opts.minGap, opts.nodeHeight);
  const half = opts.nodeHeight / 2;

  const placed = nodes.map((node) => {
    /* The mean of the rows pointing here. A job with no measured anchor (it was not on
       screen when the geometry was taken) is skipped rather than counted as zero,
       which would drag the node to the top of the page. */
    let sum = 0;
    let n = 0;
    for (const link of node.jobs) {
      const y = anchorY.get(link.job_id);
      if (typeof y === "number") {
        sum += y;
        n += 1;
      }
    }
    const desired = n > 0 ? sum / n : opts.minY + half;
    return {
      node,
      y: Math.min(Math.max(desired, opts.minY + half), Math.max(opts.minY + half, opts.maxY - half)),
    };
  });

  placed.sort((a, b) => a.y - b.y);

  /* Downward sweep: nothing may sit closer than `gap` to the node above it. */
  for (let i = 1; i < placed.length; i++) {
    const floor = placed[i - 1].y + gap;
    if (placed[i].y < floor) placed[i].y = floor;
  }

  /* Upward sweep, only if the stack ran off the bottom. */
  const last = placed[placed.length - 1];
  const ceiling = Math.max(opts.minY + half, opts.maxY - half);
  if (last.y > ceiling) {
    const overflow = last.y - ceiling;
    for (const p of placed) p.y -= overflow;
    for (let i = placed.length - 2; i >= 0; i--) {
      const limit = placed[i + 1].y - gap;
      if (placed[i].y > limit) placed[i].y = limit;
    }
    /* Lifting the stack can push the first node above the top; accept that rather than
       re-running the downward sweep, which would undo the lift and oscillate. */
  }

  return placed.map((p) => ({ ...p.node, y: p.y, jobCount: p.node.jobs.length }));
}

/** The DOM attribute names the measuring hook looks for. One place, so they cannot drift. */
export const WIRE_ATTR_ANCHOR = "data-wire-anchor";
/** Marks the cell the bill-node rail is positioned within. */
export const WIRE_ATTR_RAIL = "data-wire-rail";

/** The attribute value for a row's anchor, given its job id. */
export const anchorAttr = (jobId: string): string => jobId;

/**
 * What the pointer is over. Either half may be null: hovering a row means "this job's
 * wires", hovering a bill node means "everything pointing at this bill". Modelling it
 * as one object rather than two flags keeps the caller from having to remember which
 * combinations are meaningful.
 */
export interface WireHover {
  jobId: string | null;
  billId: string | null;
}

/** Hovering a row. */
export const hoverJob = (jobId: string): WireHover => ({ jobId, billId: null });
/** Hovering a bill node. */
export const hoverBill = (billId: string): WireHover => ({ jobId: null, billId });

/**
 * Opacity for a wire.
 *
 * With nothing hovered every wire rests. Otherwise a wire is at full strength if it
 * touches whatever is hovered — a row's wires, or ALL the wires into a bill, which is
 * the case that makes one invoice with five jobs legible — and everything unrelated
 * drops right back so the emphasised group is unmistakable.
 */
export function wireOpacity(
  segment: Pick<WireSegment, "jobId" | "billId">,
  hovered: WireHover | null
): number {
  if (!hovered) return 0.55;
  if (hovered.jobId !== null && segment.jobId === hovered.jobId) return 1;
  if (hovered.billId !== null && segment.billId === hovered.billId) return 1;
  return 0.12;
}

/** Stroke width for a wire. The emphasised ones are thicker, which reads without colour. */
export function wireWidth(
  segment: Pick<WireSegment, "jobId" | "billId">,
  hovered: WireHover | null
): number {
  if (!hovered) return 2;
  return wireOpacity(segment, hovered) === 1 ? 3 : 1.5;
}

/** True when this bill is the one being pointed at, so its node can be highlighted. */
export function isBillEmphasised(billId: string, hovered: WireHover | null): boolean {
  return !!hovered && hovered.billId === billId;
}