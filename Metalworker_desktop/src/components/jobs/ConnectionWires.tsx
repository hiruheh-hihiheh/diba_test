// src/components/jobs/ConnectionWires.tsx
//
// The SVG layer that draws a wire from each job row to each bill it is linked to.
//
// COLOUR FOLLOWS THE THEME WITHOUT ANY JAVASCRIPT
// The stroke is `currentColor` and the colour comes from a class on the wrapper. That
// is the same convention as the one hand-written SVG in this app
// (`IconButton`'s spinner glyph), and it means a theme flip recolours the wires for
// free: the app's theme is CSS custom properties swapped by `[data-theme]`, so there
// is no resolved hex to keep in React state and no effect watching for one.
//
// Light is blue and dark is red. Both are declared in `index.css` as
// `--color-connection`, resolved per theme, rather than hard-coded here.
//
// NO POINTER EVENTS
// The layer sits over the table and must never intercept a click. Hover is detected
// on the real DOM nodes underneath — the row and the chip — and reported upward, so
// the wires do not need to be interactive at all. That is also why a wire is not
// clickable: clicking a job row or its actions column has to behave exactly as it did
// before this feature existed.

import type { Point } from "./wireGeometry";
import { wireOpacity, wirePath, wireWidth } from "./wireGeometry";
import type { WireGeometry, WireHover } from "../../hooks/useConnectionWires";

interface Props {
  geometry: WireGeometry;
  hovered: WireHover | null;
}

export default function ConnectionWires({ geometry, hovered }: Props) {
  const { segments, width, height } = geometry;

  /* Nothing rendered means no layer at all — not an empty SVG sitting over the table.
     This is what keeps "Show Links off" free of any overhead. */
  if (!segments.length || width === 0 || height === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-[1] pointer-events-none text-connection overflow-hidden"
    >
      <svg width={width} height={height} className="block">
        <defs>
          {/* One filter, referenced by every wire, rather than one per wire: a drop
              shadow per segment is a separate filter surface and there is no reason
              for fifty rows to pay for fifty of them. */}
          <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {segments.map((segment) => (
          <Wire
            key={segment.id}
            id={segment.id}
            from={segment.from}
            to={segment.to}
            opacity={wireOpacity(segment, hovered)}
            strokeWidth={wireWidth(segment, hovered)}
          />
        ))}
      </svg>
    </div>
  );
}

interface WireProps {
  id: string;
  from: Point;
  to: Point;
  opacity: number;
  strokeWidth: number;
}

function Wire({ id, from, to, opacity, strokeWidth }: WireProps) {
  const d = wirePath(from, to);
  const emphasised = opacity === 1;

  return (
    <g opacity={opacity} style={{ transition: "opacity 140ms ease" }}>
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        filter={emphasised ? "url(#wire-glow)" : undefined}
      />
      {/* A dot at each end, so the wire visibly terminates on the row and on the bill
          rather than appearing to pass through them. */}
      <circle cx={from.x} cy={from.y} r={emphasised ? 3.5 : 2.5} fill="currentColor" />
      <circle cx={to.x} cy={to.y} r={emphasised ? 3.5 : 2.5} fill="currentColor" />
      <title>{id}</title>
    </g>
  );
}