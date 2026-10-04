// src/components/jobs/connectionWires.ts
//
// Pure geometry for the Bill ↔ Job connection wires. No DOM, no React — so it can be
// unit tested directly, and so the measuring hook and the SVG component have exactly
// one definition of what a wire is.

import type { JobBillConnection } from "../../types/billJobConnections";

export interface Point {
  x: number;
  y: number;
}

/** One drawn wire: a job row's anchor to one bill chip. */
export interface WireSegment {
  /** `${jobId}:${billId}` — stable across re-measures, so React can key on it. */
  id: string;
  jobId: string;
  billId: string;
  from: Point;
  to: Point;
  /** Shortest distance between the endpoints. Used to keep the curve sane. */
  span: number;
}

/**
 * A cubic bezier whose control points leave and arrive horizontally.
 *
 * Horizontal tangents are what make a bundle of wires read as a bundle: every wire
 * leaves its row in the same direction and arrives at its chip in the same direction,
 * so the eye follows them across the gap instead of seeing a set of unrelated arcs.
 *
 * The handle is pushed AWAY from each endpoint along the direction of travel, so a
 * wire drawn rightwards bows right and one drawn leftwards bows left. Computing the
 * handle as an unsigned amount instead sent a leftward wire's first control point off
 * to the right, so the curve doubled back on itself before reaching its target.
 *
 * The handle is a third of the gap, clamped, so two wires whose endpoints nearly
 * touch do not bulge past each other. A zero-length gap gets the minimum handle,
 * which degenerates to a straight vertical line rather than a divide by zero.
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
 * The wires are drawn per job, so keeping each job's links together is what lets the
 * measuring pass walk the DOM once per row instead of once per link. Insertion order
 * is preserved so the chips and their wires stay in the same order on screen.
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

/** The DOM attribute names the measuring hook looks for. One place, so they cannot drift. */
export const WIRE_ATTR_ANCHOR = "data-wire-anchor";
export const WIRE_ATTR_NODE = "data-wire-node";

/** The attribute value for a row's anchor, given its job id. */
export const anchorAttr = (jobId: string): string => jobId;

/** The attribute value for a bill chip, given the job and bill it belongs to. */
export const nodeAttr = (jobId: string, billId: string): string => `${jobId}:${billId}`;

/**
 * Opacity for a wire, given what is hovered.
 *
 * Hovering one relationship emphasises it and dims the rest; nothing hovered leaves
 * everything at rest. This is deliberately a two-state calculation rather than a CSS
 * class per wire, so the hover response cannot be left half-styled on one of them.
 */
export function wireOpacity(
  segment: Pick<WireSegment, "jobId" | "billId">,
  hovered: { jobId: string; billId: string } | null
): number {
  if (!hovered) return 0.55;
  const sameJob = hovered.jobId === segment.jobId;
  const samePair = sameJob && hovered.billId === segment.billId;
  if (samePair) return 1;
  // A job's own other wires stay moderately visible so the shape of its bundle is
  // still readable; only unrelated jobs fade out.
  return sameJob ? 0.4 : 0.12;
}

/** Stroke width for a wire. The hovered one is thicker, which reads at a glance. */
export function wireWidth(
  segment: Pick<WireSegment, "jobId" | "billId">,
  hovered: { jobId: string; billId: string } | null
): number {
  if (!hovered) return 2;
  return hovered.jobId === segment.jobId && hovered.billId === segment.billId ? 3 : 1.5;
}