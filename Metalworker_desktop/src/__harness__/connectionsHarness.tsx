// TEMPORARY VISUAL HARNESS — not part of the app. Deleted after browser verification.
//
// Mounts the REAL connection-layer components (useConnectionWires, ConnectionWires,
// BillNodeRail, ConnectionsCell, AnchoredPopover) against a replica of the JobsPage
// table markup, so the browser can measure real boxes and we can look at real pixels.
// Data is mock because no admin credentials exist in this environment.

import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";

/* The verification tab is HIDDEN, and a hidden tab never paints, so the browser never
   fires requestAnimationFrame. The hook schedules its measure in rAF, so without this it
   would never run here. Substituting a timer affects only WHEN the real hook is called —
   the hook itself, the DOM it measures and the geometry it computes are untouched.
   Harness-only; nothing in the app does this. */
window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  window.setTimeout(() => cb(performance.now()), 16) as unknown as number) as typeof window.requestAnimationFrame;
window.cancelAnimationFrame = ((id: number) =>
  window.clearTimeout(id)) as typeof window.cancelAnimationFrame;

import ConnectionWires from "../components/jobs/ConnectionWires";
import BillNodeRail, { type RailJobMeta } from "../components/jobs/BillNodeRail";
import ConnectionsCell from "../components/jobs/ConnectionsCell";
import {
  WIRE_ATTR_ANCHOR,
  WIRE_ATTR_RAIL,
  anchorAttr,
  groupLinksByJob,
  hoverJob,
  type BillNodeBox,
} from "../components/jobs/wireGeometry";
import { useConnectionWires, type WireHover } from "../hooks/useConnectionWires";
import type { JobBillConnection } from "../types/billJobConnections";

/* CASE A: 3 labour + 2 with-material jobs on ONE bill  -> 1 node, 5 wires
   CASE B: 1 job on TWO bills                          -> 2 nodes
   CASE C: a second bill with one job of its own       -> 1 more node          */
const JOBS = [
  { id: "j1", no: "1546", type: "labour" as const },
  { id: "j2", no: "1542 A", type: "labour" as const },
  { id: "j3", no: "1535", type: "labour" as const },
  { id: "j4", no: "1622", type: "with_material" as const },
  { id: "j5", no: "1623", type: "with_material" as const },
  { id: "j6", no: "1601", type: "labour" as const },
  { id: "j7", no: "1546", type: "labour" as const },
];

const l = (
  jobId: string,
  billId: string,
  label: string,
  party: string | null = null
): JobBillConnection =>
  ({
    job_id: jobId,
    bill_id: billId,
    label,
    party_name: party,
  }) as unknown as JobBillConnection;

const LINKS: JobBillConnection[] = [
  l("j1", "bA", "SEW/317/2026-27", "M/s. Hawkins Cookers Ltd."),
  l("j2", "bA", "SEW/317/2026-27", "M/s. Hawkins Cookers Ltd."),
  l("j3", "bA", "SEW/317/2026-27", "M/s. Hawkins Cookers Ltd."),
  l("j4", "bA", "SEW/317/2026-27", "M/s. Hawkins Cookers Ltd."),
  l("j5", "bA", "SEW/317/2026-27", "M/s. Hawkins Cookers Ltd."),
  /* one job, two bills */
  l("j7", "bA", "SEW/317/2026-27", "M/s. Hawkins Cookers Ltd."),
  l("j7", "bB", "SEW/318/2026-27", "SAASTHA ENGINEERING WORKS"),
  l("j6", "bC", "SEW/401/2026-27", "Precision Forge Pvt. Ltd."),
];

const META = new Map<string, RailJobMeta>(
  JOBS.map((j) => [j.id, { jobNo: j.no, jobType: j.type }])
);

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<WireHover | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  const [links, setLinks] = useState(LINKS);

  const byJob = groupLinksByJob(links);
  const geometry = useConnectionWires({
    containerRef,
    links,
    enabled: showLinks,
    measureKey: `${links.length}`,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowLinks((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Show Links: {showLinks ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={() =>
            setDocumentTheme(
              document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"
            )
          }
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Toggle theme
        </button>
        <button
          type="button"
          onClick={() => setLinks(links.slice(0, 2))}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Simulate filter (drops rows)
        </button>
      </div>

      <pre id="probe" className="text-xs whitespace-pre-wrap border border-border rounded p-2">
        {JSON.stringify(
          {
            segments: geometry.segments.length,
            nodes: geometry.nodes.length,
            railX: Math.round(geometry.railX),
            railWidth: Math.round(geometry.railWidth),
            width: geometry.width,
            height: geometry.height,
          },
          null,
          1
        )}
      </pre>

      {/* Same wrapper shape as JobsPage: one relative box holding table + SVG + rail. */}
      <div
        ref={containerRef}
        className="relative border border-border rounded-xl overflow-auto"
        style={{ maxHeight: 520 }}
      >
        <ConnectionWires geometry={geometry} hovered={hovered} />
        <BillNodeRail
          nodes={geometry.nodes}
          railX={geometry.railX}
          railWidth={geometry.railWidth}
          height={geometry.height}
          hovered={hovered}
          jobMeta={META}
          onHover={setHovered}
          onUnlink={(_node: BillNodeBox, link: JobBillConnection) =>
            setLinks((prev) => prev.filter((x) => !(x.job_id === link.job_id && x.bill_id === link.bill_id)))
          }
        />

        <table className="w-full text-sm border-collapse">
          <thead className="sticky-head">
            <tr>
              <th className="px-4 py-3 text-left text-xs uppercase text-text-muted">Job No</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-text-muted">Tool / Part</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-text-muted">Qty</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-text-muted">Connections</th>
              {showLinks && (
                <th
                  {...{ [WIRE_ATTR_RAIL]: "" }}
                  className="px-4 py-3 text-left text-xs uppercase text-text-muted w-[13rem]"
                >
                  Linked Bills
                </th>
              )}
              <th className="sticky-actions px-4 py-3 text-left text-xs uppercase text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {JOBS.map((job) => (
              <tr
                key={job.id}
                onMouseEnter={() => {
                  if (showLinks && (byJob.get(job.id)?.length ?? 0) > 0) setHovered(hoverJob(job.id));
                }}
                onMouseLeave={() => showLinks && setHovered(null)}
                className="hover:bg-surface-hover/50"
              >
                <td
                  {...{ [WIRE_ATTR_ANCHOR]: anchorAttr(job.id) }}
                  className="px-4 py-3.5 font-bold"
                >
                  {job.no}
                  <span className="ml-1 text-[10px] font-normal text-text-muted">
                    {job.type === "with_material" ? "A" : ""}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-text-muted">Bracket {job.no}</td>
                <td className="px-4 py-3.5 text-text-muted">{job.id.charCodeAt(1) % 9}</td>
                <ConnectionsCell
                  jobId={job.id}
                  jobNo={job.no}
                  bills={byJob.get(job.id) ?? []}
                  onHover={setHovered}
                  onUnlink={(link) =>
                    setLinks((prev) =>
                      prev.filter((x) => !(x.job_id === link.job_id && x.bill_id === link.bill_id))
                    )
                  }
                />
                {showLinks && (
                  <td {...{ [WIRE_ATTR_RAIL]: "" }} className="px-4 py-3.5" />
                )}
                <td className="sticky-actions px-4 py-3.5">
                  <button type="button" className="rounded-md border border-border px-2 py-1 text-xs">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function setDocumentTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);