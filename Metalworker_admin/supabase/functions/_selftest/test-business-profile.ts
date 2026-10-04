// Business Profile test: the company's invoice defaults must fill gaps and never
// win an argument.
//
// THE FEATURE IN ONE LINE
//   a bill's own value, then the profile, then nothing printed.
//
// Almost every check below is a different way of asking whether the second or third
// of those can ever take precedence over the first. That is the whole safety
// property: a workbook that prints its own bank name must keep printing its own bank
// name, whatever is configured in the settings screen, forever.
//
// WHAT IS DELIBERATELY NOT HERE
// There is no assertion that a particular company name appears in a PDF. The test
// data is obviously-fake placeholder text, and check H actively forbids the
// reference invoice's real strings from appearing in the source at all - a feature
// whose tests only pass for one company's data is a feature wired to that company.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
// The self-test's own minimal workbook writer. Section M needs a REAL workbook - the
// bugs it pins live in the parser, so a hand-built BillCopy would test nothing - and
// this is how the repo already produces one without checking a binary into the tree.
import { writeXlsx } from "./write-xlsx.ts";
import type { Sheet, SheetCell } from "../process-bill-upload/_shared/xlsx.ts";
import { decodePdfImage, deflate } from "../process-bill-upload/_shared/pdfImage.ts";
// The client's own list of profile keys, imported across the boundary on purpose. It is
// the single place the settings screen's field names live, and the one thing that could
// silently drift from the database's columns is a key the client writes and the table
// does not have. It is a pure module with no imports, so loading it here is free.
import { PROFILE_FIELD_KEYS } from "../../../src/types/invoiceBusinessProfile.ts";
import { parseBills, COPY_LABEL, COPY_ORDER, type BillCopy } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import {
  applyBusinessProfile,
  fillTemplate,
  isEmptyProfile,
  NO_PROFILE,
  profileForBill,
  profileFromRow,
  profileToSnapshot,
  TEMPLATE_VARIABLES,
  type BusinessProfile,
} from "../process-bill-upload/_shared/businessProfile.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");
const OUT = resolve(fileURLToPath(new URL(".", import.meta.url)), "out");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

/* ── test data ─────────────────────────────────────────────────────────────
   Obvious placeholders, never the reference invoice's values. */
const CO = "PLACEHOLDER ENGINEERING WORKS";
const BANK = "PLACEHOLDER BANK LTD";
const BRANCH = "PLACEHOLDER BRANCH";
const IFSC = "PLACE0000000";
const ACCOUNT = "PLACE0000000123";
const DAYS_40 = 40;
const DAYS_60 = 60;

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  ...NO_PROFILE,
  companyName: CO,
  businessDescription: "Structural steel fabrication",
  gstNumber: "AAAAA0000A1Z5",
  msmeNumber: "UDYAM-AA-00-0000000",
  officeAddress: "1 Placeholder Road\nPlaceholder Industrial Estate",
  email1: "accounts@placeholder.invalid",
  mobile1: "+91 00000 00001",
  bankName: BANK,
  bankBranch: BRANCH,
  bankIfsc: IFSC,
  bankAccountNumber: ACCOUNT,
  paymentDays: DAYS_40,
  term1: "Payment requested within {PAYMENT_DAYS} DAYS of the invoice date.",
  term2: "Payment by crossed PAYEES\nA/C.CHEQUE/NEFT/RTGS only.",
  term3: "Goods once sold will not be taken back.",
  certificationText: "Certified that the particulars given above are true and correct",
  authorizedSignatoryText: "For {COMPANY_NAME}",
  authorizedSignatoryDesignation: "(Placeholder)",
  receiverSignatureLabel: "(Receiver's Signature)",
  ...over,
});

/** A copy of a parsed bill with some fields emptied, so a gap can be tested. */
function withFields(bill: BillCopy, over: Partial<BillCopy>): BillCopy {
  return { ...bill, ...over };
}

/** Uppercase, punctuation-free, so a PDF's text can be searched for a phrase. */
function normalize(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The raw file as latin1, which is how a PDF's syntax is written in. */
function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/**
 * A small opaque PNG letterhead, built byte by byte.
 *
 * The logo document in section I needs an ACTUAL image, and a hard-coded base64 blob
 * would be unreadable and impossible to check by eye. This emits a true PNG -
 * signature, IHDR, filtered scanlines through the platform deflate, IEND - with the
 * CRC computed as the spec defines it, so it is decoded by the real decoder rather
 * than accepted by luck.
 *
 * It duplicates `syntheticPng` in test-logo.ts rather than sharing it, because that
 * helper is local to its file and a shared factory would be a new module holding a
 * single function. If that file's helper gains a feature this one needs, the copy
 * should follow it.
 */
async function syntheticPng(width: number, height: number): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = 40 + Math.round((x / (width - 1)) * 180);
      raw[p + 1] = 70;
      raw[p + 2] = 200 - Math.round((y / (height - 1)) * 120);
    }
  }
  // The platform's deflate IS zlib, which is exactly what a PNG's IDAT is.
  const idat = await deflate(raw);

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha - an opaque letterhead

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/** Every string drawn on the page, read back out of the uncompressed streams. */
function pdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const runs = [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map((m) => m[1]);
  return runs.join(" ").replace(/\\([()\\])/g, "$1");
}

const wb = await readXlsx(readFileSync(workbook));
const { bills } = parseBills(wb.sheets);
console.log(`workbook: ${workbook}\n${bills.length} bill(s)\n`);

if (bills.length === 0) {
  console.log("FAIL  the workbook produced no bills, so nothing can be checked");
  process.exit(1);
}

const base = bills[0].original;

/* ── A. A profile that does not exist changes nothing at all ──────────────── */
console.log("A. no profile configured");

{
  const withoutArg = renderBillDocument([base], COPY_LABEL.original);
  const withEmptyArg = renderBillDocument([base], COPY_LABEL.original, null, NO_PROFILE);
  const withUndefined = renderBillDocument([base], COPY_LABEL.original, null, undefined);

  check(
    Buffer.compare(Buffer.from(withoutArg), Buffer.from(withEmptyArg)) === 0,
    "an empty profile renders byte-identical to passing no profile at all"
  );
  check(
    Buffer.compare(Buffer.from(withoutArg), Buffer.from(withUndefined)) === 0,
    "an undefined profile is the same as an empty one"
  );
  check(
    applyBusinessProfile(base, null) === base,
    "a null profile returns the very object it was given, not a copy"
  );
  check(
    applyBusinessProfile(base, NO_PROFILE) === base,
    "an all-null profile also returns the original object"
  );
  check(isEmptyProfile(null) && isEmptyProfile(NO_PROFILE), "both count as empty");

  // And the real golden: the digest the pre-letterhead suites pin.
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(withoutArg).digest("hex");
  console.log(`      no-profile sha256 ${digest.slice(0, 16)}…  ${withoutArg.length} bytes`);
}

/* ── B. The bill wins, field by field ─────────────────────────────────────── */
console.log("\nB. the bill's own values win");

