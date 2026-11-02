// supabase/functions/_selftest/test-document-types.ts
//
// TAX INVOICES AND DELIVERY CHALLANS: TWO DOCUMENT TYPES, NEVER MIXED.
//
// What it proves:
//   A. every sheet is classified from its printed title, checked against its item
//      table — never from the file name, the sheet name or the job kind;
//   B. a workbook uploaded into the wrong section is rejected, by name, with the
//      right destination, and nothing at all is written;
//   C. a mixed workbook is previewed, then split into two logical uploads with
//      their own bills, order, source link and aggregate PDFs — or, if either
//      half fails, neither half is kept;
//   D. the challan PDF is a challan (heading, references, REMARKS, receipt and
//      signatures) with no invoice money, both types handle LABOUR JOB / WITH
//      METAL and run onto several pages, and the invoice PDF is unchanged;
//   E. edits, regeneration and the client services are confined to one type.
//
// The challan workbooks are generated (`challan-fixture.ts`) in the supplied
// template's exact layout with placeholder identities; the tax workbooks are the
// committed sanitised fixtures.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readXlsx, type Sheet } from "../process-bill-upload/_shared/xlsx.ts";
import { classifySheet, classifyWorkbook, planImport } from "../process-bill-upload/_shared/documentType.ts";
import { parseChallanSheet } from "../process-bill-upload/_shared/parseChallan.ts";
import { parseSheet, COPY_LABEL, type BillCopy, type CopyKind } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, toBillRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { computeBillValues } from "../process-bill-upload/_shared/billEdit.ts";
import { importWorkbook, type ImportPorts } from "../process-bill-upload/_shared/importWorkbook.ts";
import { profileFromRow } from "../process-bill-upload/_shared/businessProfile.ts";
import { readPdfStructure } from "../process-bill-upload/_shared/pdf.ts";
import { PermanentError, listWorkbooks, startJob, stepJob, validateScope, LEASE_MS, type RegenerationView } from "../regenerate-bill-pdfs/engine.ts";
import { challanWorkbookSheets, makeChallanSheet, renamed } from "./challan-fixture.ts";
import { writeXlsx } from "./write-xlsx.ts";
import { FakeWorld, REPO } from "./regeneration-fakes.ts";
import * as adminModel from "../../../src/services/billDocumentTypes.ts";

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  — ${detail}` : ""}`);
};
const section = (title: string): void => console.log(`\n${title}`);

const taxSheets = async (file: string): Promise<Sheet[]> => (await readXlsx(readFileSync(resolve(REPO, file)))).sheets;
const bill301 = await taxSheets("BILL 301 TO.xlsx");
const sample = await taxSheets("SAMPLE.xlsx");
const challans = challanWorkbookSheets(20);

const pdfText = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
/** True when `text` is drawn as one text run (PDF strings escape parentheses and backslashes). */
const drawn = (bytes: Uint8Array, text: string): boolean => pdfText(bytes).includes(`(${text.replace(/[()\\]/g, "\\$&")}) Tj`);
const mentions = (bytes: Uint8Array, text: string): boolean => pdfText(bytes).includes(text);

/* ──────────────────────────────────────────────
   A. Classification
   ────────────────────────────────────────────── */

