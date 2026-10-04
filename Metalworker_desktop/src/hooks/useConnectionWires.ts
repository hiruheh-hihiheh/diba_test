// src/hooks/useConnectionWires.ts
//
// Measures where the connection wires go.
//
// WHY THE OVERLAY LIVES INSIDE THE SCROLL CONTAINER
// The obvious implementation is a `position: fixed` layer plus a scroll listener that
// re-reads every row's `getBoundingClientRect()`. That is the version that breaks: it
// is wrong for one frame on every scroll event, it needs the container, the window and
// a ResizeObserver all wired up, and it re-measures the whole table sixty times a
// second on a trackpad.
//
// Instead the SVG is absolutely positioned inside the SAME scrolling box as the table.
// The browser then moves the table and the wires together as one layer, so scrolling
// — vertical or horizontal — cannot desynchronise them at all, with no listener and no
// re-measure. What is left to measure is only the things that actually move the boxes
// relative to each other: a reflow from a resize, a filter changing which rows exist,
// a page change, a link being added or removed, and the container itself changing size.
//
// WHY ONLY RENDERED ROWS ARE MEASURED
// The DOM is queried for the rows that exist right now, so a table of two thousand jobs
// at fifty to a page measures fifty rows. There is no "render everything and hide it"
// path to go slow on.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  WIRE_ATTR_ANCHOR,
  WIRE_ATTR_NODE,
  type Point,
  type WireSegment,
} from "../components/jobs/wireGeometry";
import type { JobBillConnection } from "../types/billJobConnections";

export interface WireHover {
  jobId: string;
  billId: string;
}

interface Options {
  /** The relatively-positioned box that contains BOTH the table and the SVG. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The links to draw. Only those whose row and chip are both mounted get a wire. */
  links: JobBillConnection[];
  /** Show Links is on. When false nothing is measured at all. */
  enabled: boolean;
  /**
   * Anything that moves a box without changing the link list: a search, a page change,
   * a folder switch, a finished fetch. A plain string rather than a counter, because
   * the caller is declaring WHAT invalidates the geometry and this hook owns WHEN to
   * re-measure. A counter would need an effect to bump it, which is a second render
   * for information the hook could have taken as a dependency directly.
   */
  measureKey?: string;
}

const NO_KEY = "";

export interface WireGeometry {
  segments: WireSegment[];
  /** Width and height the SVG must cover. */
  width: number;
  height: number;
}

const EMPTY: WireGeometry = { segments: [], width: 0, height: 0 };

export function useConnectionWires({
  containerRef,
  links,
  enabled,
  measureKey = NO_KEY,
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
    const segments: WireSegment[] = [];

    for (const link of links) {
      const anchor = container.querySelector<HTMLElement>(
        `[${WIRE_ATTR_ANCHOR}="${cssEscape(link.job_id)}"]`
      );
      const node = container.querySelector<HTMLElement>(
        `[${WIRE_ATTR_NODE}="${cssEscape(nodeKey(link.job_id, link.bill_id))}"]`
      );
      /* A link whose row is on another page, or whose chip has not been rendered, is
         simply not drawn. That is the viewport limiting, and it needs no special case
         above. */
      if (!anchor || !node) continue;

      const a = anchor.getBoundingClientRect();
      const n = node.getBoundingClientRect();

      const from: Point = { x: a.right - base.left, y: a.top + a.height / 2 - base.top };
      const to: Point = { x: n.left - base.left, y: n.top + n.height / 2 - base.top };
      segments.push({
        id: nodeKey(link.job_id, link.bill_id),
        jobId: link.job_id,
        billId: link.bill_id,
        from,
        to,
        span: Math.hypot(to.x - from.x, to.y - from.y),
      });
    }

    setGeometry({
      segments,
      width: container.scrollWidth,
      height: container.scrollHeight,
    });
  }, [containerRef, links]);

  /** Coalesce every trigger into one measure on the next frame. */
  const schedule = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  /* Turning Show Links off must not leave a stale overlay behind, so the last thing
     measured is discarded. Deriving the empty result here rather than clearing it in
     the effect means "off" cannot leave one frame of wires on screen, and the effect
     below only ever has to ask for a measurement. */
  useEffect(() => {
    if (enabled) schedule();
  }, [enabled, schedule]);

  /* After the DOM has been updated with new rows, chips or links — layout effects run
     after React's mutation phase but before paint, so the measurement reads the new
     boxes rather than the previous frame's. */
  useLayoutEffect(() => {
    if (enabled) schedule();
  }, [enabled, measureKey, schedule]);

  /* A reflow with no state change at all: the window resized, the sidebar collapsed,
     the table's max-height changed. */
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

const nodeKey = (jobId: string, billId: string): string => `${jobId}:${billId}`;

/** Job and bill ids are uuids, but a stray quote must not be able to break the query. */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

export { WIRE_ATTR_ANCHOR, WIRE_ATTR_NODE };