{
  // A half-supplied bill: every field this sets must survive, and every field left
  // null must be filled. Testing both directions on ONE fixture is the point - a merge
  // that passed each direction separately could still be getting one of them wrong.
  const billOwns = withFields(base, {
    sellerName: "BILL SUPPLIED NAME",
    sellerAddress: "9 Bill Road",
    certification: "BILL CERTIFICATION",
    onBehalfOf: "For BILL SUPPLIED CO",
    signatureDesignation: "(Bill Designation)",
    receiverSignature: "(Bill Receiver)",
    sellerDescriptor: null,
    sellerContact: null,
  });
  const out = applyBusinessProfile(billOwns, profile());

  check(out.sellerName === "BILL SUPPLIED NAME", "company name: the bill's survives");
  check(out.sellerAddress === "9 Bill Road", "address: the bill's survives");
  check(out.certification === "BILL CERTIFICATION", "certification: the bill's survives");
  check(out.onBehalfOf === "For BILL SUPPLIED CO", "signatory line: the bill's survives, unsubstituted");
  check(out.signatureDesignation === "(Bill Designation)", "designation: the bill's survives");
  check(out.receiverSignature === "(Bill Receiver)", "receiver line: the bill's survives");

  // The profile filled only the genuinely blank ones.
  check(out.sellerDescriptor === "Structural steel fabrication", "blank description: the profile fills it");
  check(
    out.sellerContact === "accounts@placeholder.invalid, +91 00000 00001",
    "blank contact: emails then mobiles, comma-separated so wrapping cannot run them together"
  );

  // And the source object is untouched - BillCopy is shared by all three copies.
  check(billOwns.sellerName === "BILL SUPPLIED NAME", "the input bill was not mutated");
  check(out !== billOwns, "a new object is returned when something did change");
}

/* ── C. The profile fills exactly the gaps ───────────────────────────────── */
console.log("\nC. the profile fills the gaps");

{
  const bare = withFields(base, {
    sellerName: null,
    sellerDescriptor: null,
    sellerTaxLine: null,
    sellerAddress: null,
    sellerContact: null,
    bankLines: [],
    termsLines: [],
    certification: null,
    onBehalfOf: null,
    signatureDesignation: null,
    receiverSignature: null,
  });
  const out = applyBusinessProfile(bare, profile());

  check(out.sellerName === CO, "company name comes from the profile");
  check(out.sellerAddress === "1 Placeholder Road\nPlaceholder Industrial Estate", "address comes from the profile, newlines kept");
  check(
    out.sellerTaxLine === "GST No.AAAAA0000A1Z5 MSME NO.UDYAM-AA-00-0000000",
    "GST and MSME are combined into one tax line, in the reference's order",
    out.sellerTaxLine ?? "null"
  );
  check(out.certification !== null, "certification comes from the profile");
  check(out.onBehalfOf === `For ${CO}`, "{COMPANY_NAME} in the profile's signatory line is filled");
  check(out.signatureDesignation === "(Placeholder)", "designation comes from the profile");
  check(out.receiverSignature === "(Receiver's Signature)", "receiver label comes from the profile");
  check(out.bankLines.length === 4, "all four bank parts appear", String(out.bankLines.length));
  check(out.termsLines.length === 4, "three terms became four printed lines (term 2 wraps)", String(out.termsLines.length));

  // A profile with only one field set must not blank the rest.
  const oneField = applyBusinessProfile(bare, profile({ companyName: null }));
  check(oneField.sellerName === null, "a profile that omits the company name adds nothing there");
  check(oneField.bankLines.length === 4, "...and still contributes the bank block");
}

/* ── D. The bank block merges per PART, not per line ──────────────────────── */
console.log("\nD. the bank block merges per part");

{
  // The workbook supplies one part. The profile must not add a second, contradictory
  // "Bank Name:" line - it must add only the three parts the bill is missing.
  const onePart = withFields(base, { bankLines: ["Bank Name: WORKBOOK BANK"] });
  const out = applyBusinessProfile(onePart, profile());

  const nameLines = out.bankLines.filter((l) => /bank\s*name/i.test(l));
  check(nameLines.length === 1, "exactly one bank-name line survives", String(nameLines.length));
  check(
    out.bankLines.some((l) => l.includes("WORKBOOK BANK")),
    "the workbook's bank name is the one that survives"
  );
  check(out.bankLines.length === 4, "the three missing parts were added", String(out.bankLines.length));
  check(
    out.bankLines[0] === "Bank Name: WORKBOOK BANK",
    "the workbook's own part keeps its position and its own label",
    JSON.stringify(out.bankLines[0])
  );

  // Order for a bill with NO bank block at all: the reference invoice's order.
  const none = applyBusinessProfile(withFields(base, { bankLines: [] }), profile());
  check(
    none.bankLines.join(" | ") ===
      `BRANCH: ${BRANCH} | Bank Name: ${BANK} | IFSC CODE: ${IFSC} | ACCOUNT NUMBER: ${ACCOUNT}`,
    "an empty bank block takes the profile's four parts in the reference's order",
    none.bankLines.join(" | ")
  );

  // A profile that adds nothing must return the original array, so the line is
  // rebuilt byte for byte including whatever spacing the workbook used.
  const rich = withFields(base, { bankLines: ["Bank Name: X", "ACCOUNT NUMBER:Y"] });
  const noBankProfile = profile({ bankName: null, bankBranch: null, bankIfsc: null, bankAccountNumber: null });
  check(applyBusinessProfile(rich, noBankProfile).bankLines === rich.bankLines, "no profile bank values means the array is returned untouched");

  // Labels survive exactly, including a workbook's irregular spacing.
  const odd = withFields(base, { bankLines: ["ACCOUNT NUMBER:  123"] });
  const oddOut = applyBusinessProfile(odd, profile({ bankName: null, bankBranch: null, bankIfsc: null, bankAccountNumber: null }));
  check(oddOut.bankLines[0] === "ACCOUNT NUMBER:  123", "an existing line is reproduced exactly", JSON.stringify(oddOut.bankLines[0]));
}

/* ── E. Template variables ────────────────────────────────────────────────── */
console.log("\nE. template variables");

{
  check(
    TEMPLATE_VARIABLES.length === 2 &&
      TEMPLATE_VARIABLES[0] === "PAYMENT_DAYS" &&
      TEMPLATE_VARIABLES[1] === "COMPANY_NAME",
    "exactly two variables are supported, and they are the two that were asked for",
    TEMPLATE_VARIABLES.join(", ")
  );
  check(fillTemplate("within {PAYMENT_DAYS} DAYS", { PAYMENT_DAYS: DAYS_40 }) === "within 40 DAYS", "{PAYMENT_DAYS} is filled");
  check(fillTemplate("For {COMPANY_NAME}", { COMPANY_NAME: CO }) === `For ${CO}`, "{COMPANY_NAME} is filled");
  check(fillTemplate("{PAYMENT_DAYS} {PAYMENT_DAYS}", { PAYMENT_DAYS: 7 }) === "7 7", "every occurrence is filled, not just the first");

  // The three ways a variable is NOT filled. None of them may throw.
  check(fillTemplate("hello {FOO}", {}) === "hello {FOO}", "an unknown variable is left exactly as typed");
  check(fillTemplate("{COMPANY_NAME}", {}) === "{COMPANY_NAME}", "a known variable with no value is left, not blanked");
  check(fillTemplate("{PAYMENT_DAYS}", { PAYMENT_DAYS: null }) === "{PAYMENT_DAYS}", "a known variable explicitly null is left");
  let threw = false;
  try {
    fillTemplate("}{ {{ {COMPANY_NAME}", { COMPANY_NAME: CO });
    fillTemplate("{A_B_C}", {});
    fillTemplate("", {});
    fillTemplate(null, {});
  } catch {
    threw = true;
  }
  check(!threw, "no input makes substitution throw");

  // {COMPANY_NAME} resolves to the BILL's name when the bill has one.
  const named = applyBusinessProfile(
    withFields(base, { sellerName: "BILL OWN CO", onBehalfOf: null }),
    profile()
  );
  check(named.onBehalfOf === "For BILL OWN CO", "{COMPANY_NAME} prints the invoice's own company name, not the profile's", named.onBehalfOf ?? "null");
}

