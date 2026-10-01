// src/components/bills/BillEditScreen.tsx
//
// Edit one bill on a phone, save it, and re-print its three copies.
//
// A full-screen sheet rather than a dialog, because this form is long: a modal that
// scrolls on a phone hides the field being typed into behind the keyboard and the
// section header that gives it meaning. A sheet scrolls as one surface.
//
// The sections are in the order the invoice prints, so a user correcting a printed
// invoice finds each field where they would look for it on the page.
//
// WHAT A SAVE DOES, AND WHY THE SCREEN SAYS SO
// One request goes to the `update-bill` edge function, which validates, writes the
// row, replaces the line items, regenerates ORIGINAL / DUPLICATE / TRIPLICATE from
// the SAVED values, and only then points the row at the new documents. If any of
// that fails the bill is restored to exactly what it was, so this screen can tell
// the user the previous PDFs still open instead of showing a success message over a
// half-saved bill.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  bankPartsOf,
  fetchBill,
  fetchBillLineItems,
  formatMoney,
  formatQuantity,
  previewTotals,
  updateBill,
} from "../../services/bills";
import { BILL_BANK_PARTS, type Bill, type BillPatch } from "../../types/bill";
import { notify } from "../../utils/notify";
import { Button } from "../ui/Button";

interface DraftLine {
  key: string;
  srNo: string;
  description: string;
  hsnCode: string;
  uom: string;
  quantity: string;
  rate: string;
}

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
const n = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

let lineKey = 0;
const newKey = (): string => `line-${++lineKey}`;

function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
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

