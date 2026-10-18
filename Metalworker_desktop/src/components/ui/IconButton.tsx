// src/components/ui/IconButton.tsx
// Icon-only action button with a guaranteed accessible name and tooltip.
// The audit found many icon-only buttons with neither `aria-label` nor `title`,
// so the control was invisible to screen readers and to hover discovery.

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "ghost" | "surface" | "danger" | "success" | "primary";
type Size = "sm" | "md";

const variantCls: Record<Variant, string> = {
  ghost:
    "text-text-muted hover:text-text hover:bg-surface-hover border border-transparent",
  surface:
    "bg-surface text-text-muted hover:text-text hover:bg-surface-hover border border-border",
  // Destructive actions sit quietly in a row until they are pointed at. A column
  // of permanently red buttons makes every list look like it is on fire.
  danger:
    "text-text-muted hover:text-danger hover:bg-danger-muted border border-transparent",
  success:
    "text-text-muted hover:text-success hover:bg-success-muted border border-transparent",
  primary:
    "bg-primary-muted text-primary hover:bg-primary hover:text-[var(--theme-primary-text)] border border-transparent",
};

const sizeCls: Record<Size, string> = {
  sm: "w-7 h-7 rounded-[7px]",
  md: "w-9 h-9 rounded-[9px]",
};

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  /** Required. Becomes both the tooltip and the accessible name. */
  label: string;
  icon: ReactNode;
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks repeat clicks. */
  busy?: boolean;
  tooltipPlacement?: "top" | "top-end" | "bottom" | "bottom-end" | "left" | "right";
}

export default function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  busy = false,
  tooltipPlacement = "top",
  className = "",
  disabled,
  ...rest
}: IconButtonProps) {
  /* `top-end` / `bottom-end` anchor the tooltip to the button's right edge
     instead of centring it on the button. Use those for the icon buttons in a
     right-aligned table action column: a centred tooltip on the last column
     hangs off the right of the window, where it cannot be read. */
  const placement = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    "top-end": "bottom-full right-0 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    "bottom-end": "top-full right-0 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[tooltipPlacement];

  return (
    <span className="relative inline-flex group/ib">
      <button
        type="button"
        aria-label={label}
        disabled={disabled || busy}
        className={`inline-flex items-center justify-center shrink-0 transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${variantCls[variant]} ${sizeCls[size]} ${className}`}
        {...rest}
      >
        {busy ? <SpinnerGlyph /> : icon}
      </button>

      {/* Hover / focus tooltip.

          Two things here are deliberate and were both bugs:

          1. `hidden` → `block`, not `opacity-0` → `opacity-100`. An absolutely
             positioned, invisible element still occupies layout, so a long
             label ("Delete Site visit - 26 Sep 2026") pushed the whole
             document 70px wider than the window and gave every page a
             horizontal scrollbar that had nothing to do with its content.
             `display: none` contributes no layout at all, so the tooltip can
             never affect the page.

          2. The button carries `aria-label` but NOT `title`. With both, the
             browser's native tooltip appears a second or so after the custom
             one, so hovering showed two overlapping labels saying the same
             thing.

          The max-width stops a long record name producing a tooltip wider than
          the window; the text wraps instead. */}
      <span
        role="tooltip"
        className={`hidden pointer-events-none absolute z-[150] rounded-md border border-border bg-bg px-2 py-1 text-[11px] font-semibold text-text shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)] group-hover/ib:block group-focus-within/ib:block max-w-[min(16rem,70vw)] whitespace-normal break-words leading-snug ${placement}`}
      >
        {label}
      </span>
    </span>
  );
}

function SpinnerGlyph() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