section("A. classification by printed title");
{
  for (const [name, sheets] of [["BILL 301 TO.xlsx", bill301], ["SAMPLE.xlsx", sample]] as const) {
    const c = classifyWorkbook(sheets);
    check(c.groups.tax_invoice.length === sheets.length && c.unknown.length === 0, `every sheet of ${name} is a Tax Invoice (${sheets.length})`);
  }
  const c = classifyWorkbook(challans);
  check(c.groups.delivery_challan.length === 20 && c.groups.tax_invoice.length === 0, "every sheet of a 20-sheet challan workbook is a Delivery Challan");

  // Names that look like the other type change nothing.
  const challanNamedLikeInvoice = renamed(challans[0], "301");
  const invoiceNamedLikeChallan = renamed(bill301[0], "341 L");
  check(classifySheet(challanNamedLikeInvoice, 0).kind === "delivery_challan", "a challan sheet named \"301\" is still a challan");
  check(classifySheet(invoiceNamedLikeChallan, 0).kind === "tax_invoice", "an invoice sheet named \"341 L\" is still an invoice");
  check(
    classifySheet(challans.find((s) => /L$/.test(s.name))!, 0).kind === "delivery_challan" &&
      classifySheet(challans.find((s) => !/L$/.test(s.name))!, 0).kind === "delivery_challan",
    "LABOUR JOB and WITHMETAL challans are both challans: job kind is not document type"
  );

  // Mixed: interleaved, partitioned in order.
  const mixed = [bill301[0], challans[0], bill301[1], challans[1], bill301[2]];
  const mc = classifyWorkbook(mixed);
  check(mc.groups.tax_invoice.join() === "0,2,4" && mc.groups.delivery_challan.join() === "1,3", "a mixed workbook is partitioned sheet by sheet, in order");

  const blank: Sheet = { name: "Sheet9", cells: new Map(), maxRow: 0, maxCol: 0 };
  check(classifyWorkbook([...challans.slice(0, 2), blank]).unknown.length === 0 && classifySheet(blank, 0).kind === "blank", "a blank sheet is ignored");

  // Malformed sheets are reported with a reason, never guessed at.
  const untitled = makeChallanSheet({ sheetName: "notes", challanNo: "X/1", date: 46300, jobKind: "LABOUR JOB", items: [{ description: ["A"], hsn: "1", uom: "NOS", quantity: 1 }] });
  for (const [k, cell] of untitled.cells) if (cell.value === "DELIVERY CHALLAN") untitled.cells.delete(k);
  const challanWithAmount = makeChallanSheet({ sheetName: "odd", challanNo: "X/2", date: 46300, jobKind: "LABOUR JOB", items: [{ description: ["A"], hsn: "1", uom: "NOS", quantity: 1 }] });
  challanWithAmount.cells.set("14:7", { row: 14, col: 7, type: "inline", value: "Amount" });
  const invoiceWithoutAmount = renamed(bill301[0], "cut");
  for (const [k, cell] of invoiceWithoutAmount.cells) if (String(cell.value).trim().toUpperCase() === "AMOUNT") invoiceWithoutAmount.cells.delete(k);
  const both = renamed(challans[2], "both");
  both.cells.set("40:1", { row: 40, col: 1, type: "inline", value: "TAX INVOICE" });
  const reasons = [untitled, challanWithAmount, invoiceWithoutAmount, both].map((s, i) => classifySheet(s, i));
  check(reasons.every((r) => r.kind === "unknown" && !!r.reason), "untitled, wrong-table and double-titled sheets are unknown, each with a reason", JSON.stringify(reasons.map((r) => r.kind)));
  check(/No "TAX INVOICE" or "DELIVERY CHALLAN" title/.test(reasons[0].reason ?? ""), "an untitled sheet says there is no title");
  check(/AMOUNT column, which is the Tax Invoice layout/.test(reasons[1].reason ?? ""), "a challan with an AMOUNT column says so");
  check(/no AMOUNT column/.test(reasons[2].reason ?? ""), "an invoice without an AMOUNT column says so");
  const plan = planImport(classifyWorkbook([challans[0], untitled]), "delivery_challan", false);
  check(plan.action === "reject" && plan.reason === "unrecognized_sheets" && plan.message.includes("'notes'"), "an unknown sheet rejects the whole workbook and names the sheet");
}

/* ──────────────────────────────────────────────
   B-C. Import: wrong section, mixed workbooks, rollback
   ────────────────────────────────────────────── */