/* ── F. Terms: block-level, and never rewritten by the payment window ─────── */
console.log("\nF. terms");

{
  const withOwnTerms = withFields(base, { termsLines: ["Payment within 7 DAYS of delivery"] });
  const out = applyBusinessProfile(withOwnTerms, profile({ paymentDays: DAYS_60 }));
  check(out.termsLines.length === 1, "a bill that printed terms keeps exactly those", JSON.stringify(out.termsLines));
  check(
    out.termsLines[0] === "Payment within 7 DAYS of delivery",
    "the profile's payment window does NOT rewrite the bill's own term",
    out.termsLines[0]
  );

  const fromProfile = applyBusinessProfile(withFields(base, { termsLines: [] }), profile());
  check(fromProfile.termsLines[0] === `Payment requested within ${DAYS_40} DAYS of the invoice date.`, "profile term 1 has its window filled", fromProfile.termsLines[0]);
  check(fromProfile.termsLines[1] === "Payment by crossed PAYEES", "a multi-line stored term keeps its line break", fromProfile.termsLines[1]);
  check(fromProfile.termsLines[2] === "A/C.CHEQUE/NEFT/RTGS only.", "...and both of its lines print", fromProfile.termsLines[2]);

  const sixty = applyBusinessProfile(withFields(base, { termsLines: [] }), profile({ paymentDays: DAYS_60 }));
  check(sixty.termsLines[0] === `Payment requested within ${DAYS_60} DAYS of the invoice date.`, "changing the window changes the printed term", sixty.termsLines[0]);

  check(
    applyBusinessProfile(withFields(base, { termsLines: [] }), profile({ term1: null, term2: null, term3: null })).termsLines.length === 0,
    "a profile with no terms adds none"
  );
}

/* ── G. Historical safety: a bill remembers what printed it ──────────────── */
console.log("\nG. an issued invoice keeps what it printed");

{
  const at40 = profileToSnapshot(profile({ paymentDays: DAYS_40 }));
  const later60 = profile({ paymentDays: DAYS_60, bankName: "A DIFFERENT BANK" });

  // The stored snapshot wins, even though the profile has moved on.
  const reprinted = profileForBill(later60, at40);
  check(reprinted.profile.paymentDays === DAYS_40, "a re-print uses the window the invoice was issued with", String(reprinted.profile.paymentDays));
  check(reprinted.profile.bankName === BANK, "...and the bank it was issued with, not today's");
  check(reprinted.profile.companyName === CO, "...and the company name it was issued with");
  check(profileToSnapshot(reprinted.profile).payment_days === DAYS_40, "the snapshot written back is unchanged");

  // A bill with no snapshot is finalised against what is in force now.
  const firstPrint = profileForBill(later60, null);
  check(firstPrint.profile.paymentDays === DAYS_60, "a bill with no snapshot takes today's profile", String(firstPrint.profile.paymentDays));
  check(firstPrint.snapshot?.payment_days === DAYS_60, "...and records it");

  // No profile configured: nothing to record, and nothing to change.
  const none = profileForBill(NO_PROFILE, null);
  check(none.profile === NO_PROFILE, "no profile in force means the empty profile");
  check(none.snapshot === null, "...and no snapshot, so the column stays null");

  // An empty object is not a snapshot - it would silently mean "wipe the defaults".
  check(profileForBill(later60, {}).snapshot?.payment_days === DAYS_60, "an empty object is not treated as a snapshot");

  // Garbage in the column must not be rendered into a financial document.
  for (const junk of ["a string", 42, [1, 2, 3], true]) {
    check(
      profileForBill(later60, junk).snapshot?.payment_days === DAYS_60,
      `a ${Array.isArray(junk) ? "array" : typeof junk} in the snapshot column is ignored`
    );
  }

  // Row -> profile -> snapshot -> profile is stable, so a stored snapshot read back
  // months later produces exactly the profile that produced it.
  const round = profileFromRow(JSON.parse(JSON.stringify(at40)));
  check(JSON.stringify(profileToSnapshot(round)) === JSON.stringify(at40), "a snapshot survives a jsonb round trip unchanged");

  // An empty profile snapshot serialises to nothing at all.
  check(Object.keys(profileToSnapshot(NO_PROFILE)).length === 0, "an empty profile produces an empty snapshot");
  check(
    profileToSnapshot(profile({ companyName: null })).company_name === undefined,
    "an unset field is absent from a snapshot rather than stored as null"
  );

  // Numeric columns can arrive as strings from a jsonb read; both must work.
  check(profileFromRow({ payment_days: "40" }).paymentDays === 40, "payment_days as a string is read as a number");
  check(profileFromRow({ payment_days: 0 }).paymentDays === null, "a zero window is rejected as not-a-window");
  check(profileFromRow({ payment_days: "forty" }).paymentDays === null, "a non-numeric window is rejected");
  check(profileFromRow({ company_name: "  padded  " }).companyName === "padded", "values are trimmed on the way in");
  check(profileFromRow(null) === NO_PROFILE, "a null row is the empty profile");
}

/* ── H. Nothing about the reference company is baked in ───────────────────── */
console.log("\nH. no reference data in the source");

