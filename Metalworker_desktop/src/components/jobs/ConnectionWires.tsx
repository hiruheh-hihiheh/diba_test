// src/components/jobs/ConnectionWires.tsx
//
// The SVG layer: one shared line per bill, with a stub arriving from each connected row.
//
// WHY THE LINE IS DRAWN ONCE PER BILL
// The visual claim this layer makes is "these rows all reach the same bill". A curve per
// row only ever suggests that, by coincidence of where the curves happen to end. A single
// vertical line that every stub meets is the claim itself: the spine is visibly one thing,
// and the stubs are visibly the same colour and weight because they arrive at it.
//
// WHY THE SPINE IS ITS OWN PATH
// Every wire into a bill shares the spine, so drawing it per-wire would double-strike the
// same pixels. Overlapping strokes compound their alpha, so a dimmed wire next to a lit
// one would leave a bright seam down the middle of a dimmed bundle. One path per bill
// cannot do that.
//
// COLOUR FOLLOWS THE THEME WITHOUT ANY JAVASCRIPT
// The stroke is `currentColor` and the colour comes from a class on the wrapper. That is
// the same convention as the one hand-written SVG in this app (`IconButton`'s spinner
// glyph), and it means a theme flip recolours the wires for free: the app's theme is CSS
// custom properties swapped by `[data-theme]`, so there is no resolved hex to keep in
// React state and no effect watching for one. Light is blue and dark is red, both declared
// in `index.css` as `--color-connection` rather than hard-coded here.
//
// NO POINTER EVENTS
// The layer sits over the table and must never intercept a click. Hover is detected on
// the real DOM nodes underneath — the row and the bill target — and reported upward, so
// the wires do not need to be interactive at all. That is also why a wire is not
// clickable: clicking a job row or its actions column has to behave exactly as it did
// before this feature existed.

import { wireOpacity, wireWidth, trunkOpacity, wiringPaths } from "./wireGeometry";
import type { WireHover } from "./wireGeometry";
import type { WireGeometry } from "../../hooks/useConnectionWires";

interface Props {
  geometry: WireGeometry;
  hovered: WireHover | null;
}

export default function ConnectionWires({ geometry, hovered }: Props) {
  const { wirings, width, height } = geometry;

  /* Nothing rendered means no layer at all — not an empty SVG sitting over the table.
     This is what keeps "Show Links off" free of any overhead. */
  if (!wirings.length || width === 0 || height === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-[1] pointer-events-none text-connection overflow-hidden"
    >
      <svg width={width} height={height} className="block">
        <defs>
          {/* One filter, referenced by every wire, rather than one per wire: a drop
              shadow per segment is a separate filter surface and there is no reason for
              fifty rows to pay for fifty of them. */}
          <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {wirings.map((wiring) => {
          const paths = wiringPaths(wiring);
          const spine = trunkOpacity(wiring, hovered);
          return (
            <g key={wiring.billId}>
              {/* The spine first, so the stubs' corners sit on top of it rather than being
                  overdrawn by it. */}
              <g opacity={spine} style={{ transition: "opacity 140ms ease" }}>
                <path
                  d={paths.trunk}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={spine === 1 ? 2.5 : 1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter={spine === 1 ? "url(#wire-glow)" : undefined}
                />
              </g>
              {paths.stubs.map((stub) => {
                const opacity = wireOpacity(
                  { jobId: stub.jobId, billId: stub.billId },
                  hovered
                );
                const emphasised = opacity === 1;
                return (
                  <g key={stub.id} opacity={opacity} style={{ transition: "opacity 140ms ease" }}>
                    <path
                      d={stub.path}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={wireWidth({ jobId: stub.jobId, billId: stub.billId }, hovered)}
                      strokeLinecap="round"
                      filter={emphasised ? "url(#wire-glow)" : undefined}
                    />
                    {/* A dot where the wire leaves its row, so it visibly terminates on the
                        job rather than appearing to pass through it. The badge end is the
                        spine's business, not this stub's. */}
                    <circle
                      cx={stub.from.x}
                      cy={stub.from.y}
                      r={emphasised ? 3 : 2}
                      fill="currentColor"
                    />
                    <title>{stub.id}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}