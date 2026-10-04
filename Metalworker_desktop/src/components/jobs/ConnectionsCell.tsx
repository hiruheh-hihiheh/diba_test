// src/components/jobs/ConnectionsCell.tsx
//
// The CONNECTIONS column on the job table.
//
// ONE JOB, ONE COUNT
// This cell is table information: "how many bills is this job linked to". It stopped
// drawing the bill names when the shared rail took them over. Rendering a chip here per
// connection was what made three jobs on one invoice look like three invoices — the
// rail now owns that, drawing each bill exactly once no matter how many rows point at
// it. So this cell keeps the count and nothing else, in both Show Links states, which
// also means the column is identical whether the visualisation is on or off.
//
// THE COUNT IS TEXT, NOT JUST A COLOUR OR AN ICON
// A connected job has to make sense with the wires off, to a screen reader, and to
// anyone who cannot distinguish the accent colour. The badge always reads "2 Bills" or
// "—". The wire is decoration on top of that, never the only signal.
//
// THE POPOVER IS PORTALLED
// It used to be an absolutely positioned child of this cell, which put it inside the
// table's `overflow-auto` box: a row near the bottom had its popup sliced off. It is
// now rendered through `AnchoredPopover` into <body>, which measures the trigger and
// flips above when there is no room below.

import { useRef, useState } from "react";
import { Link2, Trash2 } from "lucide-react";

import AnchoredPopover from "../ui/AnchoredPopover";
import type { JobBillConnection } from "../../types/billJobConnections";
import { connectionCountLabel } from "../../types/billJobConnections";

interface Props {
  jobId: string;
  /** The row's own job number, for the popover's accessible name. */
  jobNo: string | null;
  /** The links for THIS job. Empty array means "no connections". */
  bills: JobBillConnection[];
  onUnlink: (link: JobBillConnection) => void;
  /** Report a hover so the wire layer can emphasise this job's wires. */
  onHover: (hover: { jobId: string; billId: null } | null) => void;
  /** Set while a row-level bulk operation is running. */
  busy?: boolean;
}

export default function ConnectionsCell({
  jobNo,
  bills,
  onUnlink,
  onHover,
  busy = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const count = bills.length;

  if (count === 0) {
    return (
      <td className="px-4 py-3.5">
        <span className="text-xs text-text-muted/70" title="Not linked to any bill">
          {connectionCountLabel(0)}
        </span>
      </td>
    );
  }

  return (
    <td className="px-4 py-3.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => onHover({ jobId: bills[0]?.job_id ?? "", billId: null })}
        onMouseLeave={() => onHover(null)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${connectionCountLabel(count)} linked${
          jobNo ? ` to job ${jobNo}` : ""
        }. Show which bills`}
        title={bills.map((b) => b.label).join(", ")}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
          open
            ? "bg-connection-muted text-connection"
            : "bg-surface-hover text-text-muted hover:text-connection"
        }`}
        disabled={busy}
      >
        <Link2 size={12} aria-hidden="true" />
        {connectionCountLabel(count)}
      </button>

      <AnchoredPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        ariaLabel={`Bills linked to this job${jobNo ? ` (${jobNo})` : ""}`}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
          Linked bills
        </p>
        <ul className="flex flex-col gap-1.5">
          {bills.map((link) => (
            <li
              key={link.bill_id}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover transition-colors"
            >
              <Link2 size={12} className="text-connection mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-text truncate">{link.label}</span>
                {link.party_name && (
                  <span className="block text-[11px] text-text-muted truncate">
                    {link.party_name}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onUnlink(link)}
                disabled={busy}
                aria-label={`Unlink bill ${link.label} from this job`}
                title={`Unlink ${link.label}`}
                className="shrink-0 rounded-md p-1 text-text-muted hover:text-danger hover:bg-danger-muted transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 pt-2 border-t border-border text-[11px] text-text-muted">
          Unlinking removes only the connection. The bill and the job are untouched.
        </p>
      </AnchoredPopover>
    </td>
  );
}