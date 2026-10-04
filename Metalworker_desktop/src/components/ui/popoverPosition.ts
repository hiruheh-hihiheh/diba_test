// src/components/ui/popoverPosition.ts
//
// Where a floating panel goes, as a pure function of the geometry.
//
// WHY THIS IS SEPARATE FROM THE COMPONENT
// The behaviour that matters — flipping above the trigger when there is no room below,
// and never crossing the right-hand edge — is arithmetic, and arithmetic is testable
// without a browser. Keeping it here means "does the popover stay on screen" is a
// question with a unit test rather than something to check by scrolling a table by hand.
//
// The bug this fixes
// The panel used to be an absolutely positioned child of the cell that opened it. That
// cell lives inside the table's `overflow-auto` box, so a panel opened from a row near
// the bottom was CLIPPED by that box no matter how high a z-index it carried — a
// z-index only decides paint order among siblings, and it cannot lift a descendant out
// of an ancestor that clips. Portalling to <body> and positioning against the viewport
// is the fix; the arithmetic below is how it decides where to land.

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type Placement = "top" | "bottom";

export interface PopoverPosition {
  top: number;
  left: number;
  placement: Placement;
  /** Where the caret sits, measured from the panel's left edge. Null if it cannot fit. */
  caretX: number | null;
}

/** Breathing room between the panel and the edge of the window. */
export const VIEWPORT_PADDING = 10;
/** Gap between the trigger and the panel. */
export const TRIGGER_GAP = 8;
/** How close the caret may get to a rounded corner before it is dropped. */
const CARET_INSET = 14;

/**
 * Place a panel against its trigger, inside the viewport.
 *
 * Vertical: open below when there is room, otherwise above. When NEITHER side fits,
 * below still wins — it is the side people read first, and a panel that is merely
 * taller than the window is still usable because it scrolls.
 *
 * Horizontal: centred on the trigger, then shifted back inside the padding. Centring
 * and clamping in that order is what keeps the caret meaningful: a panel pushed against
 * the right edge still points back at its trigger.
 */
export function computePopoverPosition(
  anchor: Rect,
  panel: Size,
  viewport: Viewport,
  padding = VIEWPORT_PADDING
): PopoverPosition {
  const height = Math.min(panel.height, Math.max(0, viewport.height - padding * 2));
  const width = Math.min(panel.width, Math.max(0, viewport.width - padding * 2));

  const spaceBelow = viewport.height - anchor.bottom - TRIGGER_GAP - padding;
  const spaceAbove = anchor.top - TRIGGER_GAP - padding;
  const placement: Placement = spaceBelow >= height || spaceBelow >= spaceAbove ? "bottom" : "top";

  const top =
    placement === "bottom" ? anchor.bottom + TRIGGER_GAP : anchor.top - TRIGGER_GAP - height;

  const centred = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.min(Math.max(centred, padding), Math.max(padding, viewport.width - width - padding));

  /* The caret points at the middle of the trigger, but only while that stays inside the
     panel's rounded corners. Near an edge it is dropped rather than drawn on top of a
     corner, which looks like a rendering fault. */
  const caretFromAnchor = anchor.left + anchor.width / 2 - left;
  const caretX =
    caretFromAnchor >= CARET_INSET && caretFromAnchor <= width - CARET_INSET ? caretFromAnchor : null;

  return { top, left, placement, caretX };
}