// Acceptance test for the PER-BILL model.
//
// The bug this guards against: one workbook-level PDF containing every invoice,
// with every bill pointing at it. So the checks here are about ISOLATION:
//
//   * 20 sheets must become 20 bills, not 60 and not 1
//   * the workbook must classify as 12 WITH METAL + 8 LABOUR JOB, read from
//     `job_kind` and never from a sheet name
//   * each bill's own three documents must contain ONLY that invoice
//   * no two bills may share a document path
//   * the display label must never be the raw stored token
//
// Everything is derived from the parse and from the renderer's own output, so the
// test is checking behaviour rather than restating a fixture.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, safeBillToken, COPY_LABEL, COPY_ORDER } from "../process-bill-upload/_shared/parseBill.ts";
import { formatJobKind } from "../process-bill-upload/_shared/formatJobKind.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const wb = await readXlsx(readFileSync(workbook));
const { bills, skipped } = parseBills(wb.sheets);
console.log(`workbook: ${workbook}\n${bills.length} bill(s) parsed, ${skipped.length} skipped\n`);

// ---- 1. one worksheet is one bill ------------------------------------------
check(skipped.length === 0, "no sheet was skipped", `${skipped.length} skipped`);
check(
  bills.length === wb.sheets.length,
  "one bill per worksheet — the three copies are NOT three bills",
  `${bills.length} bills from ${wb.sheets.length} sheets`
);

// ---- 2. mixed classification, from job_kind only ---------------------------
const withMetal = bills.filter((b) => formatJobKind(b.original.jobKind) === "WITH METAL");
const labour = bills.filter((b) => formatJobKind(b.original.jobKind) === "LABOUR JOB");
const other = bills.filter(
  (b) => !["WITH METAL", "LABOUR JOB"].includes(formatJobKind(b.original.jobKind) ?? "")
);
console.log(`  WITH METAL: ${withMetal.map((b) => b.sheetName).join(", ")}`);
console.log(`  LABOUR JOB: ${labour.map((b) => b.sheetName).join(", ")}`);
console.log(`  OTHER:      ${other.map((b) => `${b.sheetName}=${b.original.jobKind}`).join(", ") || "(none)"}`);

check(withMetal.length === 12, "12 WITH METAL bills", String(withMetal.length));
check(labour.length === 8, "8 LABOUR JOB bills", String(labour.length));
check(
  withMetal.length + labour.length + other.length === bills.length,
  "every bill is classified — none silently dropped",
  `${other.length} unrecognised`
);

// The classification must not be derivable from the sheet name: if it were, the
// "L" suffix would be doing the work. Assert the labour ones really are the L
// sheets AND that the value came from the column, not from the name.
check(
  labour.every((b) => /L$/i.test(b.sheetName.trim())),
  "labour bills are the L-suffixed sheets (matches the source, not inferred)",
  labour.map((b) => b.sheetName).join(", ")
);
check(
  bills.every((b) => b.original.jobKind !== null && String(b.original.jobKind).trim() !== ""),
  "every bill's classification came from the workbook's own job_kind column"
);

// ---- 3. per-bill document paths are unique and human-readable ---------------
const paths: string[] = [];
for (const b of bills) {
  const token = safeBillToken(b.original.invoiceNo, b.sheetName);
  for (const copy of COPY_ORDER) {
    // The layout the edge function builds, reproduced here so the naming rule is
    // tested rather than assumed.
    paths.push(`<upload>/<bill>_${token}_${copy}.pdf`);
  }
}
const distinctTokens = new Set(bills.map((b) => safeBillToken(b.original.invoiceNo, b.sheetName)));
check(
  distinctTokens.size === bills.length,
  "every bill gets a distinct filename token",
  `${distinctTokens.size} tokens for ${bills.length} bills`
);
check(
  distinctTokens.size * 3 === paths.length,
  "20 bills x 3 copies = 60 per-bill documents",
  `${paths.length} paths`
);
check(
  [...distinctTokens].every((t) => /^[\w.-]+$/.test(t)),
  "no token contains a character that is unsafe in a path",
  [...distinctTokens].filter((t) => !/^[\w.-]+$/.test(t)).join(", ") || "all safe"
);
check(
  [...distinctTokens].slice(0, 3).join(", ") ===
    "SEW_301_2026-27, SEW_302_2026-27, SEW_303_2026-27",
  "tokens are the invoice number, human-readable, hyphen preserved",
  [...distinctTokens].slice(0, 3).join(", ")
);

