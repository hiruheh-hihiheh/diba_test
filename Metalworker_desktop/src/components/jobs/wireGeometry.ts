// src/components/jobs/wireGeometry.ts
//
// Pure geometry for the Bill ↔ Job connection layer. No DOM, no React — so it can be
// unit tested directly, and so the measuring hook, the wire layer and the bill-target
// rail have exactly one definition of what a wire is.
//
// ONE BILL, ONE TARGET
// The rule this file exists to enforce: a bill is drawn ONCE per page however many
// visible jobs point at it. Rendering one chip per connection made three jobs on the
// same invoice look like three invoices, which is the opposite of what the data says.
// So links are grouped by `bill_id`, every wire for that bill terminates on that one
// target, and the grouping key is `bill_id` alone — a bill's jobs may be labour, with
// material, or both, and that makes no difference to where the wires land.
//
// WHY ORTHOGONAL WIRES AND NOT CURVES
// Several rows converging on one target is a schematic, not a set of arcs. Each job gets
// a horizontal stub to a single vertical CONVERGENCE LINE, and one horizontal run goes
// from that line into the badge. Two rows therefore share one visible vertical line
// instead of drawing two curves that merely happen to end in the same place, and no two
// wires cross: curves from rows far apart must cross on the way to a shared midpoint,
// which is exactly the "random crossing lines" this replaces.

import type { JobBillConnection } from "../../types/billJobConnections";

export interface Point {
  x: number;
  y: number;
}

/** One horizontal stub: a job row's anchor to its bill's convergence line. */
export interface WireSegment {
  /** `${jobId}->${billId}` — stable across re-measures, so React can key on it. */
  id: string;
  jobId: string;
  billId: string;
  from: Point;
  to: Point;
}

/** Group a flat link list by the job it belongs to — the count badge's question. */
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

/** A bill target with a position on the page. */
export interface BillNodeBox extends BillNode {
  /** Vertical CENTRE of the badge, in overlay coordinates. */
  y: number;
  /** How many visible rows point at it. */
  jobCount: number;
}

/**
 * One node per unique bill, restricted to jobs that are actually on screen.
 *
 * `mountedJobIds` is what keeps a target from outliving its rows: paginate or search away
 * from a bill and it disappears, because no visible row points at it any more. Filter
 * down to one of three connected jobs and it survives, still drawn once, now with a
 * single wire — which is exactly the behaviour asked for.
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
    const jobs = mountedJobIds ? all.filter((l) => mountedJobIds.has(l.job_id)) : all;
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
  /** Height of one target, used only to keep targets from overlapping. */
  nodeHeight: number;
  /** Smallest vertical gap between two stacked targets. */
  minGap: number;
  /** Top of the drawable area, in overlay coordinates. */
  minY: number;
  /** Bottom of the drawable area, in overlay coordinates. */
  maxY: number;
}

/**
 * Give each target a vertical position.
 *
 * A target wants to sit at the MIDDLE of the rows pointing at it, so its wires fan
 * symmetrically above and below and the group reads as one bundle. That is only a wish:
 * two bills whose jobs interleave on the page would both want the middle, so positions
 * are then pushed apart by a single downward sweep, and if the stack overruns the bottom
 * it is lifted back by a single upward sweep. Two linear passes, no iteration to
 * convergence, no chance of oscillation.
 *
 * Returned top-to-bottom, so paint order is stable frame to frame and a target never
 * appears to jump between rows.
 */
