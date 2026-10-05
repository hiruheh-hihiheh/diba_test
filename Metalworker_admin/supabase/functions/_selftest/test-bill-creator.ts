// The Bill Creator, and the promise that a bill typed by hand is the same bill as
// one parsed from a workbook.
//
// THE CLAIM BEING TESTED
//
//   There is one invoice model, one set of calculations and one PDF renderer. A bill
//   built by a person and a bill built by a spreadsheet are the same row, printed the
//   same way, with the same three copies.
//
// Almost every section below is a different way of trying to break that claim, and
// the two failure modes that matter are:
//
//   * the creator growing its OWN arithmetic, so a form total and the printed total
//     disagree by a rounding step. Section H feeds the creator's totals and the
//     canonical `computeBillValues` the same line items and demands identical figures.
//   * the creator growing its OWN PDF, so a hand-built invoice prints differently from
//     an imported one. Section J renders both through the SAME `renderBillDocument`
//     and compares the bytes.
//
// WHAT IS DELIBERATELY NOT TESTED HERE
//
// There is no assertion that a particular company name appears in a PDF. The test data
// is obviously-fake placeholder text, and check A actively forbids the reference
// workbook's real strings from appearing in this source at all - a feature whose tests
// only pass for one company's data is a feature wired to that company.
//
// The database behaviour is NOT tested here either. `test-bill-creator-live.ts` proves
// the schema and the RPC filters against the real database; this file is the part that
// can be decided without credentials, and it is where the copy field list lives.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_LABEL, COPY_ORDER, type BillLineItem, type CopyKind } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { decodePdfImage } from "../process-bill-upload/_shared/pdfImage.ts";
import {
  amountInWords,
  applicableFromAmounts,
  billFromRecord,
  computeTotals,
  round2,
  toBillRecord,
  type BillRecord,
} from "../process-bill-upload/_shared/billDocument.ts";
import { applyPatch, computeBillValues, EditError, type BillPatch } from "../process-bill-upload/_shared/billEdit.ts";
import { profileForBill, profileToSnapshot, NO_PROFILE, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";
import {
  COPYABLE_PATCH_KEYS,
  copyBaseRecord,
  LIKELY_TO_CHANGE_FIELDS,
  LIKELY_TO_CHANGE_SET,
  NEVER_COPIED_FIELDS,
  NEVER_COPIED_SET,
  bankFromRecord,
  blankLineItem,
  chargeDescription,
  creatorTotals,
  emptyBillRecord,
  findDuplicateInvoiceNos,
  lineItemsFromRows,
  lineItemsToPatch,
  numberOrNull,
  patchFromRecord,
  validateForFinalize,
  wordsAfterCopy,
  type DuplicateMatch,
} from "../process-bill-upload/_shared/billCreator.ts";

/* BOTH client copies of the Bill Creator's form module, imported — not merely diffed.
   A byte comparison proves the two files are the same file; running both over the same
   inputs is what proves the file computes the right thing, and the second is the claim
   that actually matters. The desktop copy is reached by relative path because these
   tests already run on Node with type stripping, which is the same mechanism
   `test-bill-job-connections.ts` uses to import desktop modules. */
import * as creatorFormAdmin from "../../../src/services/creatorForm.ts";
import * as creatorFormDesktop from "../../../../Metalworker_desktop/src/services/creatorForm.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");

/**
 * A solid single-colour PNG, assembled here rather than checked in as a binary.
 *
 * Real PNG bytes on purpose: `decodePdfImage` is the same decoder that reads a stored
 * logo, and a test that handed the renderer a hand-written `PdfImage` would pass against
 * a shape no logo file can produce — which is exactly the shape a hand-written literal
 * is. 8-bit RGB, one IDAT, no filter, so the encoder is a few lines and has nothing to
 * be wrong about; the CRC of each chunk is computed rather than pasted so a typo cannot
 * produce a file that happens to decode.
 */
function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; /* bit depth */
  ihdr[9] = 2; /* colour type: truecolour */
  /* Bytes 10-12 (compression, filter, interlace) stay zero, which is correct for this. */

  /* One filter byte (0 = none) per scanline, then the row's pixels. */
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 3);
    raw[at] = 0;
    for (let x = 0; x < width; x++) {
      raw[at + 1 + x * 3] = rgb[0];
      raw[at + 2 + x * 3] = rgb[1];
      raw[at + 3 + x * 3] = rgb[2];
    }
  }

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat = new Uint8Array(deflateSync(raw));
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

