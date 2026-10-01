// src/components/bills/BillEditModal.tsx
//
// Edit one bill, save it, and re-print its three copies.
//
// The shape of the screen follows the invoice: each section is one block of the
// document, in the order the document prints them, so a user correcting a printed
// invoice finds the same field in the same place.
//
// WHAT A SAVE DOES, AND WHY THE SCREEN SAYS SO
// One request goes to the `update-bill` edge function, which validates, writes the
// row, replaces the line items, regenerates ORIGINAL / DUPLICATE / TRIPLICATE from
// the SAVED values, and only then points the row at the new documents. If any of
// that fails the bill is left exactly as it was, so this screen can say "nothing has
// changed" truthfully rather than showing a success message over a half-saved bill.
//
// The three copies are regenerated together and cannot be edited separately: they
// are three printings of one invoice, so there is nothing for a user to choose and a
// choice would only be a way to make them disagree.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";

import Modal from "../ui/Modal";
import { useToast } from "../ui/Toast";
import {
  bankPartsOf,
  fetchBill,
  fetchBillLineItems,
  formatMoney,
  formatQuantity,
  numberInputText,
  parseNumberInput,
  previewTotals,
  updateBill,
} from "../../services/bills";
import {
  BILL_BANK_PARTS,
  type Bill,
  type BillCopy,
  type BillLineItem,
  type BillPatch,
} from "../../types/bill";
import {
  Calculated,
  Field,
  NumberInput,
  SectionCard,
  TextArea,
  TextInput,
} from "./BillEditFields";

/** One editable line, held as text so a half-typed number is not thrown away. */
interface DraftLine {
  key: string;
  srNo: string;
  description: string;
  hsnCode: string;
  uom: string;
  quantity: string;
  rate: string;
}

/** The whole form, as text. Nothing here is a number yet. */
interface Draft {
  jobKind: string;
  invoiceNo: string;
  invoiceDate: string;
  ourChallanNo: string;
  ourChallanDate: string;
  yourChallanNo: string;
  yourChallanDate: string;
  orderNoLabel: string;
  orderNo: string;
  orderDate: string;
  ewayBillNo: string;
  ewayBillDate: string;
  recipientLabel: string;
  partyName: string;
  partyAddress: string;
  partyGstNo: string;
  placeOfSupply: string;
  state: string;
  stateCode: string;
  transporterMode: string;
  vehicleNumber: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  reverseChargeGst: string;
  roundOff: string;
  amountInWords: string;
  regenerateWords: boolean;
  bank: Record<string, string>;
  terms: string;
  certification: string;
  onBehalfOf: string;
  signatureDesignation: string;
  receiverSignature: string;
  sellerName: string;
  sellerDescriptor: string;
  sellerTaxLine: string;
  sellerAddress: string;
  sellerContact: string;
  lines: DraftLine[];
}

const s = (v: string | null | undefined): string => (v ?? "").trim();
const n = (v: number | null | undefined): string => numberInputText(v);

let lineKey = 0;
const newKey = (): string => `line-${++lineKey}`;