class FakeImport {
  uploads = new Map<string, Record<string, unknown>>();
  bills = new Map<string, Record<string, unknown>>();
  lines: Record<string, unknown>[] = [];
  files = new Map<string, Uint8Array>();
  audits: unknown[] = [];
  writes = 0;
  failUpload: ((path: string) => boolean) | null = null;
  private seq = 0;

  ports(): ImportPorts {
    const w = this;
    return {
      async insertUpload(row) {
        w.writes++;
        const id = `up${++w.seq}`;
        w.uploads.set(id, { ...row, id });
        return id;
      },
      async insertBills(rows) {
        w.writes++;
        return rows.map((row) => {
          const upload = w.uploads.get(row.bill_upload_id as string);
          // The 0025 composite foreign key: a bill's type must equal its upload's.
          if (!upload || upload.document_type !== row.document_type) throw new Error("bills_upload_document_type_fkey");
          const id = `bill${++w.seq}`;
          w.bills.set(id, { ...row, id });
          return id;
        });
      },
      async insertLineItems(rows) {
        w.writes++;
        w.lines.push(...rows);
      },
      async updateBillPaths(id, paths) {
        w.writes++;
        Object.assign(w.bills.get(id)!, { original_pdf_path: paths.original, duplicate_pdf_path: paths.duplicate, triplicate_pdf_path: paths.triplicate });
      },
      async finalizeUpload(id, patch) {
        w.writes++;
        Object.assign(w.uploads.get(id)!, patch);
      },
      async uploadPdf(path, bytes) {
        w.writes++;
        if (w.failUpload?.(path)) throw new Error("storage down");
        w.files.set(path, bytes);
      },
      async removePdfs(paths) {
        for (const p of paths) w.files.delete(p);
      },
      async deleteUpload(id) {
        w.uploads.delete(id);
        for (const [bid, b] of w.bills) {
          if (b.bill_upload_id === id) {
            w.bills.delete(bid);
            w.lines = w.lines.filter((l) => l.bill_id !== bid);
          }
        }
      },
      async loadProfile() {
        return profileFromRow(null);
      },
      async audit(entry) {
        w.audits.push(entry);
      },
      newGroupId: () => "group-1",
    };
  }
}

const bytesOf = (sheets: Sheet[]): Uint8Array => writeXlsx(sheets);
const req = (sheets: Sheet[], section: "tax_invoice" | "delivery_challan", confirmMixed = false, filename = "October_Production.xlsx") => ({
  bytes: bytesOf(sheets),
  filename,
  section,
  confirmMixed,
  userId: "admin-1",
});