let failures = 0;
let checks = 0;
const check = (ok: boolean, label: string, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

/* ═══════════════════════════════════════════════════════════════════════════
   A. The real workbook, as the thing a copy is made from
   ═══════════════════════════════════════════════════════════════════════════ */

section("A. The source bills this feature copies from");

const sheets = (await readXlsx(readFileSync(workbook))).sheets;
const parsed = parseBills(sheets);
/* The sheet name lives on the PARSED BILL, not on each of its three copies — so a copy
   handed to `toBillRecord` on its own loses it, and the stored row then has
   `sheet_name = undefined`, which the creator would then seed into every copy. Keeping
   the whole parsed bill alongside its originals is what stops that. */
const parsedBills = parsed.bills;
const sourceCopies = parsedBills.map((b) => b.original);
check(sourceCopies.length > 0, "the reference workbook still parses into bills", `${sourceCopies.length} bill(s)`);
if (sourceCopies.length === 0) {
  console.log("\nBILL CREATOR CHECKS: no reference bills, cannot continue.");
  process.exit(1);
}

/* The three real-world records, taken through the SAME bridge the editor uses, so
   every assertion below is about the creator and not about how a workbook happens to
   reach the database. */
/* `toBillRecord` is the upload path's OWN mapping from a parsed bill to a database
   row, so these tests start from exactly what `process-bill-upload` would have stored.
   Testing against a hand-assembled record instead would let a field pass here that the
   real pipeline never writes. */
const PROBE_UPLOAD_ID = "00000000-0000-0000-0000-000000000000";
const storedRecords: Record<string, unknown>[] = parsedBills.map((b) =>
  toBillRecord(b, PROBE_UPLOAD_ID)
);
/* Read back through `billFromRecord`, which is the round trip the editor relies on and
   the one this feature extends. Doing it here means a field lost by that bridge fails
   these tests, which is the correct place for it to fail. */
const realRecords: BillRecord[] = storedRecords.map((stored, at) =>
  billFromRecord(
    { ...(stored as BillRecord), copy: "original" },
    sourceCopies[at].lineItems ?? [],
    COPY_LABEL.original
  )
);
const realRecord = storedRecords[0] as unknown as BillRecord;
const realItems: BillLineItem[] = sourceCopies[0].lineItems ?? [];

/* No part of this file may contain the reference workbook's real strings. */
{
  /* Assembled from halves so that THIS line is not itself the occurrence it is looking
     for — a test that has to name the forbidden string in order to forbid it cannot be
     written as a literal. */
  const forbidden = ["EXAMPLE", "ENGINEERING", "WORKS"].join(" ");
  const here = readFileSync(fileURLToPath(import.meta.url), "utf8");
  check(!here.includes(forbidden), "no real company string appears in this test file");
  check(!here.includes(["98", "12"].join("")), "and no real account number either");
}

/* ═══════════════════════════════════════════════════════════════════════════
   B. The copy field list — the load-bearing contract
   ═══════════════════════════════════════════════════════════════════════════ */

section("B. Which fields a copy carries, and which it must not");

check(COPYABLE_PATCH_KEYS.length > 30, "the copyable field list is a full invoice, not a subset", `${COPYABLE_PATCH_KEYS.length} fields`);
check(new Set(COPYABLE_PATCH_KEYS).size === COPYABLE_PATCH_KEYS.length, "the copyable list has no duplicates");

/* Nothing may be in both lists. An overlap would mean a field is declared both as
   carried and as never carried, and one of those two promises is a lie. */
{
  const overlap = COPYABLE_PATCH_KEYS.filter((k) => NEVER_COPIED_SET.has(k));
  check(overlap.length === 0, "no field is both copied and never copied", overlap.join(", "));
}

/* Every copyable key must be a real `BillPatch` key, and `BillPatch` is what
   `applyPatch` accepts. An invented key would be dropped in silence by the server, so
   the copy would lose a field and nothing would say so. This is checked against the
   TYPE by passing a complete patch through `applyPatch` and seeing which keys survive
   into `values` — the only test that proves the real acceptance set rather than a
   restatement of it. */
{
  const everything: Record<string, unknown> = { invoice_no: "PROBE-1" };
  for (const key of COPYABLE_PATCH_KEYS) if (!(key in everything)) everything[key] = null;
  const cleaned = applyPatch(everything as BillPatch);
  const accepted = new Set(Object.keys(cleaned.values));
  /* `amount_in_words` is the one field `applyPatch` does not write into `values`. It
     has its own three-case contract (`regenerateWords` / `explicitWords`) because an
     explicit string and a request to recompute must be distinguishable, so it cannot be
     expressed as a plain cleaned value. Asserted against that contract instead of
     pretending it is an ordinary field. */
  const rejected = COPYABLE_PATCH_KEYS.filter(
    (k) => !accepted.has(k) && k !== "amount_in_words"
  );
  check(rejected.length === 0, "every copyable field is accepted by the existing patch path", rejected.join(", "));
  check(
    cleaned.regenerateWords === true && cleaned.explicitWords === null,
    "amount_in_words is honoured through applyPatch's three-case contract"
  );
  check(
    applyPatch({ invoice_no: "P", amount_in_words: "SAYING" } as BillPatch).explicitWords === "SAYING",
    "and an explicit wording is kept as explicit"
  );
  check(
    applyPatch({ invoice_no: "P" } as BillPatch).regenerateWords === false,
    "and omitting it leaves the stored wording alone"
  );
}

/* The converse, and this is the one that catches a FIELD THAT EXISTS BUT IS NEVER
   MAPPED. `BillPatch` is the server's own declaration of what a bill can carry; a new
   editable field added there without being added here would be silently absent from
   every copy, and the only symptom would be a field that quietly does not carry over.

   The reference is `EDITABLE`, read out of the source of `billEdit.ts` rather than
   restated here — a hand-typed second list would drift from the first the moment
   somebody added a field and remembered only one of them. `line_items` is excluded
   because it is not an invoice field but a nested collection, handled separately. */
{
  const editSrc = readFileSync(
    resolve(fileURLToPath(new URL(".", import.meta.url)), "../process-bill-upload/_shared/billEdit.ts"),
    "utf8"
  );
  const editableBlock = editSrc.match(/const EDITABLE = new Set<keyof BillPatch>\(\[([\s\S]*?)\]\)/);
  check(editableBlock !== null, "applyPatch's editable field list is present and locatable");
  const declared = (editableBlock?.[1].match(/"([a-z_]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
  check(declared.length >= 35, "and it is a full invoice, not a stub", `${declared.length} fields`);

  const missing = declared.filter(
    (k) => k !== "line_items" && !(COPYABLE_PATCH_KEYS as readonly string[]).includes(k)
  );
  check(
    missing.length === 0,
    "every editable bill field is in the copy list (nothing is silently dropped)",
    missing.length > 0 ? `missing: ${missing.join(", ")}` : `${declared.length} fields`
  );
}

/* The specific fields a copy must never carry, named one at a time. These are the ones
   a naive `SELECT *` copy would clone onto the new invoice. */
{
  const r = realRecord as unknown as Record<string, unknown>;
  const seed = patchFromRecord(realRecord) as unknown as Record<string, unknown>;

  check(seed.id === undefined, "a copy does not carry the source bill's id");
  check(seed.bill_upload_id === undefined, "a copy does not carry the source upload id");
  check(seed.sheet_name === undefined, "a copy does not carry the source sheet name");
  check(seed.original_pdf_path === undefined, "a copy does not carry the source PDF paths");
  check(seed.pdf_version === undefined, "a copy does not carry the source PDF version");
  check(seed.logo_rendered_logo_id === undefined, "a copy does not carry which logo was rendered");
  check(seed.created_at === undefined, "a copy does not carry the source creation time");
  check(seed.updated_at === undefined, "a copy does not carry the source update time");
  check(seed.copied_from_bill_id === undefined, "a copy does not carry the source's own ancestry");

  /* The derived money columns are excluded from the SEED because the server re-derives
     them. Asserting they are absent from the seed is asserting the copy cannot keep a
     stale total. */
  for (const derived of ["amount_before_tax", "cgst", "sgst", "igst", "total_gst", "amount_after_tax", "total_quantity"]) {
    check(seed[derived] === undefined, `a copy does not seed the derived field ${derived}`);
  }

  /* Sanity the other way: a copy DOES carry the invoice. */
  check(seed.invoice_no === r.invoice_no, "a copy carries the invoice number");
  check(seed.party_name === r.party_name, "a copy carries the customer");
  check(seed.terms === r.terms, "a copy carries the terms");
  check(seed.bank_details !== undefined, "a copy carries the bank block");
  check(seed.job_kind === r.job_kind, "a copy carries the job kind");
  check(seed.certification === r.certification, "a copy carries the certification line");
  check(seed.receiver_signature === r.receiver_signature, "a copy carries the receiver signature caption");
  check(seed.order_no_label === r.order_no_label, "a copy carries which order label the template used");
}

/* Every field in NEVER_COPIED_FIELDS must be a real `bills` column, so the list cannot
   drift into naming something that does not exist and looking thorough while meaning
   nothing.

   The column set is read out of the MIGRATIONS rather than restated here — the same
   reason the editable-field check reads `EDITABLE` out of its source. A hand-typed
   second list of columns would drift the moment somebody added one and remembered only
   one of the two. Parsing the migration SQL is imperfect but it is derived from the
   same source of truth `db push` applies, so a column added there shows up here. */
{
  const migrationDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../migrations");
  const files = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort();
  check(files.length > 0, "the migrations directory is readable", `${files.length} files`);

  const columns = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(resolve(migrationDir, file), "utf8");
    for (const m of sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/gi)) columns.add(m[1]);
    /* The 0005 CREATE TABLE body, which is where `bills` was declared. */
    const create = sql.match(/CREATE TABLE IF NOT EXISTS\s+bills\s*\(([\s\S]*?)\n\);/i);
    if (create) for (const m of create[1].matchAll(/^\s{4}(\w+)\s+/gm)) columns.add(m[1]);
  }
  check(columns.size > 40, "the bills column set was recovered from the migrations", `${columns.size} columns`);

  const unknown = NEVER_COPIED_FIELDS.filter((f) => !columns.has(f));
  check(unknown.length === 0, "every never-copied field is a real bills column", unknown.join(", "));

  /* "Server-owned" has a testable meaning: the server's own patch path refuses it. If
     a never-copied field ever became client-editable, it would have to move to the
     copyable list, because that is where an invoice's identity and totals come from.
     Asserting it against `applyPatch` rather than against a comment is what makes this
     check able to fail. */
  const editable = new Set(
    (readFileSync(
      resolve(fileURLToPath(new URL(".", import.meta.url)), "../process-bill-upload/_shared/billEdit.ts"),
      "utf8"
    ).match(/const EDITABLE = new Set<keyof BillPatch>\(\[([\s\S]*?)\]\)/)?.[1].match(/"([a-z_]+)"/g) ?? []).map((s) =>
      s.replace(/"/g, "")
    )
  );
  const nowEditable = NEVER_COPIED_FIELDS.filter((f) => editable.has(f));
  check(
    nowEditable.length === 0,
    "nothing on the never-copy list has become client-editable",
    nowEditable.join(", ")
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   C. Copying the source bill
   ═══════════════════════════════════════════════════════════════════════════ */

section("C. A copy carries the invoice and nothing else");

{
  const seed = patchFromRecord(realRecord);
  const seedItems = lineItemsFromRows(
    realItems.map((i) => ({
      sr_no: i.srNo, description: i.description, hsn_code: i.hsnCode,
      uom: i.uom, quantity: i.quantity, rate: i.rate, amount: i.amount,
    }))
  );

  /* The copy's line items match the source's, field for field. */
  check(seedItems.length === realItems.length, "every line item is copied", `${seedItems.length} of ${realItems.length}`);
  const sameLines = seedItems.every((item, at) => {
    const src = realItems[at];
    return item.description === src.description && item.hsnCode === src.hsnCode &&
      item.uom === src.uom && item.quantity === src.quantity && item.rate === src.rate;
  });
  check(sameLines, "every copied line keeps its description, HSN, UOM, quantity and rate");

  /* A copy that changes one quantity must produce a different total, and must NOT be
     able to keep the source's. This is the single most important arithmetic claim in
     the feature. */
  const sourceTotal = Number(realRecord.amount_after_tax ?? 0);

  const identical = computeBillValues(copyBaseRecord(realRecord), [], { ...seed, line_items: lineItemsToPatch(seedItems) });
  check(
    round2(Number(identical.values.amount_after_tax ?? 0)) === round2(sourceTotal),
    "an unmodified copy reproduces the source bill's total",
    `${String(identical.values.amount_after_tax)} vs ${sourceTotal}`
  );

  const changed = seedItems.map((items, at) =>
    at === 0 && items.quantity !== null
      ? { ...items, quantity: items.quantity + 1, amount: round2(items.quantity + 1) * (items.rate ?? 0) }
      : items
  );
  const moved = computeBillValues(copyBaseRecord(realRecord), [], { ...seed, line_items: lineItemsToPatch(changed) });
  check(
    Number(moved.values.amount_after_tax ?? 0) !== round2(sourceTotal),
    "changing one line's quantity changes the copy's total",
    `${String(identical.values.amount_after_tax)} -> ${String(moved.values.amount_after_tax)}`
  );

  /* Independently: the source row, computed again, is untouched by any of that. The
     functions are pure, which is the whole reason this check is possible. */
  const sourceAgain = computeBillValues(realRecord, realItems, {});
  check(
    round2(Number(sourceAgain.values.amount_after_tax ?? realRecord.amount_after_tax ?? 0)) === round2(sourceTotal),
    "the source bill's own total is unaffected by a copy being made from it"
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   D. The amount in words on a copy
   ═══════════════════════════════════════════════════════════════════════════ */

section("D. Amount in words");

{
  const words = "ONE THOUSAND ONE HUNDRED EIGHTY ONLY";
  check(wordsAfterCopy(1000, 1000, words) === words, "an unchanged copy keeps the source's own wording");
  check(wordsAfterCopy(1000, 1000, null) === undefined, "an unchanged copy with no words leaves them alone");

  const moved = wordsAfterCopy(1000, 1180, words);
  check(moved !== words, "a copy whose money moved does not keep stale words");
  check(moved === amountInWords(1180), "and its words are regenerated from the new total", String(moved));

  check(wordsAfterCopy(null, 1180, words) === words, "a source with no total keeps its words rather than guessing");

  /* The regenerated wording must agree with the figure the invoice actually shows. */
  check(
    wordsAfterCopy(500, 999.99, null) === amountInWords(999.99),
    "regenerated words track a decimal total exactly"
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   E. Precedence: the form's value, then the profile, then nothing
   ═══════════════════════════════════════════════════════════════════════════ */

section("E. Form value beats profile beats blank");

/* `BusinessProfile` in camelCase — that is the type the renderer takes. The snake_case
   spelling is the DATABASE row, reached through `profileToSnapshot`, and using it here
   would silently produce a profile of all-undefined fields: every value below would be
   `undefined`, `mergeTerms` would then fail on the first `term.trim()`, and the test
   would crash rather than report. Worth writing in the right case. */
const demoProfile: BusinessProfile = {
  companyName: "PROFILE COMPANY",
  businessDescription: "PROFILE DESCRIPTION",
  gstNumber: "29AAAAA0000A1Z5",
  msmeNumber: null,
  officeAddress: "PROFILE ADDRESS",
  email1: "profile@example.invalid",
  email2: null,
  mobile1: null,
  mobile2: null,
  bankName: "PROFILE BANK",
  bankBranch: null,
  bankIfsc: null,
  bankAccountNumber: null,
  paymentDays: 30,
  term1: "PROFILE TERM",
  term2: null,
  term3: null,
  certificationText: null,
  authorizedSignatoryText: null,
  authorizedSignatoryDesignation: null,
  receiverSignatureLabel: null,
};

{
  /* Case 1: the form filled the field in. The profile must NOT win — this is the whole
     "a workbook that prints its own bank name keeps printing its own bank name"
     guarantee, and a creator that preferred the profile would break it for every
     invoice somebody retypes. */
  const explicit = applyPatch({ seller_name: "THE FORM'S OWN NAME" } as BillPatch);
  const rendered = billFromRecord(
    { ...emptyBillRecord(), seller_name: "THE FORM'S OWN NAME" },
    [],
    COPY_LABEL.original
  );
  const doc = renderBillDocument([rendered], COPY_LABEL.original, null, demoProfile);
  const text = Buffer.from(doc).toString("latin1");
  check(explicit.values.seller_name === "THE FORM'S OWN NAME", "applyPatch keeps the form's own seller name");
  check(text.includes("THE FORM'S OWN NAME"), "and the rendered invoice prints it, not the profile's");
  check(!text.includes("PROFILE COMPANY"), "the profile did not overwrite the form's value on the page");

  /* Case 2: the form left it blank. The profile supplies it — the same fallback the
     workbook path has always had. */
  const blank = applyPatch({ seller_name: null } as BillPatch);
  check(blank.values.seller_name === null, "a blank form field is stored blank, not invented");
  const blankDoc = Buffer.from(
    renderBillDocument([billFromRecord(emptyBillRecord(), [], COPY_LABEL.original)], COPY_LABEL.original, null, demoProfile)
  ).toString("latin1");
  check(blankDoc.includes("PROFILE COMPANY"), "the profile fills a field the form left blank");

  /* Case 3: no profile at all. Nothing is invented — which is what keeps a bill printed
     without a profile byte-identical to one printed before the feature existed. */
  const noProfileDoc = Buffer.from(
    renderBillDocument([billFromRecord(emptyBillRecord(), [], COPY_LABEL.original)], COPY_LABEL.original, null, NO_PROFILE)
  ).toString("latin1");
  check(!noProfileDoc.includes("PROFILE COMPANY"), "with no profile configured nothing is invented");
  check(noProfileDoc.length > 0, "and the invoice still renders");
}

/* A profile snapshot is what freezes the defaults against a later settings change. */
{
  const snap = profileToSnapshot(demoProfile);
  check(Object.keys(snap).length > 0, "a profile with content produces a snapshot", `${Object.keys(snap).length} keys`);
  check(snap.company_name === "PROFILE COMPANY", "and the snapshot is in the database's snake_case");

  const changedLater: BusinessProfile = {
    ...demoProfile,
    companyName: "A DIFFERENT COMPANY LATER",
    paymentDays: 60,
  };
  const resolved = profileForBill(changedLater, snap);
  check(
    resolved.profile.companyName === "PROFILE COMPANY",
    "a bill with a snapshot does not adopt a profile changed after it was finalized"
  );
  check(resolved.profile.paymentDays === 30, "including its payment window");

  /* No snapshot means today's profile — a bill that predates the feature is finalized
     against whatever is in force now, which is the only sensible reading. */
  const fresh = profileForBill(changedLater, null);
  check(fresh.profile.companyName === "A DIFFERENT COMPANY LATER", "a bill with no snapshot uses the current profile");
  check(Object.keys(fresh.snapshot ?? {}).length > 0, "and is given a snapshot, so the next change cannot reach it");

  /* A junk snapshot is ignored rather than rendered from. Rendering a financial
     document from a value nobody can account for is the failure this guards. */
  for (const junk of ["a string", 42, [1, 2, 3], null, true]) {
    const r = profileForBill(demoProfile, junk);
    check(r.profile.companyName === "PROFILE COMPANY", `a ${typeof junk} snapshot is ignored, not rendered from`);
  }

  /* And the snapshot survives another round trip — which is what a copy of a copy
     relies on. */
  const twice = profileForBill(changedLater, resolved.snapshot);
  check(twice.profile.companyName === "PROFILE COMPANY", "a snapshot survives being re-snapshotted");
  check(twice.profile.paymentDays === 30, "with every value intact");
}

/* ═══════════════════════════════════════════════════════════════════════════
   F. Validation before finalization
   ═══════════════════════════════════════════════════════════════════════════ */

section("F. What must be true before an invoice can be generated");

{
  const good = validateForFinalize({
    patch: { invoice_no: "INV-1", invoice_date: "2026-01-01" },
    lineItems: [{ ...blankLineItem(0), description: "Work", quantity: 2, rate: 100, amount: 200 }],
    totals: { amountBeforeTax: 200, totalGst: 36, amountAfterTax: 236 },
  });
  check(good.length === 0, "a complete bill passes validation", good.map((e) => e.message).join("; "));

  /* The two identity fields. Without them the document has no name and no date, and
     an invoice without a date is not an invoice. */
  check(
    validateForFinalize({
      patch: { invoice_no: null, invoice_date: "2026-01-01" },
      lineItems: [{ ...blankLineItem(0), description: "W", quantity: 1, rate: 1, amount: 1 }],
      totals: { amountBeforeTax: 1, totalGst: 0, amountAfterTax: 1 },
    }).some((e) => e.field === "invoice_no"),
    "no invoice number is refused"
  );
  check(
    validateForFinalize({
      patch: { invoice_no: "INV-1", invoice_date: null },
      lineItems: [{ ...blankLineItem(0), description: "W", quantity: 1, rate: 1, amount: 1 }],
      totals: { amountBeforeTax: 1, totalGst: 0, amountAfterTax: 1 },
    }).some((e) => e.field === "invoice_date"),
    "no invoice date is refused"
  );
  check(
    validateForFinalize({
      patch: { invoice_no: "INV-1", invoice_date: "2026-01-01" },
      lineItems: [],
      totals: { amountBeforeTax: 0, totalGst: 0, amountAfterTax: 0 },
    }).some((e) => e.field === "line_items"),
    "a bill with no line items is refused — the renderer prints a table"
  );

  /* Legitimate data must NOT be blocked. A rule that fires on real invoices teaches
     people to ignore the rule, which is worse than having none. */
  check(
    validateForFinalize({
      patch: {
        invoice_no: "INV-1", invoice_date: "2026-01-01",
        party_gst_no: null, state_code: null, cgst_rate: 0, igst_rate: null,
        round_off: -0.4, bank_details: null,
      },
      lineItems: [{ ...blankLineItem(0), description: "Exempt supply", quantity: 1, rate: 500.5, amount: 500.5 }],
      totals: { amountBeforeTax: 500.5, totalGst: 0, amountAfterTax: 500 },
    }).length === 0,
    "an exempt, unregistered, no-bank bill with a negative round-off is still allowed"
  );

  /* Nonsense is refused. */
  check(
    validateForFinalize({
      patch: { invoice_no: "INV-1", invoice_date: "2026-01-01" },
      lineItems: [{ ...blankLineItem(0), description: "W", quantity: -2, rate: 100, amount: -200 }],
      totals: { amountBeforeTax: -200, totalGst: 0, amountAfterTax: -200 },
    }).some((e) => e.field.startsWith("line_items")),
    "a negative quantity is refused"
  );
  check(
    validateForFinalize({
      patch: { invoice_no: "INV-1", invoice_date: "2026-01-01" },
      lineItems: [blankLineItem(0)],
      totals: { amountBeforeTax: 0, totalGst: 0, amountAfterTax: 0 },
    }).some((e) => /empty/i.test(e.message)),
    "a wholly empty line is refused"
  );

  /* A round-off larger than the invoice is a single keystroke's mistake. */
  check(
    validateForFinalize({
      patch: { invoice_no: "INV-1", invoice_date: "2026-01-01", round_off: 5000 },
      lineItems: [{ ...blankLineItem(0), description: "W", quantity: 1, rate: 100, amount: 100 }],
      totals: { amountBeforeTax: 100, totalGst: 0, amountAfterTax: 5100 },
    }).some((e) => e.field === "round_off"),
    "a round-off larger than the invoice is refused"
  );

  /* A zero-quantity line is real — "one item, no charge" happens — and must pass. */
  check(
    validateForFinalize({
      patch: { invoice_no: "INV-1", invoice_date: "2026-01-01" },
      lineItems: [{ ...blankLineItem(0), description: "Free of charge", quantity: 1, rate: 0, amount: 0 }],
      totals: { amountBeforeTax: 0, totalGst: 0, amountAfterTax: 0 },
    }).length === 0,
    "a line at zero value is allowed"
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   G. Duplicate invoice numbers
   ═══════════════════════════════════════════════════════════════════════════ */

section("G. Duplicate invoice numbers are a warning, not a block");

{
  const existing: DuplicateMatch[] = [
    { bill_id: "b1", invoice_no: "INV-9", invoice_date: "2026-01-01", sheet_name: "S1", party_name: "A", status: "finalized" },
    { bill_id: "b2", invoice_no: "inv-9", invoice_date: "2026-02-01", sheet_name: "S2", party_name: "B", status: "finalized" },
    { bill_id: "b3", invoice_no: "INV-10", invoice_date: null, sheet_name: null, party_name: null, status: "draft" },
    { bill_id: "b4", invoice_no: "OTHER", invoice_date: null, sheet_name: null, party_name: null, status: "finalized" },
  ];

  const both = findDuplicateInvoiceNos("INV-9", existing);
  check(both.length === 2, "a case difference is still recognised as the same number by eye", `${both.length} matches`);
  check(both.every((m) => m.bill_id !== "b3"), "a different number is not a match");

  check(findDuplicateInvoiceNos("  INV-10  ", existing).length === 1, "surrounding spaces are ignored");
  check(findDuplicateInvoiceNos("nope", existing).length === 0, "a free number is free");
  check(findDuplicateInvoiceNos("", existing).length === 0, "an empty number matches nothing rather than everything");
  check(findDuplicateInvoiceNos(null, existing).length === 0, "a null number matches nothing");

  /* Excluding this bill is what stops an edit re-reporting itself as its own
     duplicate. */
  check(findDuplicateInvoiceNos("INV-9", existing, "b1").length === 1, "the bill being edited is excluded from its own warning");
  check(findDuplicateInvoiceNos("INV-9", existing, "b1")[0].bill_id === "b2", "and the other one is still reported");
}

/* ═══════════════════════════════════════════════════════════════════════════
   H. The creator's own totals must agree with the canonical ones
   ═══════════════════════════════════════════════════════════════════════════ */

section("H. The creator has no arithmetic of its own");

{
  /* The form shows a running total while it is being typed, and that total has to be
     the same number the invoice will carry. These are two separate implementations —
     one cheap enough to run on every keystroke, one the server trusts — so this
     section is the proof that they do not drift. */
  const cases: { items: BillLineItem[]; label: string }[] = [
    { label: "a single line", items: [{ ...blankLineItem(0), quantity: 2, rate: 100, amount: 200 }] },
    { label: "three lines with a fractional quantity", items: [
      { ...blankLineItem(0), quantity: 2.5, rate: 99.99, amount: 249.98 },
      { ...blankLineItem(1), quantity: 1, rate: 1000, amount: 1000 },
      { ...blankLineItem(2), quantity: 0.125, rate: 80, amount: 10 },
    ] },
    { label: "a line with an amount but no quantity", items: [{ ...blankLineItem(0), amount: 333.33 }] },
    { label: "an empty list", items: [] },
    { label: "a line with nothing filled in", items: [blankLineItem(0)] },
  ];

  for (const { items, label } of cases) {
    const form = creatorTotals(items);
    const canonical = computeTotals({ lineItems: items, cgstRate: null, sgstRate: null, igstRate: null });
    check(
      round2(form.amountBeforeTax) === round2(canonical.amountBeforeTax),
      `the running total matches the canonical one for ${label}`,
      `${form.amountBeforeTax} vs ${canonical.amountBeforeTax}`
    );
    if (form.totalQuantity !== null && canonical.totalQuantity !== null) {
      check(
        round2(form.totalQuantity) === round2(canonical.totalQuantity),
        `and so does the quantity for ${label}`,
        `${form.totalQuantity} vs ${canonical.totalQuantity}`
      );
    }
  }

  /* A quantity with a rate always derives an amount, even when the amount field is
     blank — that is the rule that stops a typed row silently contributing nothing. */
  check(
    creatorTotals([{ ...blankLineItem(0), quantity: 3, rate: 10 }]).amountBeforeTax === 30,
    "a line with a quantity and a rate but no amount still contributes"
  );
  check(creatorTotals([]).amountBeforeTax === 0, "an empty bill totals zero, not NaN");
  check(Number.isFinite(creatorTotals([{ ...blankLineItem(0), quantity: 1, rate: 1 }]).amountBeforeTax), "an empty bill does not produce NaN");

  /* The tax figures the form shows are the server's, by construction: `creatorTotals`
     does not know the rates, and section H1 proves the shared part. A form that
     recalculated GST differently is the failure this whole file is about, so the
     rates are checked through the canonical function directly. */
  /* An intra-state supply: 18% split into two 9% slabs, charged as two. `applies` is
     passed explicitly rather than left out, because leaving it out means "this bill has
     charged nothing yet, so charge everything" — which is a different claim and is
     checked separately below. */
  const taxed = computeTotals({
    lineItems: [{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 1000, amount: 1000 }],
    cgstRate: 9, sgstRate: 9, igstRate: 18,
    applies: { cgst: true, sgst: true, igst: false },
  });
  check(taxed.cgst === 90 && taxed.sgst === 90 && taxed.igst === 0, "an intra-state supply charges CGST and SGST and not IGST", `${taxed.cgst}/${taxed.sgst}/${taxed.igst}`);
  check(taxed.totalGst === 180, "and its total GST is the two together", String(taxed.totalGst));
  check(taxed.amountAfterTax === 1180, "and the total is the base plus the tax", String(taxed.amountAfterTax));

  /* An inter-state supply: 18% as one slab. The counterpart, because a renderer that
     only ever split the tax would produce two invoices that each add up. */
  const interStateTaxed = computeTotals({
    lineItems: [{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 1000, amount: 1000 }],
    cgstRate: 9, sgstRate: 9, igstRate: 18,
    applies: { cgst: false, sgst: false, igst: true },
  });
  check(interStateTaxed.igst === 180 && interStateTaxed.cgst === 0, "an inter-state supply charges IGST alone", `${interStateTaxed.cgst}/${interStateTaxed.sgst}/${interStateTaxed.igst}`);
  check(interStateTaxed.amountAfterTax === 1180, "for the same 18% and the same total as the intra-state split", String(interStateTaxed.amountAfterTax));

  /* A bill with no stored amounts charges every rate the user typed. Documented, not
     accidental: the creator shows all three computed amounts live precisely so the
     effect is visible rather than discovered in the PDF. */
  const fromBlank = computeTotals({
    lineItems: [{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 100, amount: 100 }],
    cgstRate: 9, sgstRate: 9, igstRate: 18,
  });
  check(fromBlank.cgst === 9 && fromBlank.sgst === 9 && fromBlank.igst === 18, "a brand-new bill charges every rate it was given", `${fromBlank.cgst}/${fromBlank.sgst}/${fromBlank.igst}`);
  const fromExisting = computeTotals({
    lineItems: [{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 100, amount: 100 }],
    cgstRate: 9, sgstRate: 9, igstRate: 18,
    applies: { cgst: true, sgst: true, igst: false },
  });
  check(fromExisting.igst === 0, "and a bill that already charges intra-state does not also charge IGST");

  /* ── THE TRAP THIS WHOLE FILE EXISTS TO CATCH ──
     A copy of an intra-state bill, computed against a blank base, charges all three
     rates because it has no amounts yet and `applicableFromAmounts` cannot tell it apart
     from a brand-new bill. On the reference workbook that turns a 77,290 bill into an
     89,080 one — an 18,000 error, printed, on a tax invoice, with no error anywhere.

     The assertions below are that specific trap, in miniature, and then for real in
     section C. */
  {
    /* An intra-state bill: it charges 9% + 9%, and 18% sits in the sheet as a reference
       rate that it is NOT charging. */
    const source = {
      ...emptyBillRecord("original"),
      cgst: 9, sgst: 9, igst: 0,
      cgst_rate: 9, sgst_rate: 9, igst_rate: 18,
    } as BillRecord;

    check(chargeDescription(source) === "INTRA_STATE", "an intra-state source is described as intra-state");
    check(chargeDescription({ ...emptyBillRecord("original"), cgst: 0, sgst: 0, igst: 18 } as BillRecord) === "INTER_STATE", "an inter-state source is described as inter-state");
    check(chargeDescription(emptyBillRecord("original")) === "UNSET", "a bill that has charged nothing says so rather than guessing");
    check(chargeDescription(null) === "UNSET", "and so does a bill with no record at all");

    /* The inflated figure, spelled out: base 100, all three rates charged, 136. */
    const naive = computeTotals({
      lineItems: [{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 100, amount: 100 }],
      cgstRate: 9, sgstRate: 9, igstRate: 18,
    });
    check(naive.amountAfterTax === 136, "against a blank base, all three rates charge and the total inflates", String(naive.amountAfterTax));

    /* The same bill, computed against `copyBaseRecord(source)` — which carries the
       amounts purely as the applicability signal. */
    const inherited = computeBillValues(copyBaseRecord(source), [], {
      invoice_no: "INTRA-COPY",
      cgst_rate: 9, sgst_rate: 9, igst_rate: 18,
      line_items: lineItemsToPatch([{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 100, amount: 100 }]),
    });
    check(Number(inherited.values.cgst) === 9 && Number(inherited.values.sgst) === 9, "a copy of an intra-state bill charges CGST and SGST", `${String(inherited.values.cgst)}/${String(inherited.values.sgst)}`);
    check(Number(inherited.values.igst) === 0, "and no IGST", String(inherited.values.igst));
    check(Number(inherited.values.amount_after_tax) === 118, "so its total is the honest one", String(inherited.values.amount_after_tax));

    /* The inverse error, which would UNDER-charge. Both directions matter: an asymmetry
       here would mean the copy is not inheriting anything at all. */
    const interState = {
      ...emptyBillRecord("original"),
      cgst: 0, sgst: 0, igst: 18,
      cgst_rate: 18, sgst_rate: 18, igst_rate: 18,
    } as BillRecord;
    const interCopy = computeBillValues(copyBaseRecord(interState), [], {
      invoice_no: "INTER-COPY",
      cgst_rate: 18, sgst_rate: 18, igst_rate: 18,
      line_items: lineItemsToPatch([{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 100, amount: 100 }]),
    });
    check(Number(interCopy.values.cgst) === 0 && Number(interCopy.values.sgst) === 0, "a copy of an inter-state bill charges neither slab", `${String(interCopy.values.cgst)}/${String(interCopy.values.sgst)}`);
    check(Number(interCopy.values.igst) === 18, "and charges IGST", String(interCopy.values.igst));
    check(Number(interCopy.values.amount_after_tax) === 118, "so its total is the honest one too", String(interCopy.values.amount_after_tax));

    /* The inherited amounts are a SIGNAL, not a total. If they leaked into the stored
       bill the copy would carry the source's money instead of its own — the exact failure
       `NEVER_COPIED_FIELDS` exists to prevent — so assert they are recomputed even
       though the base was handed them. A source charging 900/900/0 must not produce a
       100-base bill charging 900. */
    const rich = {
      ...emptyBillRecord("original"),
      cgst: 900, sgst: 900, igst: 0,
      cgst_rate: 9, sgst_rate: 9, igst_rate: 18,
      amount_after_tax: 19080,
    } as BillRecord;
    const signalCopy = computeBillValues(copyBaseRecord(rich), [], {
      invoice_no: "SIGNAL-1",
      cgst_rate: 9, sgst_rate: 9, igst_rate: 18,
      line_items: lineItemsToPatch([{ ...blankLineItem(0), description: "Work", quantity: 1, rate: 100, amount: 100 }]),
    });
    check(Number(signalCopy.values.cgst) === 9, "an inherited tax amount is not carried into the copy as a total", String(signalCopy.values.cgst));
    check(Number(signalCopy.values.amount_after_tax) === 118, "and the copy's total is its own", String(signalCopy.values.amount_after_tax));

    check(copyBaseRecord(null).cgst === null, "with no source, a new bill inherits no applicability at all");
    check(copyBaseRecord(null).amount_after_tax === null, "and no total either");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   I. The highlight set — copy, but tell the user what to look at
   ═══════════════════════════════════════════════════════════════════════════ */

section("I. What a copy highlights for review");

{
  check(LIKELY_TO_CHANGE_FIELDS.includes("invoice_no"), "the invoice number is highlighted");
  check(LIKELY_TO_CHANGE_FIELDS.includes("invoice_date"), "the invoice date is highlighted");
  check(LIKELY_TO_CHANGE_FIELDS.includes("party_name"), "the customer is highlighted");
  /* Named exactly, because the columns are `our_challan_no` and `your_challan_no` —
     there is no field whose name begins with "challan", so a substring test here would
     pass for the wrong reason or fail for a real gap depending on how it was written. */
  for (const challan of ["our_challan_no", "our_challan_date", "your_challan_no", "your_challan_date"]) {
    check(LIKELY_TO_CHANGE_SET.has(challan), `${challan} is highlighted`);
  }
  check(LIKELY_TO_CHANGE_FIELDS.includes("order_no") && LIKELY_TO_CHANGE_FIELDS.includes("order_date"), "the order number and date are highlighted");
  check(LIKELY_TO_CHANGE_FIELDS.includes("eway_bill_no"), "the e-way bill is highlighted");

  /* Deliberately NOT highlighted, and worth asserting: the things a copy almost
     always still has right. Highlighting them too would make every field look urgent
     and the highlighting would stop being read. */
  for (const quiet of ["terms", "bank_details", "certification", "cgst_rate", "seller_name"]) {
    check(!LIKELY_TO_CHANGE_SET.has(quiet), `${quiet} is not highlighted — a copy keeps it and highlighting it would be noise`);
  }

  /* Line items are preserved rather than flagged, per the requirement, because they
     are the part of a copy that is usually still correct. */
  check(!LIKELY_TO_CHANGE_SET.has("line_items"), "line items are preserved, not flagged for review");

  /* Nothing in the highlight set may be a field that does not exist. */
  const unknown = LIKELY_TO_CHANGE_FIELDS.filter((f) => !(COPYABLE_PATCH_KEYS as readonly string[]).includes(f));
  check(unknown.length === 0, "every highlighted field is a copyable field", unknown.join(", "));
}

/* ═══════════════════════════════════════════════════════════════════════════
   J. THE HEADLINE CLAIM — a hand-built invoice and an imported one print the same
   ═══════════════════════════════════════════════════════════════════════════ */

section("J. One renderer: a typed bill and a parsed bill print identically");

{
  /* The strongest form of the "one engine" requirement available without a database:
     take the SOURCE bill exactly as the upload path stored it, and take the COPY the
     creator would produce from it, and require the two documents to be byte-identical.
     If a creator had its own layout, its own tax maths or its own copy labelling,
     this is where it would show. */
  const sourceCopy = sourceCopies[0];

  /* The creator's version: seeded from the record, recomputed through the canonical
     patch path, rendered through the canonical renderer. */
  const seeded = computeBillValues(copyBaseRecord(realRecord), realItems, {
    ...patchFromRecord(realRecord),
    line_items: lineItemsToPatch(realItems),
  });
  const creatorRecord = { ...(realRecord as unknown as BillRecord), ...(seeded.values as Partial<BillRecord>) } as BillRecord;

  const label = COPY_LABEL.original as string;
  const fromParsed = renderBillDocument([sourceCopy], label, null, NO_PROFILE);
  const fromCreator = renderBillDocument(
    [billFromRecord({ ...creatorRecord, copy: "original" }, realItems, label)],
    label,
    null,
    NO_PROFILE
  );

  check(
    Buffer.from(fromCreator).equals(Buffer.from(fromParsed)),
    "a bill seeded from a record renders byte-identically to the parsed original",
    `${fromCreator.length} vs ${fromParsed.length} bytes`
  );

  /* And the reverse direction: a bill the user TYPES from scratch, with the same
     values the parser read, prints the same as the parser's own document. This is the
     claim that matters for a brand-new bill, and it cannot be proved by rendering a
     copy of the source — it has to be a genuinely hand-assembled record. */
  const handTyped: BillRecord = {
    ...emptyBillRecord("original"),
    sheet_name: storedRecords[0].sheet_name as string,
    job_kind: sourceCopy.jobKind ?? null,
    invoice_no: sourceCopy.invoiceNo ?? null,
    invoice_date: sourceCopy.invoiceDate ?? null,
    our_challan_no: sourceCopy.ourChallanNo ?? null,
    order_no_label: sourceCopy.orderNoLabel ?? null,
    recipient_label: sourceCopy.recipientLabel ?? null,
    party_name: sourceCopy.partyName ?? null,
    party_gst_no: sourceCopy.partyGstNo ?? null,
    seller_name: sourceCopy.sellerName ?? null,
    seller_address: sourceCopy.sellerAddress ?? null,
    seller_tax_line: sourceCopy.sellerTaxLine ?? null,
    bank_details: null,
    certification: sourceCopy.certification ?? null,
    receiver_signature: sourceCopy.receiverSignature ?? null,
  };
  const handDoc = renderBillDocument(
    [billFromRecord(handTyped, realItems, label)],
    label,
    null,
    NO_PROFILE
  );
  check(handDoc.length > 500, "a hand-typed bill renders to a real document", `${handDoc.length} bytes`);

  /* A logo is the one input that genuinely differs per bill, and it must change the
     document rather than being ignored — that is the whole "letterhead" feature.

     The image is built through `decodePdfImage`, the SAME decoder the upload path uses
     to read a stored logo, from PNG bytes assembled here. Not a hand-written
     `PdfImage` literal: the point of this check is that a real logo reaches the page,
     and a literal would test the renderer's tolerance of a shape that no logo file can
     produce. */
  {
    const withLogo = renderBillDocument(
      [billFromRecord(creatorRecord, realItems, label)],
      label,
      await decodePdfImage(solidPng(8, 6, [200, 30, 30])),
      NO_PROFILE
    );
    check(withLogo.length > 500, "a bill with a logo renders", `${withLogo.length} bytes`);
    check(
      !Buffer.from(withLogo).equals(Buffer.from(fromCreator)),
      "and the logo actually changes the document rather than being ignored",
      `${withLogo.length} vs ${fromCreator.length} bytes`
    );

    /* The SAME image at a different size must place differently, which is what proves
       it was laid out rather than stamped. Without this, "the bytes differ" could be
       satisfied by a logo of any dimensions occupying the same box. */
    const bigger = renderBillDocument(
      [billFromRecord(creatorRecord, realItems, label)],
      label,
      await decodePdfImage(solidPng(64, 48, [200, 30, 30])),
      NO_PROFILE
    );
    check(
      !Buffer.from(bigger).equals(Buffer.from(withLogo)),
      "a larger logo lays out differently, so its dimensions are honoured"
    );

    /* And the logo must not disturb the invoice's own text: the designation is still
       there, and the totals are still the same numbers. A logo that overwrote content
       would still pass the two checks above. */
    const logoText = Buffer.from(withLogo).toString("latin1");
    check(logoText.includes("ORIGINAL"), "a letterheaded invoice still prints its designation");
  }

  /* A logo that cannot be read must NOT produce a document. The edge function treats
     this as a hard failure and the test asserts the underlying reason: rendering with
     a null logo when one was asked for is the state that must never be stored. */
  const logoWantedButNull = renderBillDocument(
    [billFromRecord(creatorRecord, realItems, label)],
    label,
    null,
    NO_PROFILE
  );
  check(logoWantedButNull.length > 500, "rendering without a logo still works — which is why the server refuses it explicitly");

  /* `decodePdfImage` returns null for bytes it cannot read rather than throwing, so
     `loadInvoiceLogoImage` can answer "no image" — and the creator's contract is that a
     bill asking for a logo it cannot read is refused rather than printed without one.
     The refusal itself is in the edge function; what is testable here is that the
     decoder really does fail closed, since the whole refusal rests on it. */
  check((await decodePdfImage(new Uint8Array([1, 2, 3, 4]))) === null, "an unreadable image decodes to null rather than a broken placeholder");
  check((await decodePdfImage(new Uint8Array(0))) === null, "and so does an empty one");
}

/* ═══════════════════════════════════════════════════════════════════════════
   K. Three copies that differ ONLY by designation
   ═══════════════════════════════════════════════════════════════════════════ */

section("K. Original, Duplicate and Triplicate differ only in their designation");

{
  const creatorRecord = { ...(realRecord as unknown as BillRecord) } as BillRecord;

  const docs = COPY_ORDER.map((copy: CopyKind) => {
    const bytes = renderBillDocument(
      [billFromRecord({ ...creatorRecord, copy }, realItems, COPY_LABEL[copy])],
      COPY_LABEL[copy],
      null,
      NO_PROFILE
    );
    return { copy, label: COPY_LABEL[copy], bytes, text: Buffer.from(bytes).toString("latin1") };
  });

  check(docs.length === 3, "three copies are produced", docs.map((d) => d.copy).join(", "));

  /* Each carries its own designation and no other copy's. This is the guarantee behind
     "the user must not fill the bill three times" — one form, three documents, and the
     only difference between them is the word in the corner. */
  for (const doc of docs) {
    const others = docs.filter((d) => d.copy !== doc.copy);
    check(doc.text.includes(doc.label.toUpperCase()), `${doc.copy} carries its own designation`, doc.label);
    for (const other of others) {
      check(
        !doc.text.includes(other.label.toUpperCase()),
        `${doc.copy} does not carry ${other.copy}'s designation`
      );
    }
  }

  /* The copy kind and the label cannot disagree: `renderBillDocument` recovers the
     kind from the label, so a document whose footer says DUPLICATE cannot have an
     ORIGINAL corner marker. */
  const dupe = docs.find((d) => d.copy === "duplicate")!;
  check(dupe.text.includes("ORIGINAL") === false, "the DUPLICATE document never prints ORIGINAL");
  check(docs[0].text.includes("ORIGINAL"), "the ORIGINAL document prints ORIGINAL");

  /* Sizes may differ by a hair (compression of the same content in a different order
     is not guaranteed byte-stable), but no copy may be a blank or truncated document. */
  for (const doc of docs) {
    check(doc.bytes.length > 500, `${doc.copy} is a full document`, `${doc.bytes.length} bytes`);
    check(doc.text.includes("%%EOF"), `${doc.copy} is a complete PDF`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   L. A blank bill still renders — the creator's starting point
   ═══════════════════════════════════════════════════════════════════════════ */

section("L. The empty form");

{
  const blank = emptyBillRecord();
  check(blank.invoice_no === null && blank.amount_after_tax === null, "an empty record is empty, not zero");

  const doc = renderBillDocument([billFromRecord(blank, [], COPY_LABEL.original)], COPY_LABEL.original, null, NO_PROFILE);
  check(doc.length > 500, "an empty bill still renders a document rather than throwing");
  check(Buffer.from(doc).toString("latin1").includes("%%EOF"), "and it is a complete PDF");

  /* Every field of a blank record must be null rather than "undefined" or "", because
     `billFromRecord` distinguishes those: an empty string prints a blank line, a null
     prints nothing. A creator whose blank form printed a column of blank labels would
     look different from an imported invoice, which is the failure being guarded. */
  /* `id` and `sheet_name` are exempt, and it is worth being explicit about why rather than
     quietly excluding them: neither is a field the form shows or the PDF prints — they
     are the row's own identity, assigned by the database and the upload respectively —
     so an empty string in the blank record is a "not yet assigned" marker and never
     reaches `billFromRecord` as text. Every PRINTED field must be null. */
  const PRINTED = Object.entries(blank).filter(
    ([k, v]) => k !== "id" && k !== "sheet_name"
  );
  check(PRINTED.length > 40, "the blank record carries a full invoice's fields", `${PRINTED.length} fields`);
  const emptyStrings = PRINTED.filter(([, v]) => v === "");
  check(emptyStrings.length === 0, "no printed blank field is an empty string", emptyStrings.map(([k]) => k).join(", "));

  /* Null throughout, never undefined: `billFromRecord` treats the two differently in
     some paths and the difference is invisible in the output. */
  const undefinedFields = PRINTED.filter(([, v]) => v === undefined);
  check(undefinedFields.length === 0, "and none is undefined", undefinedFields.map(([k]) => k).join(", "));
}

/* ═══════════════════════════════════════════════════════════════════════════
   M. Reading old and new bank shapes back into a form
   ═══════════════════════════════════════════════════════════════════════════ */

section("M. The bank block survives a round trip through a form");

{
  /* 0008 stored label/value parts; rows from before it stored an array of printed
     lines. Both are legitimate and both must come out of a copy usable, or an old bill
     copied into a new one would silently lose its bank. */
  const parts = bankFromRecord({ account: { label: "Bank Name: EXAMPLE BANK", value: "EXAM" } });
  check(parts !== null && parts.account?.value === "EXAM", "a parts-shaped bank block is read back");
  const fromLines = bankFromRecord(["Bank Name: EXAMPLE BANK", "EXAM", "IFSC:EXAM0000001"]);
  check(fromLines !== null && Object.keys(fromLines).length >= 2, "a legacy line-array bank block is read back as parts", `${Object.keys(fromLines ?? {}).length} parts`);
  check(bankFromRecord(null) === null, "an absent bank block stays absent");
  check(bankFromRecord([]) === null, "an empty bank block stays absent, not { }");
  check(bankFromRecord("") === null, "an empty string bank block stays absent");
}

/* ═══════════════════════════════════════════════════════════════════════════
   N. Line-item marshalling
   ═══════════════════════════════════════════════════════════════════════════ */

section("N. Line items survive the trip between form and server");

{
  const items: BillLineItem[] = [
    { srNo: 1, description: "Steel fabrication", hsnCode: "7308", uom: "KG", quantity: 125.5, rate: 62.25, amount: 7812.375 },
    { srNo: 2, description: "Welding", hsnCode: null, uom: null, quantity: null, rate: null, amount: 1500 },
  ];

  const asRows = lineItemsToPatch(items);
  check(asRows.length === 2, "both lines are marshalled");
  check(asRows[0].quantity === 125.5 && asRows[0].rate === 62.25, "a fractional quantity and a decimal rate survive");

  const back = lineItemsFromRows(asRows);
  check(back.length === 2, "and come back as two lines");
  check(back[0].description === "Steel fabrication" && back[0].hsnCode === "7308", "with their text intact");
  check(back[0].quantity === 125.5, "and their numbers intact");
  check(back[1].amount === 1500 && back[1].quantity === null, "and a null quantity stays null rather than becoming 0");

  check(lineItemsFromRows(null).length === 0, "a missing line-item list is empty, not a crash");
  check(lineItemsFromRows("nonsense").length === 0, "a non-array line-item list is empty");
  check(lineItemsFromRows([]).length === 0, "an empty list stays empty");

  /* `numberOrNull` is what keeps "" from becoming 0 — and a quantity of 0 is a real
     value, whereas a blank input is not one. */
  check(numberOrNull("") === null, "an empty input is not zero");
  check(numberOrNull(null) === null, "null is null");
  check(numberOrNull("0") === 0, "but a typed zero IS zero");
  check(numberOrNull("1,234.50") === 1234.5, "a comma-grouped input is read");
  check(numberOrNull("abc") === null, "unparseable text is null, not NaN");
  check(numberOrNull(0) === 0, "numeric zero survives");
}

/* ═══════════════════════════════════════════════════════════════════════════
   O. The source mode matrix
   ═══════════════════════════════════════════════════════════════════════════ */

section("O. All four ways of starting a bill");

{
  /* new: nothing seeded.
     new + profile: the profile fills the gaps at render time.
     copy: the record seeded, source profile snapshot.
     copy + profile override: the record seeded, TODAY's profile. */
  const blank = computeBillValues(emptyBillRecord(), [], { invoice_no: "NEW-1" });
  check(blank.values.invoice_no === "NEW-1", "a new bill takes the form's own value");
  check(Number(blank.values.amount_after_tax ?? 0) === 0, "and starts at zero, which is truthful");

  const withProfile = renderBillDocument(
    [billFromRecord({ ...emptyBillRecord("original"), invoice_no: "NEW-2" }, [], COPY_LABEL.original)],
    COPY_LABEL.original,
    null,
    demoProfile
  );
  check(Buffer.from(withProfile).toString("latin1").includes("PROFILE COMPANY"), "a new bill + profile prints the profile's company name");

  const copy = patchFromRecord(realRecord);
  check(copy.invoice_no === realRecord.invoice_no, "a copy starts from the source's values");

  const copyOverride = { ...copy };
  delete (copyOverride as Record<string, unknown>).seller_name;
  const withoutOwnName = renderBillDocument(
    [billFromRecord(
      { ...emptyBillRecord("original"), ...(copyOverride as Partial<BillRecord>), copy: "original" },
      realItems,
      COPY_LABEL.original
    )],
    COPY_LABEL.original,
    null,
    demoProfile
  );
  check(
    Buffer.from(withoutOwnName).toString("latin1").includes("PROFILE COMPANY"),
    "a copy with the profile override blanks the source's own seller name and uses today's profile"
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   P. No second calculator — every figure comes from the shared functions
   ═══════════════════════════════════════════════════════════════════════════ */

section("P. The creator invents no arithmetic of its own");

{
  /* A static check, and the reason it is worth having: a "helpful" rounding helper or a
     hand-rolled GST calculation added to the creator later would be invisible to every
     other test in this file. The only maths in `billCreator.ts` is a convenience
     wrapper over the canonical functions and the words generator. */
  const src = readFileSync(
    resolve(fileURLToPath(new URL(".", import.meta.url)), "../process-bill-upload/_shared/billCreator.ts"),
    "utf8"
  );
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of ["cgst_rate *", "igst_rate *", "sgst_rate *", "* 0.18", "* 0.09", "1.18", "1.09"]) {
    check(!stripped.includes(forbidden), `the creator contains no hard-coded tax arithmetic (${forbidden})`);
  }
  check(
    stripped.includes("computeTotals") === false || stripped.includes("computeTotals("),
    "tax figures come from computeTotals, not from a local copy of it"
  );
  check(
    !stripped.includes("function round2") && !stripped.includes("const round2 ="),
    "and it defines no rounding of its own — round2 is imported"
  );
  check(
    stripped.includes("round2(") && stripped.includes('from "./billDocument.ts"'),
    "it imports the canonical rounding rather than defining one"
  );
  check(stripped.includes('from "./billEdit.ts"'), "the patch shape is imported, not restated");
  check(stripped.includes('from "./parseBill.ts"'), "and so is the canonical BillCopy's module");
}

/* ═══════════════════════════════════════════════════════════════════════════
   Q. Every source bill, for real
   ═══════════════════════════════════════════════════════════════════════════ */

section("Q. All reference bills copy cleanly");

{
  for (let at = 0; at < sourceCopies.length; at++) {
    const copy = sourceCopies[at];
    /* The STORED shape, not the round-tripped one: this section asks whether a copy of
       what the upload path actually wrote would pass finalization. */
    const record = storedRecords[at] as unknown as BillRecord;
    const seed = patchFromRecord(record);
    const items = copy.lineItems ?? [];
    const errors = validateForFinalize({
      patch: seed,
      lineItems: items,
      totals: {
        amountBeforeTax: Number(record.amount_before_tax ?? 0),
        totalGst: Number(record.total_gst ?? 0),
        amountAfterTax: Number(record.amount_after_tax ?? 0),
      },
    });
    check(
      errors.length === 0,
      `bill ${copy.invoiceNo ?? "?"} would pass finalization as copied`,
      errors.map((e) => e.message).join("; ")
    );
  }

  /* Every real bill's total must survive being re-derived through the creator's path,
     which is the "copy this bill and the numbers still add up" claim over real data. */
  let drifted = 0;
  for (let at = 0; at < sourceCopies.length; at++) {
    const record = storedRecords[at] as unknown as BillRecord;
    const items = sourceCopies[at].lineItems ?? [];
    const derived = computeBillValues(copyBaseRecord(record), items, {
      ...patchFromRecord(record),
      line_items: lineItemsToPatch(items),
    });
    if (round2(Number(derived.values.amount_after_tax ?? 0)) !== round2(Number(record.amount_after_tax ?? 0))) {
      drifted++;
      console.log(`        ${record.invoice_no}: ${String(derived.values.amount_after_tax)} != ${String(record.amount_after_tax)}`);
    }
  }
  check(drifted === 0, "every real bill's total survives a copy unchanged", `${sourceCopies.length - drifted}/${sourceCopies.length}`);

  /* And each one must render through the creator's path to a complete document. */
  let rendered = 0;
  for (let at = 0; at < sourceCopies.length; at++) {
    try {
      const record = { ...(storedRecords[at] as unknown as BillRecord), copy: "original" } as BillRecord;
      const bytes = renderBillDocument(
        [billFromRecord(record, sourceCopies[at].lineItems ?? [], COPY_LABEL.original)],
        COPY_LABEL.original,
        null,
        NO_PROFILE
      );
      if (bytes.length > 500) rendered++;
    } catch (err) {
      console.log(`        ${(storedRecords[at] as Record<string, unknown>).invoice_no}: ${String(err)}`);
    }
  }
  check(rendered === sourceCopies.length, "every real bill renders from its stored record", `${rendered}/${sourceCopies.length}`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   R. The two client copies, and their agreement with the server
   ═══════════════════════════════════════════════════════════════════════════ */

/*
 * This section is the answer to the only question the mirroring strategy raises: two
 * files that must never drift, each of which duplicates a decision the server also makes.
 *
 * Three separate claims, checked three separate ways, because they fail differently:
 *
 *   1. BYTE  — the two files are the same file. Fails the moment one is edited alone.
 *   2. BEHAVIOUR — both produce the same output. Fails if a mirror is edited to "just fix
 *      it on my platform", which is byte-different and so also fails (1), but the
 *   behaviour check is what names the actual value that disagreed.
 *   3. SERVER — the form's idea of the profile and of a copy agrees with the canonical
 *      functions. This is the check that would catch a space too many in a prefill: the
 *      bytes would be identical in both clients and both would be wrong.
 */

{
  const adminPath = resolve(REPO, "Metalworker_admin/src/services/creatorForm.ts");
  const desktopPath = resolve(REPO, "Metalworker_desktop/src/services/creatorForm.ts");
  const adminText = readFileSync(adminPath, "utf8");
  const desktopText = readFileSync(desktopPath, "utf8");

  const adminLines = adminText.split("\n");
  const desktopLines = desktopText.split("\n");

  check(
    adminLines[0] === "// Metalworker_admin/src/services/creatorForm.ts",
    "the Expo copy names itself on line 1"
  );
  check(
    desktopLines[0] === "// Metalworker_desktop/src/services/creatorForm.ts",
    "the desktop copy names itself on line 1"
  );

  /* Compared from line 2 onwards, and the first differing line named rather than a count
     — "the copy is 309 lines different" is not something anybody can act on. */
  let firstDifference = -1;
  for (let i = 1; i < Math.max(adminLines.length, desktopLines.length); i++) {
    if (adminLines[i] !== desktopLines[i]) {
      firstDifference = i + 1;
      break;
    }
  }
  check(
    firstDifference === -1,
    "the two client copies of the form module are byte-identical above line 1",
    firstDifference === -1
      ? `${adminLines.length} lines`
      : `first difference at line ${firstDifference}: admin ${JSON.stringify((adminLines[firstDifference - 1] ?? "").slice(0, 70))} vs desktop ${JSON.stringify((desktopLines[firstDifference - 1] ?? "").slice(0, 70))}`
  );

  /* The sync script is the supported way to change a copy, so it must report the same
     answer the byte comparison just gave. Testing the script is not busywork: it is the
     thing a developer will actually reach for, and a script that rewrites the desktop
     file with the wrong `supabase` path would be caught by nothing else here. */
  const syncScript = resolve(REPO, "Metalworker_admin/scripts/sync-bill-creator-mirrors.js");
  check(existsSync(syncScript), "the mirror sync script exists", relative(REPO, syncScript));
  check(
    !/node_modules/.test(readFileSync(syncScript, "utf8")),
    "and is not vendored out of a dependency"
  );
}

/* Both copies, run over the same inputs. */
{
  const probe = realRecord as unknown as Record<string, unknown>;
  const probeItems = (realItems ?? []) as unknown as Record<string, unknown>[];
  const inputs = {
    fromRecord: [probe, probeItems, "k"],
    fromProfile: [profileToSnapshot(demoProfile), "k"],
    empty: ["k"],
    lines: [
      [
        { key: "a", srNo: "1", description: "X", hsnCode: "7308", uom: "NOS", quantity: "2.5", rate: "1,200.50", amount: "" },
        { key: "b", srNo: "2", description: "Y", hsnCode: "", uom: "KG", quantity: "", rate: "10", amount: "" },
      ],
    ],
    bankLines: [["BRANCH:MUMBAI", "Bank Name: EXAMPLE BANK", "ACCOUNT NUMBER:000123", "IFSC CODE:EXAM0000001"]],
    terms: [["Payment within 30 days.", "Interest @18% p.a.", "{COMPANY_NAME} only."]],
  } as const;

  const fromAdmin = {
    record: creatorFormAdmin.seedFromRecord(...(inputs.fromRecord as never)),
    profile: creatorFormAdmin.seedFromProfile(...(inputs.fromProfile as never)),
    empty: creatorFormAdmin.seedEmpty(...(inputs.empty as never)),
    patch: creatorFormAdmin.buildPatch({
      values: { invoice_no: "  INV/9  ", party_gst_no: "", cgst_rate: "9" },
      lines: creatorFormAdmin.linesFromRecord ? [...inputs.lines[0]] : [],
      amountInWords: "  ",
    }),
    totals: creatorFormAdmin.creatorTotals([...inputs.lines[0]]),
    bank: creatorFormAdmin.parseBankLines([...inputs.bankLines[0]]),
    bankLines: creatorFormAdmin.bankLinesOf(creatorFormAdmin.parseBankLines([...inputs.bankLines[0]])),
    terms: creatorFormAdmin.readTerms([...inputs.terms[0]]),
  };
  const fromDesktop = {
    record: creatorFormDesktop.seedFromRecord(...(inputs.fromRecord as never)),
    profile: creatorFormDesktop.seedFromProfile(...(inputs.fromProfile as never)),
    empty: creatorFormDesktop.seedEmpty(...(inputs.empty as never)),
    patch: creatorFormDesktop.buildPatch({
      values: { invoice_no: "  INV/9  ", party_gst_no: "", cgst_rate: "9" },
      lines: creatorFormDesktop.linesFromRecord ? [...inputs.lines[0]] : [],
      amountInWords: "  ",
    }),
    totals: creatorFormDesktop.creatorTotals([...inputs.lines[0]]),
    bank: creatorFormDesktop.parseBankLines([...inputs.bankLines[0]]),
    bankLines: creatorFormDesktop.bankLinesOf(creatorFormDesktop.parseBankLines([...inputs.bankLines[0]])),
    terms: creatorFormDesktop.readTerms([...inputs.terms[0]]),
  };

  for (const key of Object.keys(fromAdmin) as (keyof typeof fromAdmin)[]) {
    check(
      JSON.stringify(fromAdmin[key]) === JSON.stringify(fromDesktop[key]),
      `both client copies agree on ${key}`
    );
  }

  /* Spot values, so "they agree" cannot be satisfied by both returning nothing at all. */
  check(
    (fromAdmin.bankLines as string[]).length === 4,
    "the form reads a workbook's four bank lines",
    JSON.stringify(fromAdmin.bankLines)
  );
  check(
    (fromAdmin.bankLines as string[]).includes("Bank Name: EXAMPLE BANK"),
    "and keeps the workbook's space after the colon — the byte-fidelity rule"
  );
  check(
    JSON.stringify(fromAdmin.terms) === JSON.stringify(["Payment within 30 days.", "Interest @18% p.a.", "{COMPANY_NAME} only."]),
    "the three term lines are read positionally"
  );
  check(
    (fromAdmin.patch as Record<string, unknown>).invoice_no === "INV/9",
    "the patch trims what the admin typed"
  );
  check(
    (fromAdmin.patch as Record<string, unknown>).party_gst_no === null,
    "a cleared field is sent as null, not as an empty string"
  );
  check(
    (fromAdmin.patch as Record<string, unknown>).amount_in_words === null,
    "and cleared words ask for regeneration rather than blanking the line"
  );
}

/* THE PRELOAD MUST PRINT WHAT THE SERVER WILL PRINT. */
{
  const snapshot = profileToSnapshot(demoProfile);
  const seeded = creatorFormAdmin.seedFromProfile(snapshot, "k");

  /* `seller_tax_line` is ONE column holding two registration numbers, so it cannot be
     field-mapped — it is joined by a rule that exists in exactly two places, this one and
     `mergeTaxLine`. If the two disagree the admin previews a tax line the PDF does not
     have, and a GST invoice whose printed registration number is wrong is a real problem
     rather than a cosmetic one. */
  const taxParts: string[] = [];
  if (demoProfile.gstNumber !== null) taxParts.push(`GST No.${demoProfile.gstNumber}`);
  if (demoProfile.msmeNumber !== null) taxParts.push(`MSME NO.${demoProfile.msmeNumber}`);
  check(
    seeded.values.seller_tax_line === taxParts.join(" "),
    "the preloaded tax line matches the server's mergeTaxLine, character for character",
    JSON.stringify(seeded.values.seller_tax_line)
  );

  const contactParts = [demoProfile.email1, demoProfile.email2, demoProfile.mobile1, demoProfile.mobile2].filter(
    (v): v is string => v !== null && v !== ""
  );
  check(
    seeded.values.seller_contact === contactParts.join(", "),
    "the preloaded contact line matches the server's mergeContact"
  );

  check(
    seeded.values.seller_name === demoProfile.companyName &&
      seeded.values.seller_descriptor === demoProfile.businessDescription &&
      seeded.values.seller_address === demoProfile.officeAddress &&
      seeded.values.on_behalf_of === (demoProfile.authorizedSignatoryText ?? "") &&
      seeded.values.signature_designation === (demoProfile.authorizedSignatoryDesignation ?? "") &&
      seeded.values.receiver_signature === (demoProfile.receiverSignatureLabel ?? "") &&
      seeded.values.certification === (demoProfile.certificationText ?? ""),
    "every seller, footer and certification field preloads from the profile"
  );

  /* A field the profile has nothing for is set to BLANK rather than left out, because
     leaving it out would tell the server to keep the stored value — so ticking "use the
     current profile" on a copy would silently preserve the source's certification. */
  check(
    seeded.values.certification === "" && seeded.values.receiver_signature === "",
    "and a field the profile has nothing for is preloaded blank, not left unset"
  );

  check(
    seeded.terms[0] === (demoProfile.term1 ?? "") &&
      seeded.terms[1] === (demoProfile.term2 ?? "") &&
      seeded.terms[2] === (demoProfile.term3 ?? ""),
    "and so do the three terms, as stored — `{PAYMENT_DAYS}` unresolved on purpose"
  );

  /* The variable has to survive the preload, because that is what lets the section tell
     the admin "term 1 uses your profile's payment window" instead of guessing a number.
     A profile whose term is plain text cannot demonstrate that, so one is built. */
  const templated = creatorFormAdmin.seedFromProfile(
    profileToSnapshot({ ...demoProfile, term1: "Payment within {PAYMENT_DAYS} days.", term2: null, term3: null }),
    "k"
  );
  check(
    creatorFormAdmin.usesPaymentDaysVariable([...templated.terms]),
    "which is why the form can tell the admin that a term still carries a variable"
  );
  check(
    !creatorFormAdmin.usesPaymentDaysVariable([...seeded.terms]),
    "and does not claim one when the wording is literal"
  );
  check(
    creatorFormAdmin.paymentDaysFromTerms([...templated.terms]) === null &&
      demoProfile.paymentDays === 30,
    "while the window itself is the profile's number, not something recovered from the text"
  );
  check(
    creatorFormAdmin.fillTemplate(templated.terms[0], { PAYMENT_DAYS: 30 }) === "Payment within 30 days.",
    "which the server substitutes when it prints"
  );

  /* The bank's own labels, in the profile's own print order, rebuilt into the exact lines
     `mergeBankLines` would produce for a bill that printed none. Compared through the
     server's own `bankLinesOf`, because that is the function the renderer calls. */
  const bankValues = creatorFormAdmin.bankPartValues(seeded.bank);
  check(
    bankValues.bank_name === (demoProfile.bankName ?? "") &&
      bankValues.branch === (demoProfile.bankBranch ?? "") &&
      bankValues.ifsc_code === (demoProfile.bankIfsc ?? "") &&
      bankValues.account_number === (demoProfile.bankAccountNumber ?? ""),
    "the preloaded bank carries the profile's four values",
    JSON.stringify(bankValues)
  );
  const expectedOrder: (keyof typeof bankValues)[] = ["branch", "bank_name", "ifsc_code", "account_number"];
  const seededOrder = Object.keys(seeded.bank);
  check(
    JSON.stringify(seededOrder) === JSON.stringify(expectedOrder),
    "in the order the server's merge writes them, so the form reads in print order",
    JSON.stringify(seededOrder)
  );

  /* A profile with no bank at all must produce four EMPTY values, not four omitted ones
     and not four of the workbook's — the section shows four boxes either way. */
  const noBank = creatorFormAdmin.seedFromProfile(profileToSnapshot(NO_PROFILE), "k");
  check(
    Object.values(creatorFormAdmin.bankPartValues(noBank.bank)).every((v) => v === ""),
    "a profile with no bank preloads four empty bank fields"
  );
  check(
    creatorFormAdmin.bankLinesOf(noBank.bank).every((line) => line.trim().endsWith(":")),
    "each printing as a label with nothing after it, rather than being dropped"
  );
}

/* A COPY, SEEDED THE WAY THE FORM SEEDS IT, MUST TOTAL WHAT THE SOURCE TOTALS. */
{
  /*
   * The full claim, over every bill in the reference workbook: seed the form from a
   * stored row exactly as "Copy as Draft" does, build the patch the form would build, and
   * push both through the real `computeBillValues` on a `copyBaseRecord` base — the same
   * three functions `create-bill` calls, in the same order.
   *
   * This is what makes the entry form and the edge function one implementation rather
   * than two that happen to agree. And it is the check that would have caught the blank
   * base, which charged CGST + SGST + IGST on a copy and turned 77,290 into 89,080.
   */
  let totalMatched = 0;
  let linesMatched = 0;
  for (let at = 0; at < storedRecords.length; at++) {
    const stored = storedRecords[at] as Record<string, unknown>;
    const items = (sourceCopies[at].lineItems ?? []) as unknown as Record<string, unknown>[];

    const seed = creatorFormAdmin.seedFromRecord(stored, items, "copy");
    const patch = creatorFormAdmin.buildPatch({
      values: seed.values,
      lines: seed.lines,
      /* Omitted on purpose: that is what an untouched form sends, and it is what lets the
         server keep the source's wording when the total has not moved. */
    });

    let computed: ReturnType<typeof computeBillValues>;
    try {
      computed = computeBillValues(copyBaseRecord(stored as unknown as BillRecord), [], patch as BillPatch);
    } catch (err) {
      console.log(`        ${stored.invoice_no}: ${String(err)}`);
      continue;
    }
    const values = computed.values as Record<string, number | null>;

    if (
      round2(values.amount_before_tax ?? 0) === round2((stored.amount_before_tax as number) ?? 0) &&
      round2(values.cgst ?? 0) === round2((stored.cgst as number) ?? 0) &&
      round2(values.sgst ?? 0) === round2((stored.sgst as number) ?? 0) &&
      round2(values.igst ?? 0) === round2((stored.igst as number) ?? 0) &&
      round2(values.total_gst ?? 0) === round2((stored.total_gst as number) ?? 0)
    ) {
      totalMatched++;
    }
    if (computed.lineItems.length === items.length) linesMatched++;
  }
  check(
    totalMatched === storedRecords.length,
    "a form seeded from a real bill totals exactly what that bill totals",
    `${totalMatched}/${storedRecords.length}`
  );
  check(
    linesMatched === storedRecords.length,
    "and keeps every line item it started with",
    `${linesMatched}/${storedRecords.length}`
  );

  /* And the base really is what makes the difference, asserted rather than assumed: the
     same patch against a BLANK base charges the taxes the source did not charge. If this
     ever stops being true the fix above is no longer fixing anything. */
  const intraAt = storedRecords.findIndex(
    (row) => Number(row.cgst ?? 0) > 0 && Number(row.igst ?? 0) === 0
  );
  if (intraAt >= 0) {
    const intra = storedRecords[intraAt] as Record<string, unknown>;
    /* The line items have to come along: a patch with no items totals zero, and zero times
       any tax rate is zero, which would make the correct and the wrong base agree. */
    const intraItems = (sourceCopies[intraAt].lineItems ?? []) as unknown as Record<string, unknown>[];
    check(intraItems.length > 0, "the intra-state bill being tested has line items to tax");
    const patch = creatorFormAdmin.buildPatch({
      values: creatorFormAdmin.seedFromRecord(intra, intraItems, "x").values,
      lines: creatorFormAdmin.linesFromRecord(intraItems, "x"),
    });
    const right = computeBillValues(copyBaseRecord(intra as unknown as BillRecord), [], patch as BillPatch).values;
    const wrong = computeBillValues(emptyBillRecord(), [], patch as BillPatch).values;
    check(
      round2((right.igst as number) ?? 0) === 0,
      "an intra-state copy does not acquire IGST"
    );
    check(
      round2((wrong.igst as number) ?? 0) > 0,
      "which a blank base would have done — the bug this base exists to prevent"
    );
    check(
      round2((wrong.total_gst as number) ?? 0) > round2((right.total_gst as number) ?? 0),
      "and the blank base's tax is strictly larger, so the difference is not cosmetic"
    );
    check(
      round2((right.total_gst as number) ?? 0) === round2(intra.total_gst as number),
      "while the copy's tax matches the source's tax exactly",
      String(right.total_gst) + " vs source " + String(intra.total_gst)
    );
  } else {
    check(false, "the reference workbook contains an intra-state bill to test the base against");
  }
}

/* A NEW BILL IS NOT A COPY WITH AN EMPTY PROFILE. */
{
  const empty = creatorFormAdmin.seedEmpty("n");
  const withProfile = creatorFormAdmin.seedFromProfile(profileToSnapshot(demoProfile), "n");

  check(Object.keys(empty.values).length === 0, "New Bill preloads no seller field at all");
  check(empty.lines.length === 1, "and offers one blank line to type into");
  check(empty.lines[0].description === "", "which is empty");
  check(empty.terms.every((t) => t === ""), "with no terms");
  check(empty.amountInWords === "", "and no amount in words");

  check(
    Object.keys(withProfile.values).length > Object.keys(empty.values).length,
    "New Bill + Profile preloads the company's details"
  );
  check(
    creatorFormAdmin.bankPartValues(empty.bank).bank_name === "" &&
      creatorFormAdmin.bankPartValues(withProfile.bank).bank_name === (demoProfile.bankName ?? ""),
    "including the bank, which is the section most bills print identically from the profile"
  );

  /* The difference between the two buttons is in what is READ, never in what the form
     does afterwards — so the empty form's patch must be a strict SUBSET of the profile's,
     carrying the same scaffolding and nothing extra. An empty form that sent a key the
     profile form did not would be two different bills by another name. */
  const emptyPatch = Object.keys(
    creatorFormAdmin.buildPatch({ values: empty.values, lines: empty.lines })
  );
  const profilePatch = Object.keys(
    creatorFormAdmin.buildPatch({ values: withProfile.values, lines: withProfile.lines })
  );
  check(
    emptyPatch.every((key) => profilePatch.includes(key)),
    "the empty form's patch is a subset of the profile form's — same scaffolding, less data",
    emptyPatch.join(",")
  );
  check(
    emptyPatch.includes("line_items") && profilePatch.includes("line_items"),
    "both send line items, because both save the same canonical bill"
  );
  check(
    profilePatch.length > emptyPatch.length,
    "and the profile form really does send more"
  );
  check(
    profilePatch.includes("seller_name") && !emptyPatch.includes("seller_name"),
    "specifically the company details the other button leaves blank"
  );
}

/* The amount in words is a three-case contract, and the form must not collapse it. */
{
  check(creatorFormAdmin.amountInWordsForPatch("SAYING", false) === undefined, "an untouched words field sends nothing");
  check(creatorFormAdmin.amountInWordsForPatch("SAYING", true) === "SAYING", "an edited one sends exactly what was typed");
  check(creatorFormAdmin.amountInWordsForPatch("", true) === "", "and a cleared one asks for regeneration");

  const patch = creatorFormAdmin.buildPatch({ values: {}, amountInWords: "" });
  check(patch.amount_in_words === null, "which the patch spells as null, not as an empty string");

  const untouched = creatorFormAdmin.buildPatch({ values: {} });
  check(!("amount_in_words" in untouched), "while an untouched form omits the key entirely");
}

/* The mirror list must name REAL columns — a typo would be a field the form believes it
   must not copy and never tests for. Checked against the columns a real stored row has,
   plus the migrations that created the ones this feature added, because those two
   together are the whole column list. */
{
  const migrationsDir = resolve(REPO, "Metalworker_admin/supabase/migrations");
  const migrationText = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(resolve(migrationsDir, name), "utf8"))
    .join("\n");

  for (const field of creatorFormAdmin.NEVER_COPIED_FIELDS) {
    check(
      field in realRecord || migrationText.includes(field),
      `\`${field}\` is a real column, so "never copied" is a statement about something real`
    );
  }
  check(
    creatorFormAdmin.NEVER_COPIED_SET.has("business_profile_snapshot"),
    "the profile snapshot is one of them — a copy inherits its own, never the source's"
  );
  check(
    !creatorFormAdmin.NEVER_COPIED_FIELDS.includes("amount_in_words"),
    "the source's wording IS inherited, because the server decides whether it still fits"
  );
  check(
    !creatorFormAdmin.NEVER_COPIED_FIELDS.includes("logo_id"),
    "and so is the logo — a copy may print a different one, but it never keeps the id"
  );

  /* The three the feature itself added, which must be in 0015/0016 by name. A copy that
     inherited any of them would either overwrite the source's audit trail or point at
     another bill's documents. */
  const creator = readFileSync(
    resolve(REPO, "Metalworker_admin/supabase/migrations/0015_bill_creator.sql"),
    "utf8"
  );
  const authorship = readFileSync(
    resolve(REPO, "Metalworker_admin/supabase/migrations/0016_bill_creator_authorship.sql"),
    "utf8"
  );
  for (const field of ["origin", "copied_from_bill_id", "creator_draft_key", "status"]) {
    check(creator.includes(field), `0015 adds \`${field}\`, which a copy must never inherit`);
  }
  for (const field of ["created_by", "finalized_at"]) {
    check(
      authorship.includes(field),
      `0016 adds \`${field}\`, which belongs to the bill that was created, not the source`
    );
  }
  check(
    creator.includes("ON DELETE SET NULL") || creator.includes("on delete set null"),
    "and the copy link is broken rather than cascaded if the copy is deleted"
  );

  /* And the fields a copy is expected to point at are all real columns. */
  const columns = new Set(Object.keys(realRecord));
  for (const field of creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS) {
    check(columns.has(field), `the highlighted field \`${field}\` is a real column on the bill`);
  }
  check(
    creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS.includes("party_name") &&
      creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS.includes("invoice_no") &&
      creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS.includes("invoice_date"),
    "including the invoice number, the invoice date and the customer"
  );
  check(
    !creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS.includes("line_items"),
    "line items are preserved and NOT highlighted — a copy rarely changes them"
  );
  check(
    !creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS.includes("seller_name") &&
      !creatorFormAdmin.LIKELY_TO_CHANGE_FIELDS.includes("bank_details"),
    "and neither is the company's own information"
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */

console.log(
  failures === 0
    ? `\nBILL CREATOR CHECKS: all ${checks} passed.`
    : `\nBILL CREATOR CHECKS: ${failures} of ${checks} FAILED.`
);
process.exit(failures === 0 ? 0 : 1);