function toDraft(bill: Bill, items: BillLineItem[]): Draft {
  const parts = bankPartsOf(bill.bank_details);
  return {
    jobKind: s(bill.job_kind),
    invoiceNo: s(bill.invoice_no),
    invoiceDate: s(bill.invoice_date),
    ourChallanNo: s(bill.our_challan_no),
    ourChallanDate: s(bill.our_challan_date),
    yourChallanNo: s(bill.your_challan_no),
    yourChallanDate: s(bill.your_challan_date),
    // "Service Order No.:" is what the invoice prints, trailing colon included,
    // because `referenceRows` derives its row label from this value. Dropping the
    // colon would silently rename the row on the re-printed document.
    orderNoLabel: s(bill.order_no_label),
    orderNo: s(bill.order_no),
    orderDate: s(bill.order_date),
    ewayBillNo: s(bill.eway_bill_no),
    ewayBillDate: s(bill.eway_bill_date),
    recipientLabel: s(bill.recipient_label),
    partyName: s(bill.party_name),
    partyAddress: s(bill.party_address),
    partyGstNo: s(bill.party_gst_no),
    placeOfSupply: s(bill.place_of_supply),
    state: s(bill.state),
    stateCode: s(bill.state_code),
    transporterMode: s(bill.transporter_mode),
    vehicleNumber: s(bill.vehicle_number),
    cgstRate: n(bill.cgst_rate),
    sgstRate: n(bill.sgst_rate),
    igstRate: n(bill.igst_rate),
    reverseChargeGst: n(bill.reverse_charge_gst),
    roundOff: n(bill.round_off),
    amountInWords: s(bill.amount_in_words),
    regenerateWords: false,
    bank: Object.fromEntries(BILL_BANK_PARTS.map((p) => [p.key, s(parts[p.key]?.value)])),
    terms: s(bill.terms),
    certification: s(bill.certification),
    onBehalfOf: s(bill.on_behalf_of),
    signatureDesignation: s(bill.signature_designation),
    receiverSignature: s(bill.receiver_signature),
    sellerName: s(bill.seller_name),
    sellerDescriptor: s(bill.seller_descriptor),
    sellerTaxLine: s(bill.seller_tax_line),
    sellerAddress: s(bill.seller_address),
    sellerContact: s(bill.seller_contact),
    lines:
      items.length > 0
        ? items.map((item) => ({
            key: newKey(),
            srNo: n(item.sr_no),
            description: s(item.description),
            hsnCode: s(item.hsn_code),
            uom: s(item.uom),
            quantity: n(item.quantity),
            rate: n(item.rate),
          }))
        : [
            {
              key: newKey(),
              srNo: "1",
              description: "",
              hsnCode: "",
              uom: "",
              quantity: "",
              rate: "",
            },
          ],
  };
}

/**
 * The patch, assembled from the draft. `null` clears a field; absent leaves it.
 *
 * `bankLabels` is passed in rather than read from module state: the label of each
 * bank part is what the invoice already prints, and keeping it in a module-level
 * variable would mean two open editors shared one another's labels.
 */
function toPatch(d: Draft, bankLabels: Record<string, string>): BillPatch {
  return {
    job_kind: d.jobKind || null,
    invoice_no: d.invoiceNo || null,
    invoice_date: d.invoiceDate || null,
    our_challan_no: d.ourChallanNo || null,
    our_challan_date: d.ourChallanDate || null,
    your_challan_no: d.yourChallanNo || null,
    your_challan_date: d.yourChallanDate || null,
    order_no_label: d.orderNoLabel || null,
    order_no: d.orderNo || null,
    order_date: d.orderDate || null,
    eway_bill_no: d.ewayBillNo || null,
    eway_bill_date: d.ewayBillDate || null,
    recipient_label: d.recipientLabel || null,
    party_name: d.partyName || null,
    party_address: d.partyAddress || null,
    party_gst_no: d.partyGstNo || null,
    place_of_supply: d.placeOfSupply || null,
    state: d.state || null,
    state_code: d.stateCode || null,
    transporter_mode: d.transporterMode || null,
    vehicle_number: d.vehicleNumber || null,

    cgst_rate: parseNumberInput(d.cgstRate),
    sgst_rate: parseNumberInput(d.sgstRate),
    igst_rate: parseNumberInput(d.igstRate),
    reverse_charge_gst: parseNumberInput(d.reverseChargeGst),
    round_off: parseNumberInput(d.roundOff),

    // `null` asks the server to rebuild the words; a string keeps what is here.
    amount_in_words: d.regenerateWords ? null : d.amountInWords || null,

    bank_details: Object.fromEntries(
      BILL_BANK_PARTS.map((p) => [
        p.key,
        {
          // The label the invoice already prints, so `label + value` reproduces the
          // line exactly instead of retyping it with different punctuation.
          label: bankLabels[p.key] ?? defaultBankLabel(p.key),
          value: d.bank[p.key]?.trim() ?? "",
        },
      ])
    ),

    terms: d.terms || null,
    certification: d.certification || null,
    on_behalf_of: d.onBehalfOf || null,
    signature_designation: d.signatureDesignation || null,
    receiver_signature: d.receiverSignature || null,

    seller_name: d.sellerName || null,
    seller_descriptor: d.sellerDescriptor || null,
    seller_tax_line: d.sellerTaxLine || null,
    seller_address: d.sellerAddress || null,
    seller_contact: d.sellerContact || null,

    line_items: d.lines
      .filter((l) => l.description.trim() !== "")
      .map((l, i) => ({
        sr_no: parseNumberInput(l.srNo) ?? i + 1,
        description: l.description.trim(),
        hsn_code: l.hsnCode.trim() || null,
        uom: l.uom.trim() || null,
        quantity: parseNumberInput(l.quantity),
        rate: parseNumberInput(l.rate),
      })),
  };
}