section("B. wrong-section uploads are rejected before anything is written");
{
  const f1 = new FakeImport();
  const r1 = await importWorkbook(f1.ports(), req(challans.slice(0, 5), "tax_invoice", false, "DC.341 TO.xlsx"));
  check(r1.status === 422 && r1.body.reason === "wrong_document_type", "a pure challan workbook uploaded to Tax Bills is rejected (422)");
  check(
    r1.body.error === "This workbook contains Delivery Challan documents, not Tax Invoices. Please upload it through the Challan Bills section.",
    "its message names the document type and the right section",
    String(r1.body.error)
  );
  check(f1.writes === 0 && f1.uploads.size === 0 && f1.files.size === 0, "no upload, bill, line or PDF was written");

  const f2 = new FakeImport();
  const r2 = await importWorkbook(f2.ports(), req(bill301.slice(0, 5), "delivery_challan", false, "test bills.xlsx"));
  check(r2.status === 422 && r2.body.reason === "wrong_document_type", "a pure invoice workbook uploaded to Challan Bills is rejected (422)");
  check(
    r2.body.error === "This workbook contains Tax Invoice documents, not Delivery Challans. Please upload it through the Tax Bills section.",
    "its message names the document type and the right section",
    String(r2.body.error)
  );
  check(f2.writes === 0, "nothing was written");

  const f3 = new FakeImport();
  const challanUpload = await importWorkbook(f3.ports(), req(challans, "delivery_challan", false, "DC.341 TO.xlsx"));
  const ups = [...f3.uploads.values()];
  check(challanUpload.status === 200 && ups.length === 1 && ups[0].document_type === "delivery_challan" && ups[0].source_group_id === null, "a pure challan workbook imports into Challan Bills as one upload");
  check(f3.bills.size === 20 && [...f3.bills.values()].every((b) => b.document_type === "delivery_challan"), "20 challan bills, each typed delivery_challan");
  check(f3.lines.some((l) => l.remarks === "RETURN AFTER JOB WORK") && f3.lines.every((l) => l.rate === null && l.amount === null), "challan lines keep REMARKS and carry no rate or amount");
  check([...f3.bills.values()].every((b) => b.amount_after_tax === null && b.cgst === null && b.amount_in_words === null), "challan bills carry no monetary values");

  const f4 = new FakeImport();
  const taxUpload = await importWorkbook(f4.ports(), req(bill301, "tax_invoice", false, "BILL 301 TO.xlsx"));
  check(taxUpload.status === 200 && f4.bills.size === 20 && [...f4.bills.values()].every((b) => b.document_type === "tax_invoice"), "an invoice workbook still imports into Tax Bills exactly as before (20 bills)");
  check(f4.lines.every((l) => !("remarks" in l)), "invoice lines never carry a remarks key");
}

section("C. mixed workbooks: preview, split, rollback");
{
  const mixedSheets = [bill301[0], challans[0], bill301[1], challans[1], bill301[2], challans[2], bill301[3]];
  const f = new FakeImport();
  const preview = await importWorkbook(f.ports(), req(mixedSheets, "tax_invoice"));
  const groups = (preview.body.preview as { groups: { document_type: string; count: number; sheets: string[] }[] }).groups;
  check(preview.status === 409 && preview.body.needs_confirmation === true && f.writes === 0, "an unconfirmed mixed workbook returns a preview and writes nothing");
  check(groups.find((g) => g.document_type === "tax_invoice")?.count === 4 && groups.find((g) => g.document_type === "delivery_challan")?.count === 3, "the preview counts 4 Tax Invoices and 3 Delivery Challans");

  for (const from of ["tax_invoice", "delivery_challan"] as const) {
    const fm = new FakeImport();
    const res = await importWorkbook(fm.ports(), req(mixedSheets, from, true));
    const ups = [...fm.uploads.values()];
    const tax = ups.find((u) => u.document_type === "tax_invoice")!;
    const ch = ups.find((u) => u.document_type === "delivery_challan")!;
    check(res.status === 200 && res.body.mixed === true && ups.length === 2, `confirmed from ${from === "tax_invoice" ? "Tax Bills" : "Challan Bills"}: two logical uploads`);
    check(tax.source_group_id === "group-1" && ch.source_group_id === "group-1" && tax.original_filename === "October_Production.xlsx" && ch.original_filename === "October_Production.xlsx",
      "both keep the source workbook's name and share one source group");
    check(String(tax.base_name).endsWith("_tax_invoices") && String(ch.base_name).endsWith("_delivery_challans"), "each group has its own file base name");
    const taxBills = [...fm.bills.values()].filter((b) => b.bill_upload_id === tax.id);
    const chBills = [...fm.bills.values()].filter((b) => b.bill_upload_id === ch.id);
    check(taxBills.length === 4 && taxBills.every((b) => b.document_type === "tax_invoice") && chBills.length === 3 && chBills.every((b) => b.document_type === "delivery_challan"),
      "each sheet lands only in its own section");
    check(taxBills.map((b) => b.sheet_name).join() === "301,302,303,304" && taxBills.map((b) => b.sheet_order).join() === "1,3,5,7"
      && chBills.map((b) => b.sheet_order).join() === "2,4,6", "worksheet names and original order are preserved in both groups");
    const taxAgg = fm.files.get(tax.original_pdf_path as string)!;
    const chAgg = fm.files.get(ch.original_pdf_path as string)!;
    check(!!taxAgg && !!chAgg && taxAgg !== chAgg, "each group has its own aggregate PDF");
    check(drawn(taxAgg, "TAX INVOICE") && !drawn(taxAgg, "DELIVERY CHALLAN") && drawn(chAgg, "DELIVERY CHALLAN") && !drawn(chAgg, "TAX INVOICE"),
      "the aggregates never mix the two document types");
    check(readPdfStructure(chAgg).pageCount === 3 && readPdfStructure(taxAgg).pageCount >= 4, "the challan aggregate holds exactly its 3 challans");
  }

  // The challan half fails after the invoice half was fully written: neither survives.
  const ff = new FakeImport();
  ff.failUpload = (path) => [...ff.uploads.values()].some((u) => u.document_type === "delivery_challan" && path.startsWith(`${u.id}/`));
  const failed = await importWorkbook(ff.ports(), req(mixedSheets, "tax_invoice", true));
  check(failed.status === 500 && failed.body.reason === "storage_failed", "a storage failure in the second group fails the import");
  check(ff.uploads.size === 0 && ff.bills.size === 0 && ff.lines.length === 0 && ff.files.size === 0, "and leaves no upload, bill, line or PDF from either group");
}

