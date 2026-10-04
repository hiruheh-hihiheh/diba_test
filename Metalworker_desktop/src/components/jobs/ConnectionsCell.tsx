// src/components/jobs/ConnectionsCell.tsx
//
// The CONNECTIONS column on the job table.
//
// COMPACT BY DEFAULT, REVEALING ON DEMAND
// With Show Links off — which is how the page loads — this cell is a single count
// badge. The per-bill chips appear only while Show Links is on, because fifty rows of
// bill numbers would bury the actual job data, and because the chips are what the
// wires attach to: there is nothing to point a wire at if they are not drawn.
//
// THE COUNT IS TEXT, NOT JUST A COLOUR OR AN ICON
// A connected job has to still make sense with the wires off, to a screen reader, and
// to anyone who cannot distinguish the accent colour. So the badge always reads
// "2 Bills" or "—", the chip carries the invoice number as its own text, and the wire
// is decoration on top of that rather than the only signal.

import { useEffect, useRef, useState } from "react";
import { Link2, Trash2 } from "lucide-react";

import type { JobBillConnection } from "../../types/billJobConnections";
import { connectionCountLabel } from "../../types/billJobConnections";
import { WIRE_ATTR_NODE } from "./wireGeometry";

interface Props {
  jobId: string;
  /** The row's own job number, for the popover's accessible name. */
  jobNo: string | null;
  /** The links for THIS job. Empty array means "no connections". */
  bills: JobBillConnection[];
  /** Show Links is on: draw the per-bill chips the wires attach to. */
  showChips: boolean;
  onUnlink: (link: JobBillConnection) => void;
  /** Report a hover so the wire layer can emphasise one relationship. */
  onHover: (hover: { jobId: string; billId: string } | null) => void;
  /** Set while a row-level bulk operation is running. */
  busy?: boolean;
}

export default function ConnectionsCell({
  jobId,
  jobNo,
  bills,
  showChips,
  onUnlink,
  onHover,
  busy = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const count = bills.length;

  /* Dismiss on an outside click or Escape. The popover is a plain absolutely
     positioned panel rather than a Modal: it must not steal focus, because the user
     is usually scanning a table and may want to open another row's popover next. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    <td className="px-4 py-3.5 align-top">
      <div ref={wrapRef} className="relative flex flex-col gap-1.5 items-start">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${connectionCountLabel(count)} linked. Show which bills`}
          title={`${connectionCountLabel(count)} linked`}
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

        {/* The wire's BILL-side anchor. The job-side anchor is the Job No cell itself,
            marked by the page, so a wire sweeps across the row from the job number to
            this chip. */}
        {showChips &&
          bills.map((link) => (
            <button
              key={link.bill_id}
              type="button"
              {...{ [WIRE_ATTR_NODE]: `${jobId}:${link.bill_id}` }}
              onMouseEnter={() => onHover({ jobId, billId: link.bill_id })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ jobId, billId: link.bill_id })}
              onBlur={() => onHover(null)}
              onClick={() => setOpen(true)}
              title={`${link.label}${link.party_name ? ` — ${link.party_name}` : ""}`}
              className="max-w-[11rem] truncate rounded-md border border-connection/30 bg-connection-muted px-2 py-0.5 text-left text-[11px] font-semibold text-connection transition-colors cursor-pointer hover:border-connection focus:outline-none focus-visible:ring-2 focus-visible:ring-connection"
            >
              {link.label}
            </button>
          ))}

        {open && (
          <div
            role="dialog"
            aria-label={`Bills linked to this job${jobNo ? ` (${jobNo})` : ""}`}
            className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-border bg-surface p-3 shadow-2xl animate-scale-in"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
              Linked bills
            </p>
            <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto scrollbar-thin">
              {bills.map((link) => (
                <li
                  key={link.bill_id}
                  onMouseEnter={() => onHover({ jobId, billId: link.bill_id })}
                  onMouseLeave={() => onHover(null)}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover transition-colors"
                >
                  <Link2 size={12} className="text-connection mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-text truncate">
                      {link.label}
                    </span>
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
          </div>
        )}
      </div>
    </td>
  );
}