function defaultBankLabel(key: string): string {
  switch (key) {
    case "bank_name":
      return "Bank Name:";
    case "account_number":
      return "ACCOUNT NUMBER:";
    case "branch":
      return "BRANCH:";
    default:
      return "IFSC CODE:";
  }
}

/** ISO date in, ISO date out. A `date` input needs `YYYY-MM-DD`. */
const isoDate = (value: string): string => (value === "" ? "" : value);

export default function BillEditModal({
  billId,
  onClose,
  onSaved,
}: {
  billId: string;
  onClose: () => void;
  /** The bill's id and the new document version, so the caller can refresh. */
  onSaved: (billId: string, pdfVersion: number) => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "saving" | "generating" | "done">("idle");
  /** The draft as loaded, kept for the "has anything changed" comparison.
     * State rather than a ref: the comparison happens during render, and a ref read
     * during render is not something React can track. */
  const [initial, setInitial] = useState<Draft | null>(null);
  /** The bank labels as loaded, so `label + value` reproduces the printed line. */
  const [bankLabels, setBankLabels] = useState<Record<string, string>>({});

  /**
   * Read the bill and its line items and turn them into the form.
   *
   * Pure apart from the two setters it must perform, so the effect below can decide
   * what to render: the effect owns the "am I loading / did it fail" transitions.
   */
  const fetchDraft = useCallback(async (): Promise<Draft> => {
    const [row, items] = await Promise.all([fetchBill(billId), fetchBillLineItems(billId)]);
    setBill(row);
    const parts = bankPartsOf(row.bank_details);
    setBankLabels(
      Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.label ?? defaultBankLabel(k)]))
    );
    return toDraft(row, items);
  }, [billId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await fetchDraft();
      setInitial(loaded);
      setDraft(loaded);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "This bill could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [fetchDraft]);

  /* Started inside an async IIFE rather than by calling `load()`. `load` sets state
     synchronously on its first line, and a setState in an effect body cascades an
     extra render before anything has been fetched. Awaiting first puts every state
     change after a real boundary. `cancelled` stops a response that arrives after the
     modal has closed from writing to a gone component. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchDraft();
        if (cancelled) return;
        setInitial(loaded);
        setDraft(loaded);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "This bill could not be opened.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchDraft]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const setLine = useCallback((key: string, field: keyof DraftLine, value: string) => {
    setDraft((prev) =>
      prev
        ? { ...prev, lines: prev.lines.map((l) => (l.key === key ? { ...l, [field]: value } : l)) }
        : prev
    );
  }, []);

  const addLine = useCallback(() => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            lines: [
              ...prev.lines,
              {
                key: newKey(),
                srNo: String(prev.lines.length + 1),
                description: "",
                hsnCode: "",
                uom: "",
                quantity: "",
                rate: "",
              },
            ],
          }
        : prev
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setDraft((prev) => (prev ? { ...prev, lines: prev.lines.filter((l) => l.key !== key) } : prev));
  }, []);

  const moveLine = useCallback((key: string, delta: -1 | 1) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const lines = [...prev.lines];
      const i = lines.findIndex((l) => l.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= lines.length) return prev;
      [lines[i], lines[j]] = [lines[j], lines[i]];
      // Re-number with the row, so SR.NO. on the invoice follows the order the user
      // chose rather than keeping the number the row used to have.
      return { ...prev, lines: lines.map((l, idx) => ({ ...l, srNo: String(idx + 1) })) };
    });
  }, []);

  /* The figures as they will be after this save, computed locally so the user can
     see the effect of a quantity or rate change before committing to it. The server
     recomputes all of it and the saved values are what print; see `previewTotals`. */
  const totals = useMemo(() => {
    if (!draft || !bill) return null;
    return previewTotals({
      lineItems: draft.lines
        .filter((l) => l.description.trim() !== "")
        .map((l) => ({ quantity: parseNumberInput(l.quantity), rate: parseNumberInput(l.rate) })),
      cgstRate: parseNumberInput(draft.cgstRate),
      sgstRate: parseNumberInput(draft.sgstRate),
      igstRate: parseNumberInput(draft.igstRate),
      roundOff: parseNumberInput(draft.roundOff),
      charged: { cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst },
    });
  }, [draft, bill]);

  /* Whether anything has actually changed.
     Compared against the draft as it was LOADED, rather than against a freshly
     rebuilt one, because a rebuild cannot reproduce the line items and would report
     a change on an untouched form. A save that writes identical values still bumps
     the document version and re-prints all three copies, so the button is disabled
     rather than allowed to spend that for nothing. */
  const dirty = useMemo(() => {
    if (!draft) return false;
    return !!initial && JSON.stringify(draft) !== JSON.stringify(initial);
  }, [draft, initial]);

  const saving = stage === "saving" || stage === "generating";

  async function save() {
    if (!draft) return;
    setStage("saving");
    setSaveError(null);
    try {
      const result = await updateBill(billId, toPatch(draft, bankLabels), (next) => setStage(next));
      toast.success({
        title: "Bill saved",
        description: `Invoice ${result.amount_after_tax !== null ? "" : ""}${
          draft.invoiceNo || "this bill"
        } and its three PDFs were regenerated (version ${result.pdf_version}).`,
      });
      onSaved(billId, result.pdf_version);
      onClose();
    } catch (err) {
      setStage("idle");
      // The server restores the bill on any failure after the first write, so the
      // message can promise the previous version is still in place — and it means
      // the existing PDFs still open.
      setSaveError(
        err instanceof Error
          ? err.message
          : "The bill could not be saved. Nothing has changed."
      );
    }
  }

  const title = `Edit Bill — ${bill?.invoice_no ?? draft?.invoiceNo ?? "loading"}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle="Saving regenerates ORIGINAL, DUPLICATE and TRIPLICATE from this bill only. Other invoices are untouched."
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <p className="text-xs text-text-muted flex items-center gap-1.5">
            {stage === "generating" ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Generating PDFs…
              </>
            ) : stage === "saving" ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Check size={13} className="text-success" /> Ready
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-text-secondary hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading || !draft || !dirty}
              title={dirty ? undefined : "No changes to save"}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-sm font-bold text-[var(--theme-primary-text)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      }
    >
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading this bill…
        </div>
      )}

      {loadError && !loading && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle size={22} className="text-danger" />
          <p className="text-sm text-text">{loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-text-secondary hover:bg-surface-hover cursor-pointer"
          >
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}

      {saveError && !loading && draft && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-muted px-4 py-3">
          <AlertTriangle size={15} className="text-danger mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-text">The bill was not saved</p>
            <p className="text-xs text-text-secondary mt-0.5 leading-snug">{saveError}</p>
            <p className="text-xs text-text-muted mt-1">
              The previous version of this bill and its three PDFs are unchanged and still open.
            </p>
          </div>
        </div>
      )}

      {draft && !loading && (
        <div className="space-y-4">
          <SectionCard
            title="Bill information"
            description="The invoice's own identifiers. The copy designation is not here: ORIGINAL, DUPLICATE and TRIPLICATE are three printings of this one bill."
          >
            <Field label="Job type" hint="Printed on the invoice as the classification badge.">
              <TextInput value={draft.jobKind} onChange={(v) => set("jobKind", v)} placeholder="LABOUR JOB" />
            </Field>
            <Field label="Invoice number" hint="Required. Also names the downloaded PDF.">
              <TextInput value={draft.invoiceNo} onChange={(v) => set("invoiceNo", v)} placeholder="SEW/316/2026-27" />
            </Field>
            <Field label="Invoice date">
              <TextInput type="date" value={isoDate(draft.invoiceDate)} onChange={(v) => set("invoiceDate", v)} />
            </Field>
            <Field label="Order number label" hint='As printed, e.g. "Service Order No.:" or "Purchase Order No.:".'>
              <TextInput value={draft.orderNoLabel} onChange={(v) => set("orderNoLabel", v)} />
            </Field>
            <Field label="Order number">
              <TextInput value={draft.orderNo} onChange={(v) => set("orderNo", v)} />
            </Field>
            <Field label="Order date">
              <TextInput type="date" value={isoDate(draft.orderDate)} onChange={(v) => set("orderDate", v)} />
            </Field>
            <Field label="Our challan number">
              <TextInput value={draft.ourChallanNo} onChange={(v) => set("ourChallanNo", v)} />
            </Field>
            <Field label="Our challan date">
              <TextInput type="date" value={isoDate(draft.ourChallanDate)} onChange={(v) => set("ourChallanDate", v)} />
            </Field>
            <Field label="Your challan number">
              <TextInput value={draft.yourChallanNo} onChange={(v) => set("yourChallanNo", v)} />
            </Field>
            <Field label="Your challan date">
              <TextInput type="date" value={isoDate(draft.yourChallanDate)} onChange={(v) => set("yourChallanDate", v)} />
            </Field>
            <Field label="E-way bill number" hint="Left blank on purpose? The row still prints.">
              <TextInput value={draft.ewayBillNo} onChange={(v) => set("ewayBillNo", v)} />
            </Field>
            <Field label="E-way bill date">
              <TextInput type="date" value={isoDate(draft.ewayBillDate)} onChange={(v) => set("ewayBillDate", v)} />
            </Field>
          </SectionCard>

          <SectionCard
            title="Recipient / billed to"
            description="The address keeps its line breaks, so the invoice prints it the way the workbook did."
            cols={3}
          >
            <Field label="Recipient name">
              <TextInput value={draft.partyName} onChange={(v) => set("partyName", v)} />
            </Field>
            <Field label="Block heading" hint="e.g. Details of Receipient (Billed To)">
              <TextInput value={draft.recipientLabel} onChange={(v) => set("recipientLabel", v)} />
            </Field>
            <Field label="GST number">
              <TextInput value={draft.partyGstNo} onChange={(v) => set("partyGstNo", v.toUpperCase())} placeholder="27AAACH1784M1Z9" />
            </Field>
            <Field label="Address" wide hint="One address line per line of this box.">
              <TextArea value={draft.partyAddress} onChange={(v) => set("partyAddress", v)} rows={4} />
            </Field>
            <Field label="Place of supply">
              <TextInput value={draft.placeOfSupply} onChange={(v) => set("placeOfSupply", v)} />
            </Field>
            <Field label="State">
              <TextInput value={draft.state} onChange={(v) => set("state", v)} />
            </Field>
            <Field label="State code">
              <TextInput inputMode="numeric" value={draft.stateCode} onChange={(v) => set("stateCode", v)} />
            </Field>
          </SectionCard>

          <SectionCard
            title="Transport"
            description="Printed on the right of the invoice, under the reference table."
          >
            <Field label="Transporter" hint="The mode as the invoice names it, e.g. VEHICLE.">
              <TextInput value={draft.transporterMode} onChange={(v) => set("transporterMode", v)} />
            </Field>
            <Field label="Vehicle number">
              <TextInput value={draft.vehicleNumber} onChange={(v) => set("vehicleNumber", v)} />
            </Field>
          </SectionCard>

          {/* ── Line items ── */}
          <section className="rounded-xl border border-border bg-surface overflow-hidden">
            <header className="px-4 py-3 border-b border-border bg-bg-secondary flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text">Line items</h3>
                <p className="text-xs text-text-muted mt-0.5 leading-snug">
                  Each amount is quantity × rate. Rows with no description are left out.
                </p>
              </div>
              <button
                type="button"
                onClick={addLine}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-text-secondary hover:border-primary hover:text-primary transition-colors cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Plus size={13} /> Add line
              </button>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                    <th className="text-left font-bold px-3 py-2 w-14">SR.NO.</th>
                    <th className="text-left font-bold px-3 py-2">Description</th>
                    <th className="text-left font-bold px-3 py-2 w-28">HSN code</th>
                    <th className="text-left font-bold px-3 py-2 w-20">UOM</th>
                    <th className="text-right font-bold px-3 py-2 w-28">Quantity</th>
                    <th className="text-right font-bold px-3 py-2 w-32">Rate</th>
                    <th className="text-right font-bold px-3 py-2 w-32">Amount</th>
                    <th className="px-3 py-2 w-28" />
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((line, i) => {
                    const qty = parseNumberInput(line.quantity);
                    const rate = parseNumberInput(line.rate);
                    const amount = qty !== null && rate !== null ? qty * rate : null;
                    return (
                      <tr key={line.key} className="border-b border-border/60 last:border-0 align-top">
                        <td className="px-3 py-2">
                          <NumberInput
                            value={line.srNo}
                            onChange={(v) => setLine(line.key, "srNo", v)}
                            disabled={saving}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <textarea
                            rows={2}
                            value={line.description}
                            disabled={saving}
                            onChange={(e) => setLine(line.key, "description", e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-y disabled:opacity-60"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <TextInput value={line.hsnCode} onChange={(v) => setLine(line.key, "hsnCode", v)} disabled={saving} />
                        </td>
                        <td className="px-3 py-2">
                          <TextInput value={line.uom} onChange={(v) => setLine(line.key, "uom", v)} disabled={saving} />
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput
                            value={line.quantity}
                            onChange={(v) => setLine(line.key, "quantity", v)}
                            disabled={saving}
                            align="right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput
                            value={line.rate}
                            onChange={(v) => setLine(line.key, "rate", v)}
                            disabled={saving}
                            align="right"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-text-secondary tabular-nums pt-4">
                          {amount === null ? "—" : formatMoney(Math.round(amount * 100) / 100)}
                        </td>
                        <td className="px-3 py-2 pt-3">
                          <div className="flex items-center justify-end gap-1">
                            <LineButton
                              label="Move up"
                              disabled={saving || i === 0}
                              onClick={() => moveLine(line.key, -1)}
                              icon={<ArrowUp size={13} />}
                            />
                            <LineButton
                              label="Move down"
                              disabled={saving || i === draft.lines.length - 1}
                              onClick={() => moveLine(line.key, 1)}
                              icon={<ArrowDown size={13} />}
                            />
                            <LineButton
                              label="Remove line"
                              disabled={saving}
                              danger
                              onClick={() => removeLine(line.key)}
                              icon={<Trash2 size={13} />}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {draft.lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-sm text-text-muted">
                        No line items. Use “Add line” to put one on the invoice.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Tax and totals ── */}
          <SectionCard
            title="Tax & totals"
            description="Rates are what the business charges and may be corrected. Every amount below them is arithmetic and is recomputed when you save."
          >
            <Field label="CGST rate %">
              <NumberInput value={draft.cgstRate} onChange={(v) => set("cgstRate", v)} align="right" disabled={saving} />
            </Field>
            <Field label="SGST rate %">
              <NumberInput value={draft.sgstRate} onChange={(v) => set("sgstRate", v)} align="right" disabled={saving} />
            </Field>
            <Field label="IGST rate %" hint="Printed even at 0.00, which is how the workbook shows the slab.">
              <NumberInput value={draft.igstRate} onChange={(v) => set("igstRate", v)} align="right" disabled={saving} />
            </Field>
            <Field label="Round off" hint="A decision, not a calculation. It is added to reach the invoice total.">
              <NumberInput value={draft.roundOff} onChange={(v) => set("roundOff", v)} align="right" disabled={saving} />
            </Field>
            <Field label="GST payable on reverse charge" hint="Left blank, the row still prints.">
              <NumberInput
                value={draft.reverseChargeGst}
                onChange={(v) => set("reverseChargeGst", v)}
                align="right"
                disabled={saving}
              />
            </Field>
            <Field label="Total invoice amount in words">
              <div className="flex items-center gap-2">
                <TextInput
                  value={draft.regenerateWords ? "" : draft.amountInWords}
                  onChange={(v) => {
                    setDraft((p) => (p ? { ...p, amountInWords: v, regenerateWords: false } : p));
                  }}
                  disabled={saving || draft.regenerateWords}
                  placeholder={draft.regenerateWords ? "Rebuilt from the total on save" : undefined}
                />
                <button
                  type="button"
                  title="Rebuild the words from the new total on save"
                  disabled={saving}
                  onClick={() => set("regenerateWords", !draft.regenerateWords)}
                  className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 shrink-0 ${
                    draft.regenerateWords
                      ? "border-primary bg-primary text-[var(--theme-primary-text)]"
                      : "border-border text-text-secondary hover:border-primary hover:text-primary"
                  }`}
                >
                  <Wand2 size={13} />
                </button>
              </div>
            </Field>

            <div className="sm:col-span-2 mt-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Calculated label="Total quantity" value={formatQuantity(totals?.totalQuantity ?? null)} />
              <Calculated label="Amount before tax" value={formatMoney(totals?.amountBeforeTax ?? null)} />
              <Calculated label="CGST" value={formatMoney(totals?.cgst ?? null)} />
              <Calculated label="SGST" value={formatMoney(totals?.sgst ?? null)} />
              <Calculated label="IGST" value={formatMoney(totals?.igst ?? null)} />
              <Calculated label="Total GST" value={formatMoney(totals?.totalGst ?? null)} />
              <Calculated
                label="Total after tax"
                value={formatMoney(totals?.amountAfterTax ?? null)}
                strong
              />
              <Calculated
                label="Supply"
                value={
                  (bill?.igst ?? 0) !== 0 && (bill?.cgst ?? 0) === 0 && (bill?.sgst ?? 0) === 0
                    ? "Inter-state (IGST)"
                    : "Intra-state (CGST + SGST)"
                }
              />
            </div>
          </SectionCard>

          <SectionCard title="Bank details" cols={2}>
            {BILL_BANK_PARTS.map((part) => (
              <Field key={part.key} label={part.label}>
                <TextInput
                  value={draft.bank[part.key] ?? ""}
                  onChange={(v) => set("bank", { ...draft.bank, [part.key]: v })}
                  disabled={saving}
                />
              </Field>
            ))}
          </SectionCard>

          <SectionCard
            title="Terms & conditions"
            description="One term per line. A payment window such as “40 DAYS” is emphasised on the PDF automatically."
            cols={1}
          >
            <TextArea value={draft.terms} onChange={(v) => set("terms", v)} rows={5} disabled={saving} />
          </SectionCard>

          <SectionCard title="Footer & certification" cols={2}>
            <Field label="Certification">
              <TextArea
                value={draft.certification}
                onChange={(v) => set("certification", v)}
                rows={2}
                disabled={saving}
              />
            </Field>
            <Field label="For (supplier)">
              <TextInput value={draft.onBehalfOf} onChange={(v) => set("onBehalfOf", v)} disabled={saving} />
            </Field>
            <Field label="Designation">
              <TextInput
                value={draft.signatureDesignation}
                onChange={(v) => set("signatureDesignation", v)}
                disabled={saving}
              />
            </Field>
            <Field label="Receiver's signature">
              <TextInput
                value={draft.receiverSignature}
                onChange={(v) => set("receiverSignature", v)}
                disabled={saving}
              />
            </Field>
          </SectionCard>

          <SectionCard
            title="Seller header"
            description="The supplier's own block at the top of the invoice."
            cols={1}
          >
            <Field label="Name">
              <TextInput value={draft.sellerName} onChange={(v) => set("sellerName", v)} disabled={saving} />
            </Field>
            <Field label="Description">
              <TextInput
                value={draft.sellerDescriptor}
                onChange={(v) => set("sellerDescriptor", v)}
                disabled={saving}
              />
            </Field>
            <Field label="GST / MSME line">
              <TextInput value={draft.sellerTaxLine} onChange={(v) => set("sellerTaxLine", v)} disabled={saving} />
            </Field>
            <Field label="Address">
              <TextArea value={draft.sellerAddress} onChange={(v) => set("sellerAddress", v)} rows={2} disabled={saving} />
            </Field>
            <Field label="Email / phone">
              <TextArea value={draft.sellerContact} onChange={(v) => set("sellerContact", v)} rows={2} disabled={saving} />
            </Field>
          </SectionCard>
        </div>
      )}
    </Modal>
  );
}

function LineButton({
  label,
  onClick,
  icon,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-md border border-border transition-colors cursor-pointer disabled:opacity-40 ${
        danger ? "text-danger hover:bg-danger-muted" : "text-text-muted hover:text-text hover:bg-surface-hover"
      }`}
    >
      {icon}
    </button>
  );
}

export type { BillCopy };