export function BillEditScreen({
  billId,
  onClose,
  onSaved,
}: {
  billId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "saving" | "generating">("idle");
  /** The draft as loaded, kept so "has anything changed" can be answered from state.
     * State rather than a ref because the comparison happens during render, and a ref
     * read during render is not something React can track. */
  const [initial, setInitial] = useState<Draft | null>(null);
  /** The bank labels as loaded, so `label + value` reproduces the printed line. */
  const bankLabels = useRef<Record<string, string>>({});

  /**
   * Read the bill and its line items, and turn them into the form.
   *
   * Pure apart from the `bankLabels` ref, so the effect below can call it without
   * deciding what to render: the effect owns the "am I loading / did it fail"
   * transitions, and this only produces the draft.
   */
  const fetchDraft = useCallback(async (): Promise<Draft> => {
    const [row, items] = await Promise.all([fetchBill(billId), fetchBillLineItems(billId)]);
    setBill(row);
    const parts = bankPartsOf(row.bank_details);
    bankLabels.current = Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [k, v.label ?? defaultBankLabel(k)])
    );
    return {
      jobKind: s(row.job_kind),
      invoiceNo: s(row.invoice_no),
      invoiceDate: s(row.invoice_date),
      ourChallanNo: s(row.our_challan_no),
      ourChallanDate: s(row.our_challan_date),
      yourChallanNo: s(row.your_challan_no),
      yourChallanDate: s(row.your_challan_date),
      orderNoLabel: s(row.order_no_label),
      orderNo: s(row.order_no),
      orderDate: s(row.order_date),
      ewayBillNo: s(row.eway_bill_no),
      ewayBillDate: s(row.eway_bill_date),
      recipientLabel: s(row.recipient_label),
      partyName: s(row.party_name),
      partyAddress: s(row.party_address),
      partyGstNo: s(row.party_gst_no),
      placeOfSupply: s(row.place_of_supply),
      state: s(row.state),
      stateCode: s(row.state_code),
      transporterMode: s(row.transporter_mode),
      vehicleNumber: s(row.vehicle_number),
      cgstRate: n(row.cgst_rate),
      sgstRate: n(row.sgst_rate),
      igstRate: n(row.igst_rate),
      reverseChargeGst: n(row.reverse_charge_gst),
      roundOff: n(row.round_off),
      amountInWords: s(row.amount_in_words),
      regenerateWords: false,
      bank: Object.fromEntries(BILL_BANK_PARTS.map((p) => [p.key, s(parts[p.key]?.value)])),
      terms: s(row.terms),
      certification: s(row.certification),
      onBehalfOf: s(row.on_behalf_of),
      signatureDesignation: s(row.signature_designation),
      receiverSignature: s(row.receiver_signature),
      sellerName: s(row.seller_name),
      sellerDescriptor: s(row.seller_descriptor),
      sellerTaxLine: s(row.seller_tax_line),
      sellerAddress: s(row.seller_address),
      sellerContact: s(row.seller_contact),
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

  /* The work is started inside an async IIFE rather than by calling `load()`.
     `load` sets state synchronously on its first line, and a setState in an effect
     body cascades an extra render before anything has been fetched. Awaiting first
     means every state change happens after a real boundary. `cancelled` stops a
     response arriving after the sheet has closed from writing to a dead component. */
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
      // Re-number with the row, so SR.NO. on the invoice follows the order chosen.
      return { ...prev, lines: lines.map((l, idx) => ({ ...l, srNo: String(idx + 1) })) };
    });
  }, []);

  const totals = useMemo(() => {
    if (!draft || !bill) return null;
    return previewTotals({
      lineItems: draft.lines
        .filter((l) => l.description.trim() !== "")
        .map((l) => ({ quantity: parseNumber(l.quantity), rate: parseNumber(l.rate) })),
      cgstRate: parseNumber(draft.cgstRate),
      sgstRate: parseNumber(draft.sgstRate),
      igstRate: parseNumber(draft.igstRate),
      roundOff: parseNumber(draft.roundOff),
      charged: { cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst },
    });
  }, [draft, bill]);

  const dirty = useMemo(
    () => !!draft && !!initial && JSON.stringify(draft) !== JSON.stringify(initial),
    [draft, initial]
  );

  const saving = stage !== "idle";

  function toPatch(d: Draft): BillPatch {
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
      cgst_rate: parseNumber(d.cgstRate),
      sgst_rate: parseNumber(d.sgstRate),
      igst_rate: parseNumber(d.igstRate),
      reverse_charge_gst: parseNumber(d.reverseChargeGst),
      round_off: parseNumber(d.roundOff),
      amount_in_words: d.regenerateWords ? null : d.amountInWords || null,
      bank_details: Object.fromEntries(
        BILL_BANK_PARTS.map((p) => [
          p.key,
          {
            label: bankLabels.current[p.key] ?? defaultBankLabel(p.key),
            value: (d.bank[p.key] ?? "").trim(),
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
          sr_no: parseNumber(l.srNo) ?? i + 1,
          description: l.description.trim(),
          hsn_code: l.hsnCode.trim() || null,
          uom: l.uom.trim() || null,
          quantity: parseNumber(l.quantity),
          rate: parseNumber(l.rate),
        })),
    };
  }

  async function save() {
    if (!draft) return;
    setStage("saving");
    setSaveError(null);
    try {
      const result = await updateBill(billId, toPatch(draft), (next) =>
        setStage(next === "done" ? "generating" : next)
      );
      notify(
        "Bill saved",
        `${draft.invoiceNo || "This bill"} and its three PDFs were regenerated (version ${result.pdf_version}).`
      );
      onSaved();
      onClose();
    } catch (err) {
      setStage("idle");
      // The server restores the bill on any failure after the first write, so this
      // can promise the previous version is still in place and still opens.
      setSaveError(
        err instanceof Error
          ? err.message
          : "The bill could not be saved. Nothing has changed."
      );
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Close without saving"
            hitSlop={10}
          >
            <Text style={styles.headerBack}>← Back</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Edit Bill — {bill?.invoice_no ?? draft?.invoiceNo ?? "…"}
          </Text>
          <Text style={styles.headerMeta} numberOfLines={1}>
            {bill?.updated_at ? "edited" : "imported"}
          </Text>
        </View>

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.muted}>Loading this bill…</Text>
          </View>
        )}

        {loadError && !loading && (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Button title="Try again" onPress={() => void load()} variant="ghost" />
          </View>
        )}

        {saveError && !loading && draft && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorTitle}>The bill was not saved</Text>
            <Text style={styles.errorText}>{saveError}</Text>
            <Text style={styles.errorHint}>
              The previous version of this bill and its three PDFs are unchanged and still open.
            </Text>
          </View>
        )}

        {draft && !loading && (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={styles.intro}>
              Saving regenerates ORIGINAL, DUPLICATE and TRIPLICATE from this bill only. Other invoices
              from the same workbook are untouched.
            </Text>

            {/* ── Bill information ── */}
            <Section title="Bill information" styles={styles}>
              <Text style={styles.note}>
                The copy designation is not here: the three copies are three printings of this one
                bill.
              </Text>
              <Field label="Job type" styles={styles} value={draft.jobKind} onChange={(v) => set("jobKind", v)} />
              <Field
                label="Invoice number *"
                styles={styles}
                value={draft.invoiceNo}
                onChange={(v) => set("invoiceNo", v)}
                placeholder="SEW/316/2026-27"
              />
              <Field label="Invoice date" styles={styles} value={draft.invoiceDate} onChange={(v) => set("invoiceDate", v)} placeholder="YYYY-MM-DD" />
              <Field label="Order number label" styles={styles} value={draft.orderNoLabel} onChange={(v) => set("orderNoLabel", v)} />
              <Field label="Order number" styles={styles} value={draft.orderNo} onChange={(v) => set("orderNo", v)} />
              <Field label="Order date" styles={styles} value={draft.orderDate} onChange={(v) => set("orderDate", v)} placeholder="YYYY-MM-DD" />
              <Field label="Our challan number" styles={styles} value={draft.ourChallanNo} onChange={(v) => set("ourChallanNo", v)} />
              <Field label="Our challan date" styles={styles} value={draft.ourChallanDate} onChange={(v) => set("ourChallanDate", v)} placeholder="YYYY-MM-DD" />
              <Field label="Your challan number" styles={styles} value={draft.yourChallanNo} onChange={(v) => set("yourChallanNo", v)} />
              <Field label="Your challan date" styles={styles} value={draft.yourChallanDate} onChange={(v) => set("yourChallanDate", v)} placeholder="YYYY-MM-DD" />
              <Field label="E-way bill number" styles={styles} value={draft.ewayBillNo} onChange={(v) => set("ewayBillNo", v)} />
              <Field label="E-way bill date" styles={styles} value={draft.ewayBillDate} onChange={(v) => set("ewayBillDate", v)} placeholder="YYYY-MM-DD" />
            </Section>

            {/* ── Recipient ── */}
            <Section title="Recipient / billed to" styles={styles}>
              <Text style={styles.note}>
                The address keeps its line breaks, so the invoice prints it the way the workbook did.
              </Text>
              <Field label="Recipient name" styles={styles} value={draft.partyName} onChange={(v) => set("partyName", v)} />
              <Field
                label="Address"
                styles={styles}
                value={draft.partyAddress}
                onChange={(v) => set("partyAddress", v)}
                multiline
                rows={4}
              />
              <Field label="Block heading" styles={styles} value={draft.recipientLabel} onChange={(v) => set("recipientLabel", v)} />
              <Field label="GST number" styles={styles} value={draft.partyGstNo} onChange={(v) => set("partyGstNo", v.toUpperCase())} />
              <Field label="Place of supply" styles={styles} value={draft.placeOfSupply} onChange={(v) => set("placeOfSupply", v)} />
              <Field label="State" styles={styles} value={draft.state} onChange={(v) => set("state", v)} />
              <Field label="State code" styles={styles} value={draft.stateCode} onChange={(v) => set("stateCode", v)} />
            </Section>

            {/* ── Transport ── */}
            <Section title="Transport" styles={styles}>
              <Text style={styles.note}>
                Printed on the right of the invoice, under the reference table.
              </Text>
              <Field label="Transporter" styles={styles} value={draft.transporterMode} onChange={(v) => set("transporterMode", v)} />
              <Field label="Vehicle number" styles={styles} value={draft.vehicleNumber} onChange={(v) => set("vehicleNumber", v)} />
            </Section>

            {/* ── Line items ── */}
            <Section title="Line items" styles={styles}>
              <Text style={styles.note}>
                Each amount is quantity × rate. Rows with no description are left out. Use the arrows to
                change the order the invoice prints them in.
              </Text>
              {draft.lines.map((line, i) => {
                const qty = parseNumber(line.quantity);
                const rate = parseNumber(line.rate);
                const amount = qty !== null && rate !== null ? Math.round(qty * rate * 100) / 100 : null;
                return (
                  <View key={line.key} style={styles.lineCard}>
                    <View style={styles.lineHead}>
                      <Text style={styles.lineNo}>SR.NO. {line.srNo || i + 1}</Text>
                      <View style={styles.lineTools}>
                        <SmallButton
                          label="Move up"
                          disabled={saving || i === 0}
                          onPress={() => moveLine(line.key, -1)}
                          text="↑"
                        />
                        <SmallButton
                          label="Move down"
                          disabled={saving || i === draft.lines.length - 1}
                          onPress={() => moveLine(line.key, 1)}
                          text="↓"
                        />
                        <SmallButton
                          label="Remove line"
                          disabled={saving}
                          onPress={() => removeLine(line.key)}
                          text="✕"
                          danger
                        />
                      </View>
                    </View>
                    <Field
                      label="Description"
                      styles={styles}
                      value={line.description}
                      onChange={(v) => setLine(line.key, "description", v)}
                      multiline
                      rows={2}
                    />
                    <View style={styles.row3}>
                      <View style={styles.cell}>
                        <Field label="HSN" styles={styles} value={line.hsnCode} onChange={(v) => setLine(line.key, "hsnCode", v)} />
                      </View>
                      <View style={styles.cell}>
                        <Field label="UOM" styles={styles} value={line.uom} onChange={(v) => setLine(line.key, "uom", v)} />
                      </View>
                      <View style={styles.cell}>
                        <Field
                          label="Amount"
                          styles={styles}
                          value={amount === null ? "" : formatMoney(amount)}
                          onChange={() => undefined}
                          editable={false}
                        />
                      </View>
                    </View>
                    <View style={styles.row2}>
                      <View style={styles.cell}>
                        <Field label="Quantity" styles={styles} value={line.quantity} onChange={(v) => setLine(line.key, "quantity", v)} keyboardType="decimal-pad" />
                      </View>
                      <View style={styles.cell}>
                        <Field label="Rate" styles={styles} value={line.rate} onChange={(v) => setLine(line.key, "rate", v)} keyboardType="decimal-pad" />
                      </View>
                    </View>
                  </View>
                );
              })}
              <Button title="+ Add line" onPress={addLine} variant="ghost" disabled={saving} />
            </Section>

            {/* ── Tax & totals ── */}
            <Section title="Tax & totals" styles={styles}>
              <Text style={styles.note}>
                Rates are what the business charges and may be corrected. Every amount below is
                arithmetic and is recomputed when you save.
              </Text>
              <View style={styles.row2}>
                <View style={styles.cell}>
                  <Field label="CGST %" styles={styles} value={draft.cgstRate} onChange={(v) => set("cgstRate", v)} keyboardType="decimal-pad" />
                </View>
                <View style={styles.cell}>
                  <Field label="SGST %" styles={styles} value={draft.sgstRate} onChange={(v) => set("sgstRate", v)} keyboardType="decimal-pad" />
                </View>
              </View>
              <View style={styles.row2}>
                <View style={styles.cell}>
                  <Field label="IGST %" styles={styles} value={draft.igstRate} onChange={(v) => set("igstRate", v)} keyboardType="decimal-pad" />
                </View>
                <View style={styles.cell}>
                  <Field label="Round off" styles={styles} value={draft.roundOff} onChange={(v) => set("roundOff", v)} keyboardType="decimal-pad" />
                </View>
              </View>
              <Field
                label="GST payable on reverse charge"
                styles={styles}
                value={draft.reverseChargeGst}
                onChange={(v) => set("reverseChargeGst", v)}
                keyboardType="decimal-pad"
              />
              <Field
                label="Total invoice amount in words"
                styles={styles}
                value={draft.regenerateWords ? "" : draft.amountInWords}
                onChange={(v) => setDraft((p) => (p ? { ...p, amountInWords: v, regenerateWords: false } : p))}
                editable={!saving && !draft.regenerateWords}
                placeholder={draft.regenerateWords ? "Rebuilt from the total on save" : undefined}
                multiline
                rows={2}
              />
              <Pressable
                onPress={() => set("regenerateWords", !draft.regenerateWords)}
                disabled={saving}
                accessibilityRole="switch"
                accessibilityState={{ checked: draft.regenerateWords }}
                style={styles.toggleRow}
              >
                <View style={[styles.checkbox, draft.regenerateWords && styles.checkboxOn]} />
                <Text style={styles.toggleText}>Rebuild the words from the new total when saving</Text>
              </Pressable>

              {/* Calculated, read-only. See the note in BillEditFields on the
                  desktop editor for why these are not editable. */}
              <View style={styles.totalsBox}>
                <Text style={styles.totalsHeading}>Calculated when you save</Text>
                <CalcRow label="Total quantity" value={formatQuantity(totals?.totalQuantity ?? null)} styles={styles} />
                <CalcRow label="Amount before tax" value={formatMoney(totals?.amountBeforeTax ?? null)} styles={styles} />
                <CalcRow label="CGST" value={formatMoney(totals?.cgst ?? null)} styles={styles} />
                <CalcRow label="SGST" value={formatMoney(totals?.sgst ?? null)} styles={styles} />
                <CalcRow label="IGST" value={formatMoney(totals?.igst ?? null)} styles={styles} />
                <CalcRow label="Total GST" value={formatMoney(totals?.totalGst ?? null)} styles={styles} />
                <CalcRow label="Total after tax" value={formatMoney(totals?.amountAfterTax ?? null)} styles={styles} strong />
              </View>
            </Section>

            {/* ── Bank ── */}
            <Section title="Bank details" styles={styles}>
              {BILL_BANK_PARTS.map((p) => (
                <Field
                  key={p.key}
                  label={p.label}
                  styles={styles}
                  value={draft.bank[p.key] ?? ""}
                  onChange={(v) => set("bank", { ...draft.bank, [p.key]: v })}
                />
              ))}
            </Section>

            {/* ── Terms ── */}
            <Section title="Terms & conditions" styles={styles}>
              <Text style={styles.note}>
                One term per line. A payment window such as “40 DAYS” is emphasised on the PDF
                automatically.
              </Text>
              <Field label="Terms" styles={styles} value={draft.terms} onChange={(v) => set("terms", v)} multiline rows={5} />
            </Section>

            {/* ── Footer ── */}
            <Section title="Footer & certification" styles={styles}>
              <Field label="Certification" styles={styles} value={draft.certification} onChange={(v) => set("certification", v)} multiline rows={2} />
              <Field label="For (supplier)" styles={styles} value={draft.onBehalfOf} onChange={(v) => set("onBehalfOf", v)} />
              <Field label="Designation" styles={styles} value={draft.signatureDesignation} onChange={(v) => set("signatureDesignation", v)} />
              <Field label="Receiver's signature" styles={styles} value={draft.receiverSignature} onChange={(v) => set("receiverSignature", v)} />
            </Section>

            {/* ── Seller ── */}
            <Section title="Seller header" styles={styles}>
              <Field label="Name" styles={styles} value={draft.sellerName} onChange={(v) => set("sellerName", v)} />
              <Field label="Description" styles={styles} value={draft.sellerDescriptor} onChange={(v) => set("sellerDescriptor", v)} />
              <Field label="GST / MSME line" styles={styles} value={draft.sellerTaxLine} onChange={(v) => set("sellerTaxLine", v)} />
              <Field label="Address" styles={styles} value={draft.sellerAddress} onChange={(v) => set("sellerAddress", v)} multiline rows={2} />
              <Field label="Email / phone" styles={styles} value={draft.sellerContact} onChange={(v) => set("sellerContact", v)} multiline rows={2} />
            </Section>
          </ScrollView>
        )}

        {/* ── Footer actions ── */}
        {draft && !loading && (
          <View style={styles.footer}>
            <Text style={styles.footerStatus}>
              {stage === "generating"
                ? "Generating PDFs…"
                : stage === "saving"
                ? "Saving…"
                : dirty
                ? "Unsaved changes"
                : "No changes"}
            </Text>
            <View style={styles.footerButtons}>
              <Button title="Cancel" onPress={onClose} variant="ghost" disabled={saving} />
              <View style={styles.saveButton}>
                <Button
                  title={saving ? "Saving…" : "Save changes"}
                  onPress={() => void save()}
                  loading={saving}
                  disabled={saving || !dirty}
                />
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ──────────────────────────────────────────────
   Small local components
   ────────────────────────────────────────────── */

type Styles = ReturnType<typeof createStyles>;

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: Styles;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  rows = 1,
  keyboardType,
  editable = true,
  styles,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  editable?: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.inputReadOnly]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={styles.inputPlaceholder.color}
        multiline={multiline}
        numberOfLines={multiline ? rows : 1}
        keyboardType={keyboardType ?? "default"}
        editable={editable}
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}