/* ──────────────────────────────────────────────
   D. PDFs
   ────────────────────────────────────────────── */

section("D. two templates");
{
  const ch = parseChallanSheet(challans[1]);
  const o = ch.original;
  check(o.invoiceNo === "EXW/342/2026-27" && o.invoiceDate === "2026-10-12" && o.orderNoLabel === "Service Order No" && o.transporterMode === "HAND DELIVERY",
    "the challan parser reads challan no/date, the order label and transporter mode", JSON.stringify([o.invoiceNo, o.invoiceDate, o.orderNoLabel, o.transporterMode]));
  check(o.lineItems.length === 2 && o.lineItems[0].description.endsWith("EJECTOR FOR TR") && o.lineItems[1].remarks === "RETURN AFTER JOB WORK" && o.totalQuantity === 3,
    "continuation rows join the description; remarks and total quantity are read");
  check(o.jobKind === "LABOUR JOB" && ch.sourceCopies.join() === "original,duplicate" && ch.triplicate.label === "TRIPLICATE", "job kind is read; the missing TRIPLICATE copy is generated");

  const challanPdf = renderBillDocument([o], COPY_LABEL.original, null, null);
  for (const t of ["DELIVERY CHALLAN", "Challan No.", "Your Challan No.", "Service Order No", "Transporter Mode", "REMARKS", "Total Quantity", "Received above material in good & condition", "For EXAMPLE ENGINEERING WORKS", "(Proprietor)", "(Receivers Signature)"]) {
    check(drawn(challanPdf, t), `the challan PDF prints "${t}"`);
  }
  const forbidden = ["TAX INVOICE", "CGST", "SGST", "IGST", "AMOUNT", "RATE", "Bank", "E & O.E", "Amount in Words", "PLACE OF SUPPLY"];
  check(forbidden.every((t) => !mentions(challanPdf, t)), "the challan PDF has no invoice heading, money, tax, bank, E & O.E or place of supply", forbidden.filter((t) => mentions(challanPdf, t)).join(","));

  const invoice = parseSheet(bill301[0]).original;
  const invoicePdf = renderBillDocument([invoice], COPY_LABEL.original, null, null);
  check(drawn(invoicePdf, "TAX INVOICE") && drawn(invoicePdf, "RATE") && drawn(invoicePdf, "AMOUNT") && mentions(invoicePdf, "CGST") && drawn(invoicePdf, "E & O.E"),
    "the invoice PDF keeps its heading, rate/amount columns, GST and footer");

  const labour = parseChallanSheet(challans.find((s) => /L$/.test(s.name))!).original;
  const metal = parseChallanSheet(challans.find((s) => !/L$/.test(s.name))!).original;
  check(drawn(renderBillDocument([labour], "ORIGINAL", null, null), "LABOUR JOB") && drawn(renderBillDocument([metal], "ORIGINAL", null, null), "WITH METAL"),
    "challans print LABOUR JOB and WITH METAL");
  const taxKinds = bill301.map((s) => parseSheet(s).original.jobKind);
  check(taxKinds.includes("LABOUR JOB") && taxKinds.includes("WITHMETAL"), "invoices keep both job kinds too");

  const long: BillCopy = structuredClone(o);
  long.lineItems = Array.from({ length: 45 }, (_, i) => ({
    srNo: i + 1,
    description: `ITEM ${i + 1} ` + (i % 4 === 0 ? "WITH A LONG DESCRIPTION THAT WRAPS ACROSS SEVERAL LINES OF THE DESCRIPTION COLUMN ON THE PAGE" : "SHORT"),
    hsnCode: "82073000",
    uom: "NOS",
    quantity: 1,
    rate: null,
    amount: null,
    remarks: i % 5 === 0 ? "CHECK FINISH BEFORE DISPATCH, RETURN SAME DAY" : null,
  }));
  long.totalQuantity = 45;
  const longPdf = renderBillDocument([long], "ORIGINAL", null, null);
  const pages = readPdfStructure(longPdf).pageCount;
  check(pages >= 3 && drawn(longPdf, `Page ${pages} of ${pages}`.replace(/^/, "ORIGINAL   |   EXW/342/2026-27   |   ")), `a 45-line challan runs onto ${pages} pages with global page numbers`);
  check(Array.from({ length: 45 }, (_, i) => `ITEM ${i + 1} `).every((t) => mentions(longPdf, t)), "no line is lost across the page breaks");
  check((pdfText(longPdf).match(/\(REMARKS\) Tj/g) ?? []).length === pages, "the table heading repeats on every page");
  const longInvoice = structuredClone(invoice);
  longInvoice.lineItems = Array.from({ length: 40 }, (_, i) => ({ ...invoice.lineItems[0], srNo: i + 1, description: `${invoice.lineItems[0].description} ${i + 1} AND A LONG CONTINUATION` }));
  check(readPdfStructure(renderBillDocument([longInvoice], "ORIGINAL", null, null)).pageCount >= 2, "a long invoice still runs onto several pages");

  // Rendering from the stored record matches rendering from the parse.
  const record = { ...toBillRecord(ch as never, "u1"), id: "b1", copy: "original" } as unknown as BillRecord;
  const fromRecord = billFromRecord(record, o.lineItems, "ORIGINAL");
  check(record.document_type === "delivery_challan" && fromRecord.documentType === "delivery_challan" && fromRecord.referenceRows.map((r) => r.label).join() === "Challan No.,Your Challan No.,Service Order No",
    "a stored challan re-renders as a challan with challan reference rows");
  const legacy = { ...toBillRecord(parseSheet(bill301[0]) as never, "u1"), id: "b2", copy: "original" } as Record<string, unknown>;
  delete legacy.document_type;
  const a = renderBillDocument([billFromRecord(legacy as unknown as BillRecord, invoice.lineItems, "ORIGINAL")], "ORIGINAL", null, null);
  const b = renderBillDocument([billFromRecord({ ...legacy, document_type: "tax_invoice" } as unknown as BillRecord, invoice.lineItems, "ORIGINAL")], "ORIGINAL", null, null);
  check(a.length === b.length && a.every((x, i) => x === b[i]), "a pre-0025 row (no document_type) renders byte-identically as a Tax Invoice");
}

