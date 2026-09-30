// src/components/bills/BillDetailModal.tsx
//
// Everything known about one invoice: identity, transport, party, tax summary,
// the line items, and the three print copies.
//
// The amounts are per INVOICE. The three copies are renderings of the same
// figures, so they are listed as documents to open, never added together.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import Modal from "../ui/Modal";
import { ErrorState } from "../ui/LoadingState";
import { BillCopyActions } from "./BillCopyActions";
import { fetchBill, fetchBillLineItems, formatMoney, formatBillDate, formatQuantity, formatJobKind } from "../../services/bills";
import type { Bill, BillLineItem } from "../../types/bill";

/** A labelled value that hides itself entirely when there is nothing to show. */
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{label}</dt>
      <dd className="text-sm text-text mt-0.5 break-words whitespace-pre-line">{value}</dd>
    </div>
  );
}

/** One figure in the tax summary strip. `format` keeps quantity out of `formatMoney`. */
function Figure({
  label,
  value,
  format = formatMoney,
  emphasis,
}: {
  label: string;
  value: number | null;
  format?: (v: number | null) => string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`px-3 py-2 rounded-xl ${
        emphasis ? "bg-primary-muted" : "bg-bg-secondary border border-border"
      }`}
    >
      <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{label}</p>
      <p
        className={`text-sm font-bold tabular-nums mt-0.5 ${
          emphasis ? "text-primary" : "text-text"
        }`}
      >
        {format(value)}
      </p>
    </div>
  );
}