function CalcRow({
  label,
  value,
  strong,
  styles,
}: {
  label: string;
  value: string;
  strong?: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.calcRow}>
      <Text style={styles.calcLabel}>{label}</Text>
      <Text style={[styles.calcValue, strong && styles.calcValueStrong]}>{value}</Text>
    </View>
  );
}

function SmallButton({
  label,
  onPress,
  text,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  text: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          minWidth: 36,
          height: 36,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? theme.colors.surfaceHover : "transparent",
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: danger ? theme.colors.danger : theme.colors.textSecondary,
          fontSize: theme.textSizes.sm,
          // `as const` because a bare string literal widens to `string`, which React
          // Native's TextStyle rejects.
          fontWeight: "700" as const,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

/* ──────────────────────────────────────────────
   Styles
   ────────────────────────────────────────────── */

function createStyles(theme: AppTheme) {
  return {
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    headerBack: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "700" as const },
    headerTitle: {
      flex: 1,
      textAlign: "center" as const,
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700" as const,
    },
    headerMeta: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, minWidth: 56, textAlign: "right" as const },

    centered: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: theme.spacing.md, padding: theme.spacing.lg },
    muted: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm },

    scrollBody: { padding: theme.spacing.md, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
    intro: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, lineHeight: 18 },

    section: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "800" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
    },
    note: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, lineHeight: 17, marginBottom: 2 },

    field: { gap: 4 },
    fieldLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700" as const,
    },
    input: {
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      minHeight: 44,
    },
    inputMultiline: { minHeight: 80, textAlignVertical: "top" as const },
    inputReadOnly: { backgroundColor: theme.colors.surfaceSecondary, color: theme.colors.textSecondary },
    inputPlaceholder: { color: theme.colors.textMuted },

    row2: { flexDirection: "row" as const, gap: theme.spacing.sm },
    row3: { flexDirection: "row" as const, gap: theme.spacing.sm },
    cell: { flex: 1 },

    lineCard: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    lineHead: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
    },
    lineNo: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "800" as const,
    },
    lineTools: { flexDirection: "row" as const, gap: 6 },

    toggleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: theme.spacing.sm, paddingVertical: 4 },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
    },
    checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    toggleText: { flex: 1, color: theme.colors.textSecondary, fontSize: theme.textSizes.xs },

    totalsBox: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.sm,
      gap: 3,
      marginTop: 4,
    },
    totalsHeading: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "800" as const,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    calcRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: theme.spacing.sm },
    calcLabel: { color: theme.colors.textSecondary, fontSize: theme.textSizes.xs },
    calcValue: { color: theme.colors.textSecondary, fontSize: theme.textSizes.xs, fontWeight: "700" as const },
    calcValueStrong: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "800" as const },

    errorBanner: {
      margin: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      // A danger border on a neutral surface, rather than a tinted fill: the theme
      // has no danger-tinted background, and borrowing the primary tint here would
      // make a failure look like the app's normal accent.
      borderWidth: 1.5,
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.surface,
      gap: 3,
    },
    errorTitle: { color: theme.colors.danger, fontSize: theme.textSizes.sm, fontWeight: "800" as const },
    errorText: { color: theme.colors.text, fontSize: theme.textSizes.sm, lineHeight: 19 },
    errorHint: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, lineHeight: 17 },

    footer: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    footerStatus: { flex: 1, color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    footerButtons: { flexDirection: "row" as const, gap: theme.spacing.sm, alignItems: "center" as const },
    saveButton: { minWidth: 150 },
  };
}