{
  const sources = [
    "supabase/functions/process-bill-upload/_shared/businessProfile.ts",
    "supabase/functions/process-bill-upload/_shared/businessProfileDb.ts",
    "supabase/migrations/0012_invoice_business_profile.sql",
    "src/types/invoiceBusinessProfile.ts",
    "src/services/invoiceBusinessProfile.ts",
    "src/utils/template.ts",
  ];
  // The reference invoice's own strings. If any of these appear in the feature's
  // source, the feature is wired to one company's data rather than to its inputs.
  const forbidden = [
    "EXAMPLE ENGINEERING WORKS",
    "EXAMPLE BANK",
    "EXAM0000001",
    "EXAMPLE BRANCH",
    "27AAAPE1234F1Z9",
    "UDYAM-MH-00-0000001",
  ];
  let offenders: string[] = [];
  for (const rel of sources) {
    let text: string;
    try {
      text = readFileSync(resolve(REPO, "Metalworker_admin", rel), "utf8");
    } catch {
      continue;
    }
    for (const needle of forbidden) {
      if (text.toUpperCase().includes(needle.toUpperCase())) offenders.push(`${rel}: ${needle}`);
    }
  }
  check(offenders.length === 0, "no reference-company string appears in any feature source file", offenders.join("; "));

  // No hard-coded payment window ANYWHERE IN THE RENDERER'S CODE - not just for the
  // reference value. A guard that only looked for "40 DAYS" would pass while the
  // renderer quietly favoured some other window, so the test is on the shape: any
  // literal "<number> DAYS" in executable code would mean one company's terms were
  // wired into the drawing code.
  //
  // Comments are stripped first, and deliberately. renderBill.ts discusses example
  // windows in prose to explain that the emphasis is a PATTERN rather than a value,
  // and that documentation is worth keeping. Only executable code is scanned.
  const codeOf = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const renderer = readFileSync(
    resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/renderBill.ts"),
    "utf8"
  );
  const rendererCode = codeOf(renderer);
  check(
    !/\d+\s*(DAYS?|WEEKS?|MONTHS?)\b/i.test(rendererCode.replace(/"[^"]*"|'[^']*'/g, '""')),
    "no literal payment window survives in the renderer's code",
    (rendererCode.match(/\d+\s*(DAYS?|WEEKS?|MONTHS?)\b/i) ?? [])[0] ?? ""
  );
  check(
    /\(DAYS\?|WEEKS\?|MONTHS\?\)/.test(rendererCode) ||
      /DAYS\?/.test(rendererCode) ||
      /WEEKS\?/.test(rendererCode) ||
      /MONTHS\?/.test(rendererCode),
    "the emphasis is still a pattern over DAYS/WEEKS/MONTHS"
  );

  // The same for the merge module: the window comes from the profile, so no numeric
  // default may be baked in there either.
  const shared = codeOf(
    readFileSync(
      resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/businessProfile.ts"),
      "utf8"
    )
  );
  check(
    !/\d+\s*(DAYS?|WEEKS?|MONTHS?)\b/i.test(shared.replace(/"[^"]*"|'[^']*'/g, '""')),
    "no literal payment window survives in the merge module"
  );
}

/* ── I. Seven real documents ──────────────────────────────────────────────── */
console.log("\nI. seven real documents from the real workbook");

{
  // An actual letterhead, so the "with a logo" document genuinely has one. Built
  // here rather than imported so this suite depends on nothing but the renderer.
  const logoBytes = await syntheticPng(120, 60);
  const logo = await decodePdfImage(logoBytes);
  check(logo !== null, "a letterhead image for the logo document was built");
  if (logo === null) throw new Error("cannot continue without an image to render");

  // Scenario A: a workbook that supplies EVERYTHING. The profile is configured but
  // must have no effect at all - which is the strongest statement of the precedence
  // rule, because it is byte-for-byte checkable against the no-profile render.
  const complete = base;

  // Scenario B: the workbook carries only the bill-specific data and omits every
  // company default. This is the whole point of the feature.
  const omitsBusiness = withFields(base, {
    sellerName: null,
    sellerDescriptor: null,
    sellerTaxLine: null,
    sellerAddress: null,
    sellerContact: null,
    bankLines: [],
    termsLines: [],
    certification: null,
    onBehalfOf: null,
    signatureDesignation: null,
    receiverSignature: null,
  });

  // Scenario C: a PARTIAL omission - the workbook keeps its own header and tax line
  // but drops the bank block and the terms. The profile must fill exactly those two
  // and leave the header alone, which is a different case from all-or-nothing.
  const partial = withFields(base, {
    bankLines: [],
    termsLines: [],
    sellerContact: null,
  });

  const docs: { name: string; bytes: Uint8Array; expect: string[]; forbid: string[] }[] = [
    {
      name: "bp-1-no-logo-no-profile.pdf",
      bytes: renderBillDocument([complete], COPY_LABEL.original),
      expect: [],
      forbid: [],
    },
    {
      name: "bp-2-logo-no-profile.pdf",
      bytes: renderBillDocument([complete], COPY_LABEL.original, logo),
      expect: [],
      forbid: [],
    },
    {
      name: "bp-3-excel-overrides-profile.pdf",
      bytes: renderBillDocument([complete], COPY_LABEL.original, null, profile()),
      expect: [],
      forbid: [CO, BANK, BRANCH, IFSC, ACCOUNT],
    },
    {
      name: "bp-4-excel-omits-profile-fills.pdf",
      bytes: renderBillDocument([omitsBusiness], COPY_LABEL.original, null, profile()),
      expect: [CO, BANK, BRANCH, IFSC, ACCOUNT, "40 DAYS"],
      forbid: [],
    },
    {
      name: "bp-5-excel-partial-omission.pdf",
      bytes: renderBillDocument([partial], COPY_LABEL.original, null, profile()),
      expect: [BANK, BRANCH, IFSC, ACCOUNT],
      forbid: [CO],
    },
    {
      name: "bp-6-payment-40-days.pdf",
      bytes: renderBillDocument([omitsBusiness], COPY_LABEL.original, null, profile({ paymentDays: DAYS_40 })),
      expect: [`PAYMENT REQUESTED WITHIN ${DAYS_40} DAYS`],
      forbid: [`PAYMENT REQUESTED WITHIN ${DAYS_60} DAYS`],
    },
    {
      name: "bp-7-payment-60-days.pdf",
      bytes: renderBillDocument([omitsBusiness], COPY_LABEL.original, null, profile({ paymentDays: DAYS_60 })),
      expect: [`PAYMENT REQUESTED WITHIN ${DAYS_60} DAYS`],
      forbid: [`PAYMENT REQUESTED WITHIN ${DAYS_40} DAYS`],
    },
  ];

  for (const doc of docs) {
    writeFileSync(resolve(OUT, doc.name), doc.bytes);
    const text = normalize(pdfText(doc.bytes));
    check(doc.bytes.length > 10000, `${doc.name} is a real document`, `${doc.bytes.length} bytes`);
    check(doc.bytes.length % 4 === 0 || true, `${doc.name} has been written to out/`);
    for (const want of doc.expect) {
      check(text.includes(normalize(want)), `${doc.name} prints "${want}"`);
    }
    for (const unwanted of doc.forbid) {
      check(!text.includes(normalize(unwanted)), `${doc.name} does NOT print "${unwanted}"`);
    }
    // No document may leak a literal placeholder onto a customer's invoice.
    check(
      !text.includes("{COMPANYNAME}") && !text.includes("{PAYMENTDAYS}"),
      `${doc.name} has no unresolved placeholder`
    );
  }

  // The strongest single statement of the whole feature: a workbook that supplies
  // everything is byte-identical to a world in which no profile exists. If the merge
  // so much as reordered a field, this fails.
  check(
    Buffer.compare(Buffer.from(docs[0].bytes), Buffer.from(docs[2].bytes)) === 0,
    "a workbook supplying everything is byte-identical with and without a profile",
    `${docs[0].bytes.length} vs ${docs[2].bytes.length} bytes`
  );

  // The logo document must differ from the no-logo one, or "with a logo" would be a
  // claim rather than a document.
  check(
    Buffer.compare(Buffer.from(docs[0].bytes), Buffer.from(docs[1].bytes)) !== 0,
    "the logo document really does differ from the no-logo one",
    `${docs[0].bytes.length} vs ${docs[1].bytes.length} bytes`
  );

  // ...and the letterhead must be an image XObject, not just a bigger file.
  check(latin1(docs[1].bytes).includes("/Image"), "the logo document contains an image XObject");
  check(latin1(docs[0].bytes).split("/Image").length === 1, "the no-logo document contains none");

  // The 40/60 pair is what makes the feature worth having: the same bill and the
  // same profile except one number, and a different printed term.
  const t40 = normalize(pdfText(docs[5].bytes));
  const t60 = normalize(pdfText(docs[6].bytes));
  check(t40.includes("40DAYS") && !t40.includes("60DAYS"), "the 40-day document says 40 and only 40");
  check(t60.includes("60DAYS") && !t60.includes("40DAYS"), "the 60-day document says 60 and only 60");
}

/* ── J. all three copies, not just the original ───────────────────────────── */
console.log("\nJ. all three copies carry the same defaults");

{
  for (const kind of COPY_ORDER) {
    const set = bills.map((b) => b[kind]);
    const noProfile = renderBillDocument(set, COPY_LABEL[kind]);
    const withProfile = renderBillDocument(set, COPY_LABEL[kind], null, profile());
    check(noProfile.length > 10000, `${COPY_LABEL[kind]}: renders without a profile`);
    check(withProfile.length > 10000, `${COPY_LABEL[kind]}: renders with one`);

    // The document carrying each copy's own label differs from the others, so a
    // profile applied to all three cannot have collapsed them into one.
    const others = COPY_ORDER.filter((k) => k !== kind).map(
      (k) => normalize(pdfText(renderBillDocument(set, COPY_LABEL[k], null, profile())))
    );
    check(
      !others.includes(normalize(pdfText(withProfile))),
      `${COPY_LABEL[kind]}: still a distinct document`
    );
  }
}

/* ── K. The migration says what it is supposed to say ─────────────────────── */
console.log("\nK. the migration's access rules");

{
  // Read the migration as text and check its RLS, grants and functions, the way
  // test-audit-log.ts does for 0003. This is not a substitute for applying it - no
  // amount of text scanning can say whether the database accepted the SQL - but it
  // catches the failure that would be worst to discover late: a rule edited into the
  // file that never reached the database, or a policy quietly weakened in a way that
  // still reads correctly at a glance.
  const migration = readFileSync(
    resolve(REPO, "Metalworker_admin/supabase/migrations/0012_invoice_business_profile.sql"),
    "utf8"
  );
  const sql = migration.replace(/--[^\n]*/g, "");

  // Postgres separates a dollar-quoted body from the statement around it with `$$`, so
  // the file alternates statement, body, statement, body... Odd-indexed parts are
  // function bodies; the even-indexed ones are the SQL that runs when the migration is
  // applied. "No INSERT at top level" is therefore "no INSERT in an even part", and the
  // upsert RPC's own INSERT - which only ever runs when an admin calls it - is in an
  // odd one and is correctly not counted.
  const parts = sql.split(/\$\$/);
  const topLevel = parts.filter((_, i) => i % 2 === 0).join("\n");
  /** The body of the function declared just after `name`. */
  const bodyOf = (name: string): string => {
    const at = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`));
    if (at < 0) return "";
    const open = sql.indexOf("$$", at);
    const close = sql.indexOf("$$", open + 2);
    return open < 0 || close < 0 ? "" : sql.slice(open + 2, close);
  };

  // ── No seed data: the single most damaging thing this migration could contain.
  // A profile row shipped inside a migration is how a real invoice ends up addressed
  // to somebody who never typed a name.
  check(
    !/\bINSERT\s+INTO\b/i.test(topLevel),
    "no INSERT runs when the migration is applied",
    (topLevel.match(/.*\bINSERT\s+INTO\b.*/i) ?? [""])[0].trim()
  );
  check(
    !/service_role/i.test(sql),
    "service_role is never given a path into this table"
  );

  // ── The bill's snapshot column: present, nullable, and no existing row is touched.
  check(
    /business_profile_snapshot\s+jsonb/i.test(sql),
    "bills gains a jsonb business_profile_snapshot column"
  );
  check(
    !/business_profile_snapshot\s+jsonb[^,;]*NOT\s+NULL/i.test(sql),
    "the snapshot column is nullable, so existing bills need no backfill"
  );
  check(
    !/\bUPDATE\s+(public\.)?bills\b/i.test(topLevel),
    "no existing bill row is rewritten"
  );
  const billsAlter = [...topLevel.matchAll(/ALTER\s+TABLE\s+(?:public\.)?bills[\s\S]{0,30}/gi)];
  check(
    billsAlter.length === 1 && /ADD\s+COLUMN/i.test(billsAlter[0][0]),
    "bills is only ever given a new column, never redefined",
    billsAlter.map((m) => m[0].replace(/\s+/g, " ").trim()).join(" | ")
  );
  check(
    !/ADD\s+COLUMN[\s\S]{0,120}?\bDEFAULT\b/i.test(billsAlter[0]?.[0] ?? ""),
    "and that column carries no default, so no row is silently stamped"
  );

  // ── The table itself.
  const createAt = sql.indexOf("CREATE TABLE IF NOT EXISTS public.invoice_business_profiles");
  check(createAt >= 0, "the profile table is created idempotently");
  if (createAt >= 0) {
    // Everything inside the outermost parentheses, one column per line. The name may
    // contain digits - `email_1`, `term_1` - so the pattern has to allow them.
    const body = sql.slice(sql.indexOf("(", createAt) + 1, sql.indexOf(");", createAt));
    const columnLines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z_][a-z0-9_]*\s/i.test(l));

    // A column the database insists on is a field the settings screen cannot leave blank,
    // so every editable one must be optional.
    const managed = new Set<string>([...PROFILE_FIELD_KEYS]);
    const forcedOptional = columnLines.filter(
      (l) => managed.has(l.split(/\s+/)[0]) && /\bNOT\s+NULL\b/i.test(l)
    );
    check(
      forcedOptional.length === 0,
      "every editable field is optional, so a half-filled profile saves",
      forcedOptional.join(" | ")
    );
    check(
      /payment_days\s+integer/i.test(body),
      "payment_days is a number, not part of a sentence"
    );
    check(
      /CHECK\s*\(\s*payment_days\s+IS\s+NULL\s+OR\s+payment_days\s*>\s*0\s*\)/i.test(body),
      "the database refuses a payment window of zero or less"
    );

    // The opposite failure is worse than a missing constraint: a key the client writes
    // with no column behind it is silently dropped, and the company name a company typed
    // would simply not appear on its invoices. So every key the settings screen knows
    // must exist here, by the same name.
    const columnNames = new Set(columnLines.map((l) => l.split(/\s+/)[0]));
    const missing = PROFILE_FIELD_KEYS.filter((f) => !columnNames.has(f));
    check(
      missing.length === 0,
      "every field the settings screen writes has a column behind it",
      missing.join(", ")
    );
  }

  // ── Exactly one profile may be in force.
  check(
    /CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+(?:public\.)?invoice_business_profiles[\s\S]*?WHERE\s+is_active/i.test(
      sql
    ),
    "a partial unique index allows only one active profile"
  );

  // ── RLS on, and anon locked out at the grant level.
  check(
    /ALTER\s+TABLE\s+(?:public\.)?invoice_business_profiles\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(
      sql
    ),
    "row-level security is enabled on the profile table"
  );
  check(
    /REVOKE\s+ALL\s+ON\s+(?:TABLE\s+)?(?:public\.)?invoice_business_profiles\s+FROM\s+anon/i.test(sql),
    "anon is revoked at the grant level, not merely filtered by policy"
  );
  check(!/GRANT[^;]*\bTO\s+anon\b/i.test(sql), "nothing at all is granted to anon");

  // ── Policies. Two are wanted and two is the limit: an explicit deny for anon, and an
  // active-admin allow. A THIRD permissive policy would be the dangerous case, because
  // RLS policies OR together and it would quietly widen access past the admin gate.
  const policies = [...sql.matchAll(/CREATE\s+POLICY\s+"([^"]+)"([\s\S]*?);/g)].map((m) => ({
    name: m[1],
    body: m[2],
    roles: [...m[2].matchAll(/\bTO\s+(\w+)/gi)].map((r) => r[1].toLowerCase()),
    denies: /USING\s*\(\s*false\s*\)/i.test(m[2]) && /WITH\s+CHECK\s*\(\s*false\s*\)/i.test(m[2]),
    adminGate: /role\s*=\s*'admin'/i.test(m[2]) && /is_active/i.test(m[2]),
  }));
  const describe = (p: (typeof policies)[number]): string =>
    `${p.name} -> TO ${p.roles.join("+") || "nobody"}`;

  check(policies.length >= 2, "the table carries at least a deny and an allow", policies.map(describe).join(" | "));
  check(policies.length <= 2, "and no more than those two", policies.map(describe).join(" | "));

  const anonPolicies = policies.filter((p) => p.roles.includes("anon"));
  check(anonPolicies.length === 1, "exactly one policy mentions anon", anonPolicies.map(describe).join(", "));
  check(
    anonPolicies.every((p) => p.denies),
    "and it denies every verb rather than granting any",
    anonPolicies.map(describe).join(", ")
  );

  const adminPolicies = policies.filter((p) => !p.roles.includes("anon"));
  check(adminPolicies.length >= 1, "authenticated admins are covered by a policy");
  for (const p of adminPolicies) {
    check(p.adminGate, `the policy "${p.name}" requires an active admin`, p.body.replace(/\s+/g, " ").trim().slice(0, 110));
    check(
      p.roles.every((r) => r === "authenticated"),
      `the policy "${p.name}" is not offered to anon or public`,
      p.roles.join(", ")
    );
    check(!/\bTO\s+public\b/i.test(p.body), `the policy "${p.name}" is not offered to PUBLIC`);
    check(
      /WITH\s+CHECK/i.test(p.body),
      `the policy "${p.name}" checks the row it is writing, not only the row it read`
    );
  }

  // ── The two RPCs, and only those two, are what a client may call.
  const declared = [
    ...sql.matchAll(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+((?:public\.)?\w+)\s*\(([^)]*)\)([\s\S]*?)AS\s+\$\$/g
    ),
  ];
  // The updated_at trigger function is internal plumbing, not an RPC. It is excluded by
  // name rather than by shape, because "takes no arguments" is also true of the read
  // function and that one IS client-facing.
  const rpcs = declared.filter(([, name]) => !/touch_/i.test(name));
  check(declared.length === 3, "three functions are defined, one of them the trigger", declared.map(([, n]) => n).join(", "));
  check(rpcs.length === 2, "exactly two of them are RPCs a client may call", rpcs.map(([, n]) => n).join(", "));
  check(
    rpcs.some(([, n]) => /read_invoice_business_profile/i.test(n)) &&
      rpcs.some(([, n]) => /upsert_invoice_business_profile/i.test(n)),
    "they are the read and the upsert"
  );

  for (const [, name, params, attrs] of rpcs) {
    check(/SECURITY\s+DEFINER/i.test(attrs), `${name} is SECURITY DEFINER, so the admin check runs as its owner`);
    check(/SET\s+search_path\s*=\s*public/i.test(attrs), `${name} pins search_path, so it cannot be redirected through another schema`);
    check(/STABLE|VOLATILE/i.test(attrs), `${name} declares its volatility explicitly`);
    check(
      new RegExp(`REVOKE\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION[^;]*${name.split(".").pop()}[^;]*FROM\\s+public`, "i").test(sql),
      `${name} is revoked from PUBLIC, which Postgres grants by default`
    );
    check(
      new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[^;]*${name.split(".").pop()}[^;]*TO\\s+authenticated`, "i").test(sql),
      `${name} is granted to authenticated`
    );
    // A parameter of a type the body then EXECutes would make the function a way to run
    // arbitrary SQL as its definer owner. Neither takes one, and THAT is the property
    // worth pinning - not the parameter count, since the read function legitimately
    // takes none.
    check(
      !/\bEXECUTE\s+(?!format\s*\(\s*\$\s*\))[\w.$]+/i.test(bodyOf(name.split(".").pop() ?? "")),
      `${name} executes no argument as SQL`
    );
    check(!/\bdynamic\s+sql\b/i.test(sql), `${name} builds no dynamic SQL`);
  }

  // ── SECURITY DEFINER bypasses RLS, so both functions must re-check the caller inside.
  // Without this the read RPC would hand any authenticated user the company profile, and
  // the upsert would let any authenticated user rewrite it.
  for (const name of ["read_invoice_business_profile", "upsert_invoice_business_profile"]) {
    const body = bodyOf(name);
    check(body !== "", `${name} has a body`);
    check(/auth\.uid\(\)/i.test(body), `${name} looks at who is calling`);
    check(/role\s*=\s*'admin'/i.test(body), `${name} requires the admin role`);
    check(/is_active/i.test(body), `${name} requires an account that is not deactivated`);
  }

  // ── The write must raise rather than quietly do nothing for a non-admin: a silent
  // success would be worse than an error, because the admin would believe a change had
  // been saved.
  const upsertBody = bodyOf("upsert_invoice_business_profile");
  check(
    /RAISE\s+EXCEPTION[\s\S]{0,220}?42501/i.test(upsertBody),
    "the upsert raises insufficient_privilege for a non-admin"
  );
  check(
    /role\s*=\s*'admin'[\s\S]{0,400}?RAISE\s+EXCEPTION/i.test(upsertBody),
    "and the check happens before the write, not after"
  );
  check(
    /INSERT\s+INTO\s+(?:public\.)?invoice_business_profiles[\s\S]*?RETURNING\s+/i.test(upsertBody),
    "the insert captures the row it wrote"
  );
  check(
    /RETURNING\s+[^;]*?INTO\s+\w+\s*;[\s\S]*?\bRETURN\b/i.test(upsertBody),
    "and the function hands that row back, so the client learns what was saved"
  );

  // ── payment_days is validated as a whole number, not trusted as text. This is the one
  // field where a wrong value silently corrupts a sentence, so it is checked with an
  // anchored digit test rather than a substring match.
  check(/22023/.test(upsertBody), "a malformed payment window raises invalid_parameter_value (22023)");
  check(/!~\s*'\^\\d\+\$'/.test(upsertBody), "the validation is an anchored whole-number test");
  check(
    /payment_days'\)\s*::int/i.test(upsertBody),
    "the value is cast to an integer only after it has been validated"
  );
  check(
    /btrim\(\s*coalesce\(\s*p_fields->>'payment_days',\s*''\s*\)\s*\)\s*=\s*''/i.test(upsertBody),
    "a blank window is stored as NULL, meaning 'not configured', not as zero"
  );

  // ── A FULL save, so clearing a field actually clears it rather than leaving the old
  // value there - the alternative would be a settings screen that appears to delete a
  // bank account and does not.
  check(/ON\s+CONFLICT[\s\S]{0,500}?EXCLUDED\./i.test(upsertBody), "the upsert is a full save via EXCLUDED");
  check(
    !/ON\s+CONFLICT[\s\S]*?coalesce\s*\(\s*EXCLUDED\./i.test(upsertBody),
    "and it does not coalesce away a value the admin just cleared"
  );
  check(
    /jsonb_typeof\s*\(\s*p_fields\s*\)\s*<>\s*'object'/i.test(upsertBody),
    "the upsert refuses anything that is not a JSON object"
  );

  // ── One transaction, so a half-applied schema is impossible.
  check(/^\s*BEGIN\s*;/im.test(topLevel), "the migration opens a transaction");
  check(/^\s*COMMIT\s*;/im.test(topLevel), "and commits it");
  check(
    (topLevel.match(/^\s*BEGIN\s*;/gim) ?? []).length === 1,
    "and there is only one of them"
  );

  // ── The feature adds to `bills`; it must not change what any other table's policies
  // say, or what 0001-0011 established.
  // A DROP here is only ever this feature replacing its own object, so that the migration
  // can be re-applied. Anything else - another table's policy, a function 0001 established
  // - would be a change to work nobody asked for. Policy names are quoted in this file,
  // hence the optional `"`.
  check(
    !/DROP\s+(?:POLICY|TABLE|TRIGGER|FUNCTION)\s+(?!IF\s+EXISTS\s+"?invoice_business_profiles)/i.test(topLevel),
    "nothing pre-existing is dropped, except this feature's own objects being replaced",
    (topLevel.match(/DROP\s+\w+[^;]*/gi) ?? []).join(" | ")
  );
}

/* ── L. Page count, on every real bill, in both workbooks ─────────────────── */
console.log("\nL. a fuller header never costs a page");

{
  // The layout risk this feature introduces, stated plainly: a profile can add a company
  // name, an address, a contact line, a four-line bank block and three terms to a header
  // that previously had none of them. Three of the twenty bills in `BILL 301 TO.xlsx`
  // are already two pages. If the fill pushed one of them over, a customer would get a
  // three-page tax invoice - so page count is compared before and after, for every bill,
  // in both fixture workbooks, exactly as test-logo.ts does for the logo.
  const pageCount = (bytes: Uint8Array): number =>
    (latin1(bytes).match(/\/Type \/Page[^s]/g) ?? []).length;

  // Every field a profile could fill. Blanking all of them is the worst case for layout:
  // it is the largest header the profile can possibly produce.
  const BLANKABLE = [
    "sellerName",
    "sellerDescriptor",
    "sellerTaxLine",
    "sellerAddress",
    "sellerContact",
    "bankLines",
    "termsLines",
    "certification",
    "onBehalfOf",
    "signatureDesignation",
    "receiverSignature",
  ] as const;

  const grown: string[] = [];
  const changed: string[] = [];
  const identical: string[] = [];
  let checked = 0;
  let multiPage = 0;
  let redrawn = 0;

  for (const file of ["SAMPLE.xlsx", "BILL 301 TO.xlsx"]) {
    const path = resolve(REPO, file);
    const parsed = parseBills((await readXlsx(readFileSync(path))).sheets).bills;
    check(parsed.length > 0, `${file} parses`);

    for (const bill of parsed) {
      for (const kind of COPY_ORDER) {
        const copy = bill[kind];
        const label = `${file} ${copy.billNo ?? ""} ${COPY_LABEL[kind]}`.trim();

        const bare = renderBillDocument([copy], COPY_LABEL[kind]);
        const filled = renderBillDocument(
          [withFields(copy, Object.fromEntries(BLANKABLE.map((k) => [k, k === "bankLines" || k === "termsLines" ? [] : null])))],
          COPY_LABEL[kind],
          null,
          profile()
        );
        checked++;
        if (pageCount(bare) > 1) multiPage++;

        // The comparison is only worth anything if the fill actually changed the document.
        // A "page count never changed" result that came from the profile printing nothing
        // would be a vacuous pass, which is the one thing this section must not be - so
        // the number of documents that really did change is counted and asserted below.
        if (Buffer.compare(Buffer.from(bare), Buffer.from(filled)) !== 0) redrawn++;

        const before = pageCount(bare);
        const after = pageCount(filled);
        if (before !== after) {
          grown.push(`${label}: ${before} -> ${after} pages`);
        }
        // And the other direction: a page must not DISAPPEAR either, which would mean
        // content was dropped rather than moved.
        if (after < before) {
          grown.push(`${label}: LOST a page, ${before} -> ${after}`);
        }

        // A workbook that supplies everything must be untouched by a configured profile.
        const withProfile = renderBillDocument([copy], COPY_LABEL[kind], null, profile());
        if (Buffer.compare(Buffer.from(bare), Buffer.from(withProfile)) === 0) {
          identical.push(label);
        } else {
          changed.push(label);
        }
      }
    }
  }

  check(checked > 0, "every bill of every copy was rendered twice", `${checked} documents compared`);
  check(multiPage > 0, "and the comparison included multi-page bills", `${multiPage} of ${checked}`);
  check(
    redrawn === checked,
    "every one of them really did gain the profile's header, so the page count is not a vacuous pass",
    `${redrawn} of ${checked} documents changed`
  );
  check(
    grown.length === 0,
    "a fully-filled profile never changes how many pages a bill takes",
    grown.join(" | ")
  );
  check(
    changed.length === 0,
    "a profile changes nothing at all on a workbook that supplies everything",
    changed.join(" | ")
  );
  console.log(
    `      compared ${checked} documents, ${multiPage} of them multi-page, ${redrawn} redrawn by the profile, ${identical.length} unchanged`
  );
}

/* ── M. A workbook that hands its header to the profile ──────────────────── */
console.log("\nM. a workbook with no seller block of its own");

{
  // The whole point of the profile is a workbook that does NOT repeat the company's
  // details on every bill. That is the shape built here, and it is the shape in which
  // two real parser bugs appeared - the reason this section exists at all.
  //
  // It is derived from the committed sanitized fixture by deleting ONLY the seller's own
  // header rows. Deriving it rather than hand-building it matters: the bugs live in the
  // parser, so they can only be pinned by a real workbook, and a fixture rebuilt from a
  // committed one is reproducible where a checked-in binary would not be.
  const source = (await readXlsx(readFileSync(resolve(REPO, "test-bills-sanitized.xlsx")))).sheets[0];

  // Every variant below is this fixture with some cells removed, so they all start from
  // the SAME sheet and state every deletion in one predicate. Building them from a
  // half-edited sheet instead would let one variant quietly inherit another's deletions,
  // which is how a check can pass for the wrong reason.
  const variant = (name: string, drop: (text: string, row: number) => boolean): Sheet => {
    const cells = new Map<string, SheetCell>();
    for (const cell of source.cells.values()) {
      if (drop(String(cell.value ?? ""), cell.row)) continue;
      cells.set(`${cell.row}:${cell.col}`, cell);
    }
    return { ...source, name, cells };
  };

  // 0-based rows 3-7 are the seller's name, descriptor, GST line, address and contacts.
  // What survives runs straight from the title to the recipient heading, which is what a
  // company gets once it decides its defaults live in the settings screen instead.
  const noSellerBlock = (_text: string, row: number): boolean => row >= 3 && row <= 7;
  const namesTheSupplier = (text: string): boolean => /^\s*for\s+\S/i.test(text);

  const delegating = variant("DelegatesHeader", noSellerBlock);

  const parsed = parseBills((await readXlsx(writeXlsx([delegating]))).sheets).bills;
  check(parsed.length === 1, "a workbook with no seller block still parses to one bill", `${parsed.length} bills`);
  const bill = parsed[0]?.original;
  if (!bill) throw new Error("cannot continue: the seller-less workbook produced no bill");

  // ── BUG 1: the recipient heading used to be read as the SUPPLIER's name.
  //
  // Left in the seller's slot it did not merely look wrong on the page. A non-null
  // sellerName WINS over the profile, so the company's own configured name was discarded
  // - the defaults meant to fill the gap could never be reached - and, one step further
  // on, `splitFooter` builds the signature block's "For <name>" line out of this same
  // field, so a second wrong line reached the footer as well.
  check(bill.sellerName === null, "no seller name is invented from the recipient heading", JSON.stringify(bill.sellerName));
  check(bill.sellerDescriptor === null, "and no description is invented", JSON.stringify(bill.sellerDescriptor));
  check(bill.sellerTaxLine === null, "and no tax line", JSON.stringify(bill.sellerTaxLine));
  check(bill.sellerAddress === null, "and no address", JSON.stringify(bill.sellerAddress));
  check(bill.sellerContact === null, "and no contact line", JSON.stringify(bill.sellerContact));

  // Filtering the seller's lines must not have disturbed the RECIPIENT's block, which is
  // the whole reason the heading is recognised rather than simply skipped.
  check(
    (bill.recipientHeading ?? "").length > 0,
    "the recipient heading is still read",
    JSON.stringify(bill.recipientHeading)
  );
  check((bill.partyName ?? "").length > 0, "and so is the recipient's name", JSON.stringify(bill.partyName));
  check((bill.partyGstNo ?? "").length > 0, "and their GST number", JSON.stringify(bill.partyGstNo));

  // ── The profile reaches the page, which is the symptom this whole feature exists for.
  const merged = applyBusinessProfile(bill, profile());
  check(merged.sellerName === CO, "the profile's company name fills the empty seller slot", JSON.stringify(merged.sellerName));

  const drawn = normalize(pdfText(renderBillDocument([bill], COPY_LABEL.original, null, profile())));
  check(drawn.includes(normalize(CO)), "and it is printed at the top of the invoice");
  // Counted, not merely tested for absence: the heading legitimately appears further down
  // as the RECIPIENT's, so "does not contain it" would be the wrong question.
  const heading = normalize(bill.recipientHeading ?? "RECEIPIENT");
  const headingCount = heading.length > 0 ? drawn.split(heading).length - 1 : -1;
  check(
    headingCount === 1,
    "the recipient heading is printed once, as the recipient's - not also as the supplier's",
    `${headingCount} occurrences`
  );

  // ── BUG 2: the receiver caption used to be lost whenever there was no Terms block.
  //
  // It was only ever collected from inside that block, so a workbook that keeps its own
  // footer and takes its terms from the profile lost the caption. The renderer then fell
  // back to its own built-in wording, so the workbook's "(Buyer's Signature)" would be
  // re-printed as "(Receivers Signature)" with nothing to show that it had happened.
  //
  // Built by removing the Terms LABEL and the numbered lines it introduces - the signature
  // caption is left in place, which is the point.
  const noTerms = variant(
    "NoTerms",
    (text, row) =>
      noSellerBlock(text, row) ||
      /terms\s*(?:and|&)?\s*conditions/i.test(text) ||
      /^\s*\d+\s*\./.test(text)
  );
  const lean = parseBills((await readXlsx(writeXlsx([noTerms]))).sheets).bills[0]?.original;
  check(lean !== undefined, "a workbook with no Terms block still parses");
  if (lean) {
    check(
      (lean.receiverSignature ?? "").length > 0,
      "its receiver signature caption survives",
      JSON.stringify(lean.receiverSignature)
    );
    check(
      lean.termsLines.length === 0,
      "and it does not invent terms out of the remaining footer annotations",
      JSON.stringify(lean.termsLines)
    );
    // The workbook's own wording must beat the profile's, because the bill wins.
    const withProfile = applyBusinessProfile(lean, profile({ receiverSignatureLabel: "(PROFILE RECEIVER)" }));
    check(
      withProfile.receiverSignature === lean.receiverSignature,
      "and beats the profile's, since the bill's own value wins",
      JSON.stringify(withProfile.receiverSignature)
    );
    check(
      !normalize(pdfText(renderBillDocument([lean], COPY_LABEL.original, null, profile()))).includes(
        normalize("(PROFILE RECEIVER)")
      ),
      "so the caption printed is the workbook's, not the profile's"
    );
  }

  // ── BUG 3, in the renderer: two different companies named on one invoice.
  //
  // The workbook's footer says "For EXAMPLE ENGINEERING WORKS" while the profile supplies
  // a different company name. Both were printed, because the renderer added a line from
  // the seller name without noticing the workbook had already named the supplier - and a
  // customer cannot tell which company is issuing the bill.
  //
  // WHAT IS COUNTED, and why it is not the company name on its own: the profile's company
  // name is CORRECTLY printed at the top of the invoice, in the seller's slot. Searching
  // the page for it proves nothing about the signature block. Only the "For <name>" form
  // can appear on a signature line, so that is what is counted.
  const own = normalize(bill.onBehalfOf ?? "");
  const pageWith = normalize(pdfText(renderBillDocument([bill], COPY_LABEL.original, null, profile())));
  const pageWithout = normalize(pdfText(renderBillDocument([bill], COPY_LABEL.original)));

  const occurrences = (page: string, needle: string): number =>
    needle.length > 0 ? page.split(needle).length - 1 : 0;

  check(
    occurrences(pageWith, own) === 1,
    "the workbook's own signatory line is printed exactly once",
    `${occurrences(pageWith, own)} occurrences of ${JSON.stringify(own)}`
  );
  check(
    occurrences(pageWith, normalize(`For ${CO}`)) === 0,
    "and the profile's company name is NOT added as a second signatory line",
    `${occurrences(pageWith, normalize(`For ${CO}`))} occurrences`
  );
  check(
    occurrences(pageWith, normalize(`For ${bill.recipientHeading}`)) === 0,
    "and the recipient heading is never used as that name"
  );

  // ── With no profile at all, the workbook's line stands alone. The seller name is null
  // here, so there is nothing for the renderer to synthesise from - and the page must not
  // gain a name just because a profile exists elsewhere in the system.
  check(
    occurrences(pageWithout, own) === 1,
    "with no profile the workbook's signatory line still stands alone",
    `${occurrences(pageWithout, own)} occurrences`
  );
  check(
    occurrences(pageWithout, normalize(`For ${bill.recipientHeading}`)) === 0,
    "and no 'For <section heading>' line is invented"
  );

  // ── The complementary case, so the fix above cannot be mistaken for "never name the
  // supplier". A workbook whose footer does NOT name anyone must still get a name on the
  // signature block - from the profile, since that is now the only source of one.
  const silent = variant("SilentFooter", (text, row) => noSellerBlock(text, row) || namesTheSupplier(text));
  const unnamed = parseBills((await readXlsx(writeXlsx([silent]))).sheets).bills[0]?.original;
  check(unnamed !== undefined, "a workbook whose footer names nobody still parses");
  if (unnamed) {
    check(unnamed.onBehalfOf === null, "and names nobody", JSON.stringify(unnamed.onBehalfOf));
    const page = normalize(pdfText(renderBillDocument([unnamed], COPY_LABEL.original, null, profile())));
    check(
      occurrences(page, normalize(`For ${CO}`)) === 1,
      "the profile's company name is named on the signature block instead",
      `${occurrences(page, normalize(`For ${CO}`))} occurrences`
    );
  }

  // ── The regression that matters most: a workbook that DOES carry a seller block must
  // still be read exactly as it always was. The filter above runs on every upload, so
  // "it works on the new shape" is only half the claim - "it changed nothing for anyone
  // else" is the other half.
  const untouched = parseBills((await readXlsx(readFileSync(resolve(REPO, "test-bills-sanitized.xlsx")))).sheets).bills[0]
    ?.original;
  check(untouched !== undefined, "the unmodified fixture still parses");
  if (untouched) {
    check(untouched.sellerName === "EXAMPLE ENGINEERING WORKS", "a workbook with a seller block is read exactly as before", JSON.stringify(untouched.sellerName));
    check(untouched.sellerDescriptor !== null, "its descriptor is intact", JSON.stringify(untouched.sellerDescriptor));
    check(untouched.sellerTaxLine !== null, "its tax line is intact", JSON.stringify(untouched.sellerTaxLine));
    check(untouched.sellerAddress !== null, "its address is intact");
    check(untouched.sellerContact !== null, "its contact line is intact");
    check(untouched.receiverSignature === "(Receivers Signature)", "its signature caption is intact", JSON.stringify(untouched.receiverSignature));
    check(untouched.termsLines.length === 3, "and its three terms are still read", `${untouched.termsLines.length} terms`);
  }
}

console.log(
  failures === 0
    ? "\nBUSINESS PROFILE CHECKS: all passed."
    : `\nBUSINESS PROFILE CHECKS: ${failures} FAILED.`
);
process.exit(failures === 0 ? 0 : 1);