export function BillDetailModal({
  billId,
  onClose,
  onOpenFolderPicker,
}: {
  billId: string | null;
  onClose: () => void;
  onOpenFolderPicker: (bill: Bill) => void;
}) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [lines, setLines] = useState<BillLineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Clearing on close is a RENDER-phase adjustment, not an effect.
     React's documented pattern: when a prop changes to a new "identity", reset
     the derived state during the same render rather than in an effect, which
     would paint one frame of the previous bill's figures. The effect below then
     only ever does asynchronous work, so it never calls setState synchronously. */
  const [shownId, setShownId] = useState(billId);
  if (billId !== shownId) {
    setShownId(billId);
    setBill(null);
    setLines([]);
    setError(null);
    setLoading(!!billId);
  }

  useEffect(() => {
    if (!billId) return;

    let cancelled = false;

    (async () => {
      try {
        const [b, l] = await Promise.all([fetchBill(billId), fetchBillLineItems(billId)]);
        if (cancelled) return;
        setBill(b);
        setLines(l);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "That bill could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [billId]);

  return (
    <Modal
      open={!!billId}
      onClose={onClose}
      size="xl"
      title={bill?.invoice_no ? `Bill ${bill.invoice_no}` : "Bill"}
      subtitle={
        bill
          ? /* The job classification is appended rather than replacing anything,
               so the header still reads sheet -> workbook and the operator can
               still see the classification without scrolling to the grid. */
            [`Sheet “${bill.sheet_name}”`, bill.original_filename, formatJobKind(bill.job_kind)]
              .filter(Boolean)
              .join(" · ")
          : "Loading the invoice…"
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-16 gap-3" role="status" aria-live="polite">
          <Loader2 size={26} className="text-primary animate-spin" />
          <span className="sr-only">Loading bill</span>
        </div>
      )}

      {error && !loading && (
        <ErrorState
          title="Could not load this bill"
          message={error}
          onRetry={() => billId && fetchBill(billId).then((b) => { setBill(b); setError(null); }).catch(() => undefined)}
        />
      )}

      {bill && !loading && (
        <div className="space-y-6">
          {/* ── Tax summary ─────────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
              Amounts
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
              <Figure label="Before tax" value={bill.amount_before_tax} />
              <Figure label="CGST" value={bill.cgst} />
              <Figure label="SGST" value={bill.sgst} />
              <Figure label="IGST" value={bill.igst} />
              <Figure label="Total GST" value={bill.total_gst} />
              <Figure label="Round off" value={bill.round_off} />
              <Figure label="After tax" value={bill.amount_after_tax} emphasis />
              <Figure label="Quantity" value={bill.total_quantity} format={formatQuantity} />
            </div>
          </section>

          {/* ── Identity ────────────────────────────────────── */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <Field label="Invoice no" value={bill.invoice_no} />
            <Field label="Invoice date" value={formatBillDate(bill.invoice_date)} />
            <Field label="Quantity" value={formatQuantity(bill.total_quantity)} />
            <Field label="Job type" value={formatJobKind(bill.job_kind)} />
            <Field label="Seller" value={bill.seller_name} />
            <Field label="Party" value={bill.party_name} />
            <Field label="Party GST no" value={bill.party_gst_no} />
            <Field label="State" value={bill.state ? `${bill.state}${bill.state_code ? ` (${bill.state_code})` : ""}` : null} />
            {bill.order_no && (
              <Field label={bill.order_no_label || "Order no"} value={bill.order_no} />
            )}
            <Field label="Order date" value={formatBillDate(bill.order_date)} />
            <Field label="Our challan" value={bill.our_challan_no} />
            <Field label="Our challan date" value={formatBillDate(bill.our_challan_date)} />
            <Field label="Your challan" value={bill.your_challan_no} />
            <Field label="Your challan date" value={formatBillDate(bill.your_challan_date)} />
            <Field label="E-way bill" value={bill.eway_bill_no} />
            <Field label="Vehicle" value={bill.vehicle_number} />
            <Field label="Transporter mode" value={bill.transporter_mode} />
            <Field label="Place of supply" value={bill.place_of_supply} />
          </section>

          {bill.amount_in_words && (
            <section>
              <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                Amount in words
              </h3>
              <p className="text-sm text-text bg-bg-secondary border border-border rounded-xl px-4 py-3">
                {bill.amount_in_words}
              </p>
            </section>
          )}

          {/* ── Line items ──────────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
              Line items ({lines.length})
            </h3>
            {lines.length === 0 ? (
              <p className="text-sm text-text-muted">This invoice has no line items.</p>
            ) : (
              <div className="overflow-x-auto scrollbar-thin border border-border rounded-xl">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg-secondary">
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-2">#</th>
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-2">Description</th>
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-2">HSN</th>
                      <th className="text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-2">Qty</th>
                      <th className="text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-2">Rate</th>
                      <th className="text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((line, index) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 text-text-muted tabular-nums">
                          {line.sr_no ?? index + 1}
                        </td>
                        <td className="px-3 py-2 text-text">{line.description || "—"}</td>
                        <td className="px-3 py-2 text-text-muted whitespace-nowrap">{line.hsn_code || "—"}</td>
                        <td className="px-3 py-2 text-text text-right tabular-nums whitespace-nowrap">
                          {formatQuantity(line.quantity)}
                          {line.uom ? ` ${line.uom}` : ""}
                        </td>
                        <td className="px-3 py-2 text-text text-right tabular-nums whitespace-nowrap">
                          {formatMoney(line.rate)}
                        </td>
                        <td className="px-3 py-2 text-text font-semibold text-right tabular-nums whitespace-nowrap">
                          {formatMoney(line.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Bank / seller / terms ───────────────────────── */}
          {(bill.bank_details || bill.seller_address || bill.terms) && (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {bill.bank_details && (
                <div>
                  <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Bank details
                  </h3>
                  <ul className="text-sm text-text space-y-0.5">
                    {bill.bank_details.map((line, i) => (
                      <li key={i} className="break-words">{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {bill.seller_address && (
                <div>
                  <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Seller address
                  </h3>
                  <p className="text-sm text-text whitespace-pre-line break-words">{bill.seller_address}</p>
                </div>
              )}
              {bill.terms && (
                <div>
                  <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Terms
                  </h3>
                  <p className="text-sm text-text whitespace-pre-line break-words">{bill.terms}</p>
                </div>
              )}
            </section>
          )}

          {/* ── The three copies ────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2">
              Print copies
            </h3>
            <p className="text-xs text-text-muted mb-3">
              Original, duplicate and triplicate are three print copies of this one invoice,
              each holding every bill in the workbook. They are the same figures, not extra
              charges.
            </p>
            <BillCopyActions bill={bill} />
          </section>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => onOpenFolderPicker(bill)}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Add to folder
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