/* ──────────────────────────────────────────────
   E. Isolation
   ────────────────────────────────────────────── */

section("E. edits are confined to the document's own fields");
{
  const ch = parseChallanSheet(challans[1]);
  const record = { ...toBillRecord(ch as never, "u1"), id: "b1", copy: "original" } as unknown as BillRecord;
  const { values, lineItems } = computeBillValues(record, ch.original.lineItems, {
    cgst_rate: 9,
    line_items: [
      { description: "NEW LINE", quantity: 4, rate: 1000, remarks: "URGENT" },
      { description: "SECOND", quantity: 2 },
    ],
  } as never);
  check(values.total_quantity === 6 && values.amount_after_tax === null && values.cgst_rate === null && values.amount_in_words === null && values.bank_details === null,
    "an edit to a challan recomputes total quantity and writes every money column as null", JSON.stringify(values));
  check(lineItems[0].rate === null && lineItems[0].amount === null && lineItems[0].remarks === "URGENT", "challan lines keep remarks and can never acquire a rate or amount");
  const inv = parseSheet(bill301[0]);
  const invRecord = { ...toBillRecord(inv as never, "u2"), id: "b2", copy: "original" } as unknown as BillRecord;
  const invEdit = computeBillValues(invRecord, inv.original.lineItems, { line_items: [{ description: "X", quantity: 2, rate: 10, remarks: "nope" }] } as never);
  check(invEdit.lineItems[0].amount === 20 && !("remarks" in invEdit.lineItems[0]) && Number(invEdit.values.amount_before_tax) === 20, "an invoice edit still computes amounts and drops a stray remarks key");
}

