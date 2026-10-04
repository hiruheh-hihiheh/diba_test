// src/components/ui/AnchoredPopover.tsx
//
// A floating panel that is never clipped by the thing it is anchored to.
//
// THE ONE RULE
// It renders through a portal into <body> and is positioned `fixed` against the
// VIEWPORT. Anything else inherits the clipping of its ancestors, and the job table's
// scroll container clips hard — a panel inside a row near the bottom used to be sliced
// off, and no z-index could rescue it because z-index orders siblings and cannot lift a
// descendant out of an ancestor that clips.
//
// WHO LISTENS TO SCROLLING
// Only while a panel is actually open, and only one at a time. A listener per row would
// mean fifty rows each reacting to every scroll event on the page for a panel that is
// not visible. Here the listeners are attached on open and removed on close, and the
// anchor is re-measured with `getBoundingClientRect()` on each one — which means a panel
// that follows its trigger correctly while the table scrolls underneath, instead of
// being left floating where it used to be.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  computePopoverPosition,
  type Placement,
  type PopoverPosition,
} from "./popoverPosition";

interface Props {
  open: boolean;
  /** The element the panel points at. Measured, never assumed. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Accessible name. The panel is a dialog, so it needs one. */
  ariaLabel: string;
  children: ReactNode;
  /** Preferred width. The height is measured from the content. */
  width?: number;
  /** Largest height before the panel scrolls internally. */
  maxHeight?: number;
  className?: string;
}

const DEFAULT_WIDTH = 288;
const DEFAULT_MAX_HEIGHT = 320;

export default function AnchoredPopover({
  open,
  anchorRef,
  onClose,
  ariaLabel,
  children,
  width = DEFAULT_WIDTH,
  maxHeight = DEFAULT_MAX_HEIGHT,
  className = "",
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  /* Whether `position` describes the CURRENT opening. A panel opened earlier left a
     position behind; reusing it would draw the panel at the old spot for a frame before
     the re-measure lands. Reset during render — React's documented "adjust state when a
     prop changes" pattern, and the one `BillFolderPickerModal` already uses in the admin
     app — so the reset happens before paint rather than in an effect after it. */
  const [shownOpen, setShownOpen] = useState(open);
  const [measured, setMeasured] = useState(false);
  if (open !== shownOpen) {
    setShownOpen(open);
    setMeasured(false);
  }

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    setPosition(
      computePopoverPosition(
        { ...a, width: a.width, height: a.height },
        { width: width || box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    setMeasured(true);
  }, [anchorRef, width]);

  /* Measure once the panel has been laid out, before paint, so it never appears at the
     wrong place for a frame. */
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition, children]);

  useEffect(() => {
    if (!open) return;

    /* `capture` on scroll so a scroll in ANY ancestor counts — the table's inner box is
       the one that actually moves, and a bubble-phase listener on window would miss it
       entirely. */
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    /* A panel whose own content changes size — a list loading, a row removed — must
       follow. */
    let observer: ResizeObserver | undefined;
    if (panelRef.current && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => reposition());
      observer.observe(panelRef.current);
    }

    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("keydown", onKey);
      observer?.disconnect();
    };
  }, [open, onClose, reposition]);

  /* Dismiss on a pointer press outside both the panel and its trigger. Without this the
     only way out is Escape, which is not a mouse user's expectation. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  /* `position` may still belong to a previous opening, so it is only trusted once this
     opening has been measured. Until then the panel is present but invisible, which
     reserves its measured size without ever showing it in the wrong place. */
  const ready = measured && position !== null;

  const style: React.CSSProperties = {
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    width,
    maxHeight,
    visibility: ready ? "visible" : "hidden",
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      onMouseDown={(e) => e.stopPropagation()}
      style={style}
      className={`fixed z-[200] overflow-y-auto scrollbar-thin rounded-xl border border-border bg-surface p-3 shadow-2xl animate-scale-in ${className}`}
    >
      {children}
      <Caret placement={position?.placement ?? "bottom"} caretX={ready ? position.caretX : null} />
    </div>,
    document.body
  );
}

/**
 * The caret that points back at the trigger.
 *
 * A rotated square rather than a CSS triangle, because a square can be positioned with
 * the same `left` maths as everything else and inherits the panel's border colour, so
 * the two edges line up. It sits outside the panel's own padding, which is why it is
 * rendered after the children rather than inside the content flow.
 */
function Caret({ placement, caretX }: { placement: Placement; caretX: number | null }) {
  if (caretX === null) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute w-2.5 h-2.5 rotate-45 bg-surface border-border"
      style={{
        left: caretX - 5,
        ...(placement === "bottom" ? { top: -6, borderRightWidth: 0, borderBottomWidth: 0 } : { bottom: -6, borderLeftWidth: 0, borderTopWidth: 0 }),
      }}
    />
  );
}