// src/hooks/useConnectionWires.ts
//
// Measures where the connection wires and the shared bill targets go.
//
// WHY THE LAYER LIVES INSIDE THE SCROLL CONTAINER
// The obvious implementation is a `position: fixed` layer plus a scroll listener that
// re-reads every row's `getBoundingClientRect()`. That is the version that breaks: it is
// wrong for one frame on every scroll event, it needs the container, the window and a
// ResizeObserver all wired up, and it re-measures the whole table sixty times a second on
// a trackpad.
//
// Instead the layer is absolutely positioned inside the SAME scrolling box as the table.
// The browser then moves the table, the wires and the targets together as one layer, so
// scrolling — vertical or horizontal — cannot desynchronise them at all, with no listener
// and no re-measure. What is left to measure is only what actually moves the boxes
// relative to each other: a reflow from a resize, a filter changing which rows exist, a
// page change, a link being added or removed, and the container resizing.
//
// WHY ONLY MOUNTED ROWS COUNT
// The DOM is queried for the rows that exist right now, so a table of two thousand jobs
// at fifty to a page measures fifty rows. That same set of mounted ids is what decides
// which bill targets exist: one is drawn only while some visible row points at it, so
// searching or paging away from a bill removes its target without extra bookkeeping, and
// searching down to one of three connected rows keeps the target with a single wire.
//
// WHY TARGETS ARE COMPUTED, NOT MEASURED
// A target's position is derived from the rows pointing at it, not read back from the
// DOM. Measuring would be circular — it would need a position before it could be
// rendered, and rendering would move it. Computing also lets the overlap resolution and
// the wire routing run as pure arithmetic that a unit test can check.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  DEFAULT_WIRING,
  WIRE_ATTR_ANCHOR,
  WIRE_ATTR_RAIL,
  buildBillNodes,
  buildBillWiring,
  layoutBillNodes,
  type BillNodeBox,
  type BillWiring,
  type Point,
  type WireHover,
  type WiringOptions,
} from "../components/jobs/wireGeometry";
import type { JobBillConnection } from "../types/billJobConnections";

interface Options {
  /** The relatively-positioned box that contains the table, the SVG and the targets. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The links to draw. Only those whose row is mounted become a wire. */
  links: JobBillConnection[];
  /** Show Links is on. When false nothing is measured at all. */
  enabled: boolean;
  /**
   * Anything that moves a box without changing the link list: a search, a page change, a
   * folder switch, a finished fetch. A plain string rather than a counter, because the
   * caller declares WHAT invalidates the geometry and this hook owns WHEN to re-measure.
   */
  measureKey?: string;
  /** Overridable so the routing can be exercised at other sizes. */
  wiring?: WiringOptions;
}

const NO_KEY = "";
/** Height of one bill target, in pixels. Fixed so the layout maths needs no measuring. */
export const BILL_NODE_HEIGHT = 28;
/** Smallest gap between two stacked targets. */
const NODE_MIN_GAP = 8;
/** Horizontal breathing room inside the reserved rail. */
const RAIL_PADDING = 6;

export interface WireGeometry {
  /** One entry per unique bill among the visible rows. */
  wirings: BillWiring[];
  /** One entry per unique bill among the visible rows, positioned. */
  nodes: BillNodeBox[];
  /** Left edge and usable width of the reserved rail, in overlay coordinates. */
  railX: number;
  railWidth: number;
  /** Width and height the SVG must cover. */
  width: number;
  height: number;
}

const EMPTY: WireGeometry = {
  wirings: [],
  nodes: [],
  railX: 0,
  railWidth: 0,
  width: 0,
  height: 0,
};

export function useConnectionWires({
  containerRef,
  links,
  enabled,
  measureKey = NO_KEY,
  wiring = DEFAULT_WIRING,
}: Options): WireGeometry {
  const [geometry, setGeometry] = useState<WireGeometry>(EMPTY);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      setGeometry(EMPTY);
      return;
    }

    /* Every read happens before any write, in one pass, so the measuring loop cannot
       interleave with layout and force the browser to reflow twice per frame. */
    const base = container.getBoundingClientRect();

    /* Where the reserved rail sits. Absent means Show Links is off, which is the case
       for the whole table whenever the visualisation is hidden. */
    const railEl = container.querySelector<HTMLElement>(`[${WIRE_ATTR_RAIL}]`);
    if (!railEl) {
      setGeometry(EMPTY);
      return;
    }
    const railRect = railEl.getBoundingClientRect();
    const railX = railRect.left - base.left + RAIL_PADDING;
    const railWidth = Math.max(0, railRect.width - RAIL_PADDING * 2);

    /* The rows that exist right now, in overlay coordinates. */
    const anchors = new Map<string, Point>();
    for (const el of container.querySelectorAll<HTMLElement>(`[${WIRE_ATTR_ANCHOR}]`)) {
      const jobId = el.getAttribute(WIRE_ATTR_ANCHOR);
      if (!jobId) continue;
      const r = el.getBoundingClientRect();
      anchors.set(jobId, { x: r.right - base.left, y: r.top + r.height / 2 - base.top });
    }

    const anchorY = new Map<string, number>();
    for (const [jobId, p] of anchors) anchorY.set(jobId, p.y);

    /* One target per unique bill, over the rows that are actually on screen. */
    const nodes = layoutBillNodes(buildBillNodes(links, new Set(anchors.keys())), anchorY, {
      nodeHeight: BILL_NODE_HEIGHT,
      minGap: NODE_MIN_GAP,
      minY: 0,
      maxY: container.scrollHeight,
    });

    const nodeX = railX + railWidth;
    const wirings: BillWiring[] = [];
    for (const node of nodes) {
      const built = buildBillWiring(node, anchors, nodeX, wiring);
      if (built) wirings.push(built);
    }

    setGeometry({
      wirings,
      nodes,
      railX,
      railWidth,
      width: container.scrollWidth,
      height: container.scrollHeight,
    });
  }, [containerRef, links, wiring]);

  /** Coalesce every trigger into one measure on the next frame. */
  const schedule = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    []
  );

  /* Turning Show Links off must not leave a stale overlay behind, so the last thing
     measured is discarded. Deriving the empty result here rather than clearing it in the
     effect means "off" cannot leave one frame of wires on screen. */
  useEffect(() => {
    if (enabled) schedule();
  }, [enabled, schedule]);

  /* After the DOM has been updated with new rows — layout effects run after React's
     mutation phase but before paint, so the measurement reads the new boxes rather than
     the previous frame's. */
  useLayoutEffect(() => {
    if (enabled) schedule();
  }, [enabled, measureKey, schedule]);

  /* A reflow with no state change at all: the window resized, the sidebar collapsed, the
     table's max-height changed. */
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => schedule());
    observer.observe(container);
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [enabled, containerRef, schedule]);

  /* Web fonts land after first paint and change every row's height. One extra measure
     when they are ready, then never again. */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) schedule();
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, schedule]);

  return enabled ? geometry : EMPTY;
}

export type { WireHover };