section("E. regeneration is confined to one document type");
{
  const world = new FakeWorld();
  const parsedTax = bill301.slice(0, 3).map((s) => parseSheet(s));
  const parsedChallan = challans.slice(0, 4).map((s) => parseChallanSheet(s));
  const tax = world.addWorkbook("Tax.xlsx", parsedTax as never);
  world.clock += 1;
  const ch = world.addWorkbook("Challans.xlsx", parsedChallan as never);
  const taxBefore = JSON.stringify([world.uploads.get(tax.uploadId), ...tax.billIds.map((id) => world.bills.get(id))]);

  const taxList = await listWorkbooks(world.deps(), "tax_invoice");
  const chList = await listWorkbooks(world.deps(), "delivery_challan");
  check(taxList.workbooks.map((w) => w.upload_id).join() === tax.uploadId && chList.workbooks.map((w) => w.upload_id).join() === ch.uploadId,
    "each section's selector lists only its own workbooks");
  const rows = await world.store().listWorkbookUploads();
  const rejects = (scope: unknown) => {
    try {
      validateScope(scope, rows);
      return false;
    } catch (e) {
      return e instanceof PermanentError && e.code === "invalid_scope";
    }
  };
  check(rejects({ upload_ids: [ch.uploadId], include_standalone: false, document_type: "tax_invoice" }), "a challan workbook cannot be regenerated through the Tax Bills scope");
  check(rejects({ upload_ids: [tax.uploadId], include_standalone: false, document_type: "delivery_challan" }), "an invoice workbook cannot be regenerated through the Challan Bills scope");
  check(rejects({ upload_ids: [ch.uploadId], include_standalone: true, document_type: "delivery_challan" }), "Challan Bills cannot pull in the standalone (Tax Invoice) bills");

  const deps = world.deps();
  const started = await startJob(deps, "admin", { upload_ids: [ch.uploadId], include_standalone: false, document_type: "delivery_challan" });
  let view = started.job as RegenerationView;
  for (let i = 0; i < 2000 && view.status === "running"; i++) {
    const r = await stepJob(deps, view.job_id);
    view = r.job as RegenerationView;
    world.clock += r.busy ? LEASE_MS + 1 : (r.retry_after_ms ?? 10);
  }
  check(view.outcome === "succeeded" && view.scope?.document_type === "delivery_challan" && view.counters.bills_succeeded === 4 && view.counters.aggregates_succeeded === 1,
    "a Challan Bills job regenerates its 4 challans and their aggregate", JSON.stringify(view.counters));
  const agg = world.files.get(world.uploads.get(ch.uploadId)!.original_pdf_path as string)!;
  const one = world.files.get(world.bills.get(ch.billIds[0])!.original_pdf_path as string)!;
  check(drawn(agg, "DELIVERY CHALLAN") && !mentions(agg, "CGST") && !drawn(agg, "E & O.E") && drawn(one, "DELIVERY CHALLAN"),
    "regeneration uses the challan renderer for the aggregate and for each bill");
  check(JSON.stringify([world.uploads.get(tax.uploadId), ...tax.billIds.map((id) => world.bills.get(id))]) === taxBefore && !world.ops.some((op) => op.target.startsWith(`${tax.uploadId}/`)),
    "the Tax Bills workbook, its bills and its PDFs are untouched");
}

section("E. client services and shared modules");
{
  const read = (p: string) => readFileSync(resolve(REPO, p), "utf8");
  check(read("Metalworker_admin/src/services/billDocumentTypes.ts") === read("Metalworker_desktop/src/services/billDocumentTypes.ts"), "admin and desktop share an identical billDocumentTypes.ts");
  check(adminModel.DOCUMENT_TYPE_INFO.delivery_challan.section === "Challan Bills" && adminModel.DOCUMENT_TYPE_INFO.tax_invoice.section === "Tax Bills" && !adminModel.DOCUMENT_TYPE_INFO.delivery_challan.hasMoney,
    "the sections are named Tax Bills and Challan Bills, and challans carry no money");
  check(adminModel.documentTypeOf({}) === "tax_invoice" && adminModel.documentTypeOf({ document_type: "delivery_challan" }) === "delivery_challan", "rows without a type read as Tax Invoices");

  /* Every list, read-by-id and delete in both apps' bill services is confined to a
     document type. Checked on the source so a new query that forgets the filter
     fails here, not in production. */
  const body = (src: string, fn: string): string => {
    const start = src.indexOf(`export async function ${fn}(`);
    if (start < 0) return "";
    const next = src.indexOf("\nexport ", start + 10);
    return src.slice(start, next < 0 ? undefined : next);
  };
  for (const app of ["Metalworker_admin", "Metalworker_desktop"]) {
    const src = read(`${app}/src/services/bills.ts`);
    const scoped = ["fetchBills", "fetchBillJobFacets", "fetchBillUploads", "fetchBill", "deleteBill", "deleteBillUpload", "fetchBillDocumentsByIds", "fetchBillLabels", "deleteBillsInBulk", "updateBill", "uploadBillWorkbook"];
    const missing = scoped.filter((fn) => !/document_type|documentType/.test(body(src, fn)));
    check(missing.length === 0, `${app}: every bill query, delete, edit and upload is scoped to a document type`, missing.join(","));
    const folders = read(`${app}/src/services/billingFolders.ts`);
    check(/challan_billing|CHALLAN_BILLING_FOLDER_KIND/.test(folders) && /folderKindFor\(documentType\)/.test(folders), `${app}: billing folders are kept per section`);
  }

  const sql = read("Metalworker_admin/supabase/migrations/0025_bill_document_types.sql");
  check(/FOREIGN KEY \(bill_upload_id, document_type\)\s+REFERENCES public\.bill_uploads \(id, document_type\)/.test(sql), "the database ties every bill's type to its upload's (composite foreign key)");
  check(/DEFAULT 'tax_invoice'/.test(sql) && !/UPDATE public\.(bills|bill_uploads)\s+SET/i.test(sql), "existing rows become Tax Invoices by default; no row is rewritten and no PDF path changes");
}

console.log(failures === 0 ? "\nDOCUMENT TYPE CHECKS: all passed." : `\nDOCUMENT TYPE CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