export function layoutBillNodes(
  nodes: BillNode[],
  anchorY: ReadonlyMap<string, number>,
  opts: NodeLayoutOptions
): BillNodeBox[] {
  if (nodes.length === 0) return [];
  const gap = Math.max(opts.minGap, opts.nodeHeight);
  const half = opts.nodeHeight / 2;
  const ceiling = Math.max(opts.minY + half, opts.maxY - half);

  const placed = nodes.map((node) => {
    /* The mean of the rows pointing here. A job with no measured anchor (it was not on
       screen when the geometry was taken) is skipped rather than counted as zero, which
       would drag the target to the top of the page. */
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
    return { node, y: Math.min(Math.max(desired, opts.minY + half), ceiling) };
  });

  placed.sort((a, b) => a.y - b.y);

  /* Downward sweep: nothing may sit closer than `gap` to the target above it. */
  for (let i = 1; i < placed.length; i++) {
    const floor = placed[i - 1].y + gap;
    if (placed[i].y < floor) placed[i].y = floor;
  }

  /* Upward sweep, only if the stack ran off the bottom. */
  const last = placed[placed.length - 1];
  if (last.y > ceiling) {
    const overflow = last.y - ceiling;
    for (const p of placed) p.y -= overflow;
    for (let i = placed.length - 2; i >= 0; i--) {
      const limit = placed[i + 1].y - gap;
      if (placed[i].y > limit) placed[i].y = limit;
    }
    /* Lifting can push the first target above the top; accept that rather than re-running
       the downward sweep, which would undo the lift and oscillate. */
  }

  return placed.map((p) => ({ ...p.node, y: p.y, jobCount: p.node.jobs.length }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   WIRING — the convergence line, and the stubs that feed it
   ═══════════════════════════════════════════════════════════════════════════ */

export interface WiringOptions {
  /** Horizontal gap between the convergence line and the badge's left edge. */
  trunkGap: number;
  /** Corner radius where an outermost stub turns into the convergence line. */
  radius: number;
  /** Clear space kept between a job anchor and the convergence line. */
  minStub: number;
}

export const DEFAULT_WIRING: WiringOptions = { trunkGap: 24, radius: 6, minStub: 10 };

/** One job's arrival at its bill's convergence line. */
export interface StubAnchor {
  jobId: string;
  x: number;
  y: number;
  /** 1 turns down into the line (topmost row), -1 turns up, 0 meets it head-on. */
  turn: -1 | 0 | 1;
}

/** Everything needed to draw one bill's wiring. */
export interface BillWiring {
  billId: string;
  /** The vertical line every wire for this bill shares. */
  trunkX: number;
  /** Left edge of the badge. */
  nodeX: number;
  nodeY: number;
  /** Highest and lowest connected row. */
  topY: number;
  bottomY: number;
  radius: number;
  stubs: StubAnchor[];
}

/**
 * Route one bill's wires.
 *
 * All the jobs pointing at a bill share a single vertical line placed `trunkGap` to the
 * left of the badge, so N jobs produce N short stubs and ONE line, rather than N curves
 * that converge by coincidence. Because the line is at a fixed x per bill and the stubs
 * are all horizontal, no two wires can cross: a stub only ever runs rightwards from its
 * own row to its own bill's line.
 *
 * The line is clamped to stay clear of the job anchors. Without that clamp a narrow
 * viewport would put the line to the LEFT of an anchor, and that job's stub would have to
 * travel backwards — the one case that produces a wire crossing its own row.
 */
export function buildBillWiring(
  node: BillNodeBox,
  anchors: ReadonlyMap<string, Point>,
  nodeX: number,
  opts: WiringOptions = DEFAULT_WIRING
): BillWiring | null {
  const points: { jobId: string; x: number; y: number }[] = [];
  for (const link of node.jobs) {
    const p = anchors.get(link.job_id);
    if (p) points.push({ jobId: link.job_id, x: p.x, y: p.y });
  }
  if (points.length === 0) return null;

  const ys = points.map((p) => p.y);
  const topY = Math.min(...ys);
  const bottomY = Math.max(...ys);
  const rightmost = Math.max(...points.map((p) => p.x));

  /* Prefer the nominal gap; never left of the anchors; never so close to the badge that
     the run into it disappears. */
  const floor = rightmost + opts.minStub;
  const ceiling = nodeX - 4;
  const trunkX = Math.min(ceiling, Math.max(nodeX - opts.trunkGap, floor));

  const stubs: StubAnchor[] = points.map((p) => ({
    jobId: p.jobId,
    x: p.x,
    y: p.y,
    /* Only the two outermost rows TURN into the line. Every row between them meets it
       head-on, which is what keeps a bundle of five jobs to five straight stubs plus one
       line, rather than five elbows. */
    turn: (p.y <= topY + 0.5 && topY < node.y - 0.5
      ? 1
      : p.y >= bottomY - 0.5 && bottomY > node.y + 0.5
        ? -1
        : 0) as -1 | 0 | 1,
  }));

  return {
    billId: node.billId,
    trunkX,
    nodeX,
    nodeY: node.y,
    topY,
    bottomY,
    radius: opts.radius,
    stubs,
  };
}

/**
 * A job's horizontal stub, from its row to the convergence line.
 *
 * `turn` is 0 for every row that meets the line head-on — the overwhelming majority, and
 * the rows in the middle of the bundle — which makes the stub a straight line. Only the
 * topmost and bottommost rows turn a corner, and those get a quarter-round so the wire
 * looks drawn rather than assembled.
 */
export function stubPath(from: Point, trunkX: number, radius: number, turn: -1 | 0 | 1): string {
  const run = trunkX - from.x;
  if (turn === 0 || run <= radius + 0.5) {
    return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${trunkX.toFixed(2)} ${from.y.toFixed(2)}`;
  }
  const endY = from.y + turn * radius;
  return (
    `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} ` +
    `L ${(trunkX - radius).toFixed(2)} ${from.y.toFixed(2)} ` +
    `Q ${trunkX.toFixed(2)} ${from.y.toFixed(2)} ${trunkX.toFixed(2)} ${endY.toFixed(2)}`
  );
}

/**
 * The convergence line plus the single run into the badge.
 *
 * Two subpaths in one path: the vertical line, and the horizontal run that leaves it at
 * the badge's own height. Sharing one path is what keeps the shared line a single
 * stroke — drawn once, so a hover that dims other wires cannot dim half of a bundle's
 * spine while leaving the other half lit.
 *
 * A bill with one visible row has no line at all, just the run into the badge. That is
 * the same picture with one wire instead of several, not a special case.
 */
export function trunkPath(w: BillWiring): string {
  const top = w.topY + (w.stubs.some((s) => s.turn === 1) ? w.radius : 0);
  const bottom = w.bottomY - (w.stubs.some((s) => s.turn === -1) ? w.radius : 0);
  const out = `M ${w.trunkX.toFixed(2)} ${w.nodeY.toFixed(2)} L ${w.nodeX.toFixed(2)} ${w.nodeY.toFixed(2)}`;
  if (bottom - top < 0.5) return out;
  return `M ${w.trunkX.toFixed(2)} ${top.toFixed(2)} L ${w.trunkX.toFixed(2)} ${bottom.toFixed(2)} ${out}`;
}

/** Every path for one bill, ready to hand to the SVG. */
export interface WiringPaths {
  trunk: string;
  stubs: {
    id: string;
    billId: string;
    jobId: string;
    path: string;
    /** The row anchor the stub starts at, so the layer can mark where it leaves the job. */
    from: Point;
  }[];
}

export function wiringPaths(w: BillWiring): WiringPaths {
  return {
    trunk: trunkPath(w),
    stubs: w.stubs.map((s) => ({
      id: `${s.jobId}->${w.billId}`,
      billId: w.billId,
      jobId: s.jobId,
      path: stubPath({ x: s.x, y: s.y }, w.trunkX, w.radius, s.turn),
      from: { x: s.x, y: s.y },
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOVER — one thing hovered, three tiers of response
   ═══════════════════════════════════════════════════════════════════════════ */

/** The DOM attribute names the measuring hook looks for. One place, so they cannot drift. */
export const WIRE_ATTR_ANCHOR = "data-wire-anchor";
/** Marks the space reserved for the shared bill targets. */
export const WIRE_ATTR_RAIL = "data-wire-rail";

/** The attribute value for a row's anchor, given its job id. */
export const anchorAttr = (jobId: string): string => jobId;

/**
 * What the pointer is over.
 *
 * `billIds` is what makes the middle tier possible. Hovering a row that points at two
 * bills must light one wire fully and leave the other readable, not black it out — which
 * needs to know the OTHER bills that row points at, so the caller passes them in rather
 * than the hook looking them up.
 */
export interface WireHover {
  jobId: string | null;
  /** Set when a bill TARGET is hovered, as opposed to a row. */
  billId: string | null;
  /** Bills the hovered job points at, so its sibling wires stay legible. */
  billIds: string[];
}

/** Hovering a job row. Pass the bills that row points at. */
export const hoverJob = (jobId: string, billIds: string[] = []): WireHover => ({
  jobId,
  billId: null,
  billIds,
});

/** Hovering a bill target: everything pointing at that bill. */
export const hoverBill = (billId: string): WireHover => ({ jobId: null, billId, billIds: [billId] });

/** Opacity of a wire that is neither hovered nor a sibling of what is hovered. */
const UNRELATED = 0.1;
/** Opacity of a wire into the same bill as a hovered row: present, but clearly behind. */
const SIBLING = 0.42;
/** Opacity with nothing hovered. */
const RESTING = 0.5;

/**
 * Opacity for one wire.
 *
 * Hovering a bill target puts every one of its wires at full strength and drops
 * everything else back — the case that makes one invoice with five jobs legible.
 * Hovering a ROW puts that row's own wire first and its bill's other wires at
 * `SIBLING`, so the shared destination stays readable instead of being erased, which is
 * the whole point of merging them.
 */
export function wireOpacity(
  segment: Pick<WireSegment, "jobId" | "billId">,
  hovered: WireHover | null
): number {
  if (!hovered) return RESTING;
  if (hovered.billId !== null) return segment.billId === hovered.billId ? 1 : UNRELATED;
  if (hovered.jobId !== null && segment.jobId === hovered.jobId) return 1;
  if (hovered.billIds.includes(segment.billId)) return SIBLING;
  return UNRELATED;
}

/** Opacity for a bill's shared line. Follows the same tiers as the wires it carries. */
export function trunkOpacity(w: BillWiring, hovered: WireHover | null): number {
  if (!hovered) return 0.65;
  if (hovered.billId !== null) return hovered.billId === w.billId ? 1 : UNRELATED;
  if (hovered.jobId !== null && w.stubs.some((s) => s.jobId === hovered.jobId)) return 1;
  if (hovered.billIds.includes(w.billId)) return SIBLING;
  return UNRELATED;
}

/** Stroke width. The emphasised ones are thicker, which reads without relying on colour. */
export function wireWidth(
  segment: Pick<WireSegment, "jobId" | "billId">,
  hovered: WireHover | null
): number {
  return wireOpacity(segment, hovered) === 1 ? 2.5 : 1.75;
}

/**
 * How strongly a bill target should be highlighted: 0 none, 1 it is a hovered row's
 * destination, 2 the pointer is on it.
 *
 * Returning a level rather than a boolean is what lets a hovered row light its shared
 * target without also lighting every other target on the rail.
 */
export function billEmphasis(billId: string, hovered: WireHover | null): 0 | 1 | 2 {
  if (!hovered) return 0;
  if (hovered.billId === billId) return 2;
  if (hovered.billIds.includes(billId)) return 1;
  return 0;
}

/** True when this bill is the one being pointed at. */
export function isBillEmphasised(billId: string, hovered: WireHover | null): boolean {
  return billEmphasis(billId, hovered) === 2;
}