// ---- 4. EACH DOCUMENT CONTAINS ONLY ITS OWN INVOICE -------------------------
// The decisive check. Render one bill at a time, exactly as the function does,
// and assert no other invoice's number appears in it.
for (const copy of COPY_ORDER) {
  let contaminated = 0;
  let checked = 0;
  for (const b of bills) {
    const bytes = renderBillDocument([b[copy]], COPY_LABEL[copy]);
    const raw = new TextDecoder("latin1").decode(bytes);
    checked++;

    const own = b.original.invoiceNo ?? "";
    if (own && !raw.includes(`(${own})`)) {
      check(false, `${COPY_LABEL[copy]}: ${own} missing from its own document`);
      contaminated++;
    }
    for (const other2 of bills) {
      const no = other2.original.invoiceNo ?? "";
      if (!no || no === own) continue;
      if (raw.includes(`(${no})`)) {
        if (contaminated < 3) {
          check(false, `${COPY_LABEL[copy]}: ${own}'s document also contains ${no}`);
        }
        contaminated++;
      }
    }
    // A single-invoice document may still need two A4 pages: this workbook has
    // invoices with ten line items, and at a readable font those do not fit on
    // one sheet. The requirement allows that, so what is checked is that it is
    // THIS bill's content and nothing else — no sibling invoice number anywhere
    // above, and the table header repeated so page two is still readable.
    const pages = (raw.match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) ?? []).length;
    if (pages < 1 || pages > 2) {
      check(false, `${COPY_LABEL[copy]}: ${own} rendered ${pages} pages, expected 1-2`);
      contaminated++;
    } else if (pages > 1) {
      const headers = (raw.match(/\(DESCRIPTION\)/g) ?? []).length;
      if (headers !== pages) {
        check(false, `${COPY_LABEL[copy]}: ${own} spans ${pages} pages but repeats the header ${headers}x`);
        contaminated++;
      }
    }
    // And the classification must be on it, normalized.
    const label = formatJobKind(b.original.jobKind);
    if (label && !raw.includes(`(${label})`)) {
      check(false, `${COPY_LABEL[copy]}: ${own} is missing "${label}"`);
      contaminated++;
    }
    if (raw.includes(`(${b.original.jobKind ?? "@@none@@"})`) && b.original.jobKind !== label) {
      check(false, `${COPY_LABEL[copy]}: ${own} shows the raw token ${b.original.jobKind}`);
      contaminated++;
    }
  }
  check(
    contaminated === 0,
    `${COPY_LABEL[copy]}: all ${checked} single-invoice documents are isolated`,
    `${contaminated} problem(s)`
  );
}

// ---- 5. the aggregate is still available, and is separate -------------------
// "Download the whole workbook" remains a real capability, but it must be a
// different document from any bill's own, or isolation is cosmetic.
const aggregate = renderBillDocument(
  bills.map((b) => b.original),
  COPY_LABEL.original
);
const aggRaw = new TextDecoder("latin1").decode(aggregate);
const aggPages = (aggRaw.match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) ?? []).length;
check(aggPages >= bills.length, "the aggregate still holds every invoice", `${aggPages} pages`);
check(
  bills.every((b) => aggRaw.includes(`(${b.original.invoiceNo})`)),
  "the aggregate contains all of them, which is why nothing may resolve to it"
);

console.log(failures === 0 ? "\nPER-BILL CHECKS: all passed." : `\nPER-BILL CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
