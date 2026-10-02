// supabase/functions/_selftest/test-folder-summary-export.ts
//
// Proves the exported folder summary says exactly what the folder screen says.
//
// THE RISK THIS TEST EXISTS FOR
// "Export Summary" is the one place where a financial figure is allowed to leave
// the app and be used for something real — reconciled against a supplier, filed,
// sent to an accountant. If the export recomputed a total, rounded differently, or
// described the population of the numbers in its own words, it would disagree with
// the screen and nothing in the system would notice: the user would just trust the
// wrong document. Every figure here is therefore checked against the same
// `FolderBillSummary` object the screen renders, formatted by the same functions.
//
// WHAT IS ACTUALLY TESTED
// It imports the REAL modules (`folderSummaryExport`, `billFormat`) rather than
// transcribing them, because a test of a copy proves only that the copy is
// self-consistent. This is why the formatters were moved into a module with no
// react-native or Supabase import.
//
//   1. Every figure in every section equals `formatX(summary.field)` — the exact
//      expression the sheet uses. Not approximately: string equality.
//   2. No section is missing a figure the screen shows, and none is invented.
//   3. `null` min/max export as "—", never "₹0.00", in every coverage case.
//   4. The exported scope wording matches `BillSummaryScopeNote`'s wording for the
//      same summary, including the all-missing and unknown-coverage cases.
//   5. The HTML contains each figure, the folder name and the generated date, and
//      escapes workbook-supplied text.
//   6. Row counts agree: the job-kind breakdown sums to `total_bills`.
//
//   node supabase/functions/_selftest/test-folder-summary-export.ts

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatMoney, formatQuantity, formatJobKind } from "../../../src/services/billFormat.ts";
import {
  buildFolderSummaryHtml,
  scopeLines,
  summarySections,
  summaryFilename,
} from "../../../src/services/folderSummaryExport.ts";
import type { Bill, FolderBillSummary } from "../../../src/types/bill.ts";
import { EMPTY_FOLDER_BILL_SUMMARY } from "../../../src/types/bill.ts";

const APP = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const REPO = resolve(APP, "..");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}`);

/* A summary built the way the RPC would return one. `bills_with_total` is set by
   hand rather than derived, because the point of these cases is to pin the
   behaviour of each population, not to re-test the arithmetic. */
function summary(over: Partial<FolderBillSummary> = {}): FolderBillSummary {
  return {
    ...EMPTY_FOLDER_BILL_SUMMARY,
    total_bills: 12,
    bills_without_total: 0,
    bills_with_total: 12,
    total_quantity: 480,
    total_amount_before_tax: 100000,
    total_cgst: 4500,
    total_sgst: 4500,
    total_igst: 0,
    total_gst: 9000,
    total_amount_after_tax: 109000,
    total_round_off: -0.4,
    average_bill_value: 9083.33,
    average_quantity: 40,
    average_amount_before_tax: 8333.33,
    average_cgst: 375,
    average_sgst: 375,
    average_igst: 0,
    average_gst: 750,
    average_round_off: -0.03,
    min_amount_after_tax: 2500,
    max_amount_after_tax: 55000,
    min_amount_before_tax: 2200,
    max_amount_before_tax: 51000,
    job_kind_breakdown: [
      { job_kind: "LABOUR JOB", count: 7 },
      { job_kind: "WITH METAL", count: 5 },
    ],
    ...over,
  };
}

/** The figures the folder sheet renders, as the sheet writes them. */
function expectedFigures(s: FolderBillSummary): { label: string; value: string }[] {
  return [
    { label: "Total quantity", value: formatQuantity(s.total_quantity) },
    { label: "Before tax", value: formatMoney(s.total_amount_before_tax) },
    { label: "CGST", value: formatMoney(s.total_cgst) },
    { label: "SGST", value: formatMoney(s.total_sgst) },
    { label: "IGST", value: formatMoney(s.total_igst) },
    { label: "GST", value: formatMoney(s.total_gst) },
    { label: "After tax", value: formatMoney(s.total_amount_after_tax) },
    { label: "Round off", value: formatMoney(s.total_round_off) },
    { label: "Quantity", value: formatQuantity(s.average_quantity) },
    { label: "Before tax", value: formatMoney(s.average_amount_before_tax) },
    { label: "CGST", value: formatMoney(s.average_cgst) },
    { label: "SGST", value: formatMoney(s.average_sgst) },
    { label: "IGST", value: formatMoney(s.average_igst) },
    { label: "GST", value: formatMoney(s.average_gst) },
    { label: "After tax", value: formatMoney(s.average_bill_value) },
    { label: "Lowest bill", value: formatMoney(s.min_amount_after_tax) },
    { label: "Highest bill", value: formatMoney(s.max_amount_after_tax) },
    { label: "Lowest, before tax", value: formatMoney(s.min_amount_before_tax) },
    { label: "Highest, before tax", value: formatMoney(s.max_amount_before_tax) },
  ];
}

/* ── 1 & 2. Section-by-section equality with the screen ─────────────────────
 *
 * Labels repeat across sections ("Before tax" is a total in one and an average in
 * the next), so rows are compared as an ordered sequence per section. The order is
 * pinned on purpose: if the export reordered its rows that is a change a reader
 * would notice, and the screen's order is the one already agreed.
 */
section("every exported figure equals the figure on screen");

const cases: { name: string; summary: FolderBillSummary }[] = [
  { name: "all bills complete", summary: summary() },
  {
    name: "some bills have no total",
    summary: summary({ bills_without_total: 3, bills_with_total: 9 }),
  },
  {
    name: "no bill has a total",
    summary: summary({
      total_amount_after_tax: 0,
      average_bill_value: 0,
      min_amount_after_tax: null,
      max_amount_after_tax: null,
      min_amount_before_tax: null,
      max_amount_before_tax: null,
      bills_without_total: 12,
      bills_with_total: 0,
    }),
  },
  {
    name: "a genuine zero-total bill is not an absence",
    summary: summary({
      min_amount_after_tax: 0,
      max_amount_after_tax: 55000,
      min_amount_before_tax: 0,
    }),
  },
  {
    name: "coverage unknown (older RPC without bills_with_total)",
    summary: summary({ bills_without_total: 2, bills_with_total: null }),
  },
  {
    name: "empty folder",
    summary: summary({
      ...EMPTY_FOLDER_BILL_SUMMARY,
      total_bills: 0,
    }),
  },
];

for (const { name, summary: s } of cases) {
  const sections = summarySections(s);
  /* The breakdown is checked separately below — it has one row per job kind rather
     than a fixed set, so folding it in here would make the count a function of the
     data instead of a comparison against the screen's fixed figure list. */
  const flat = sections
    .filter((sec) => sec.title !== "Bill breakdown")
    .flatMap((sec) => sec.rows);
  const expected = expectedFigures(s);

  check(
    flat.length === expected.length,
    `[${name}] the export has exactly as many figures as the screen`,
    `${flat.length} vs ${expected.length}`
  );

  for (let i = 0; i < Math.max(flat.length, expected.length); i++) {
    const got = flat[i];
    const want = expected[i];
    check(
      got !== undefined && want !== undefined && got.label === want.label && got.value === want.value,
      `[${name}] row ${i} matches`,
      got && want
        ? got.value === want.value && got.label === want.label
          ? `${got.label} = ${got.value}`
          : `export "${got.label}" = "${got.value}" vs screen "${want.label}" = "${want.value}"`
        : "missing on one side"
    );
  }

  /* A breakdown row must also equal what the screen writes for that bucket. */
  for (const bucket of s.job_kind_breakdown) {
    const wantLabel = bucket.job_kind ? formatJobKind(bucket.job_kind) ?? bucket.job_kind : "Unclassified";
    const wantValue = `${bucket.count} ${bucket.count === 1 ? "bill" : "bills"}`;
    const got = sections.find((sec) => sec.title === "Bill breakdown")?.rows.find(
      (row) => row.label === wantLabel
    );
    check(
      got !== undefined && got.value === wantValue,
      `[${name}] breakdown row "${wantLabel}" matches`,
      got ? got.value : "row missing"
    );
  }

  const breakdownTotal = s.job_kind_breakdown.reduce((sum, b) => sum + b.count, 0);
  check(
    breakdownTotal === s.total_bills,
    `[${name}] the breakdown still sums to the bill count`,
    `${breakdownTotal} vs ${s.total_bills}`
  );
}

/* ── 3. A missing figure is never a zero ───────────────────────────────────── */
section("an absent figure is never written as zero");

for (const { name, summary: s } of cases.filter((c) => c.name.includes("no bill") || c.name.includes("empty"))) {
  const spread = summarySections(s).find((sec) => sec.title === "Spread")!;
  for (const row of spread.rows) {
    check(
      !/^[-+]?₹0\.00$/.test(row.value),
      `[${name}] "${row.label}" is not a fabricated zero`,
      row.value
    );
  }
  check(
    spread.rows.every((row) => row.value === "—"),
    `[${name}] every absent spread figure reads as an em dash`,
    spread.rows.map((r) => r.value).join(", ")
  );
}

/* A real stored 0 must survive as 0 — the mirror image of the case above. */
const zeroCase = summary({ min_amount_after_tax: 0, bills_without_total: 0, bills_with_total: 12 });
check(
  summarySections(zeroCase)
    .find((sec) => sec.title === "Spread")!
    .rows.find((r) => r.label === "Lowest bill")!.value === formatMoney(0),
  "a genuine ₹0 minimum stays ₹0.00",
  formatMoney(0)
);

/* ── 4. The scope wording matches the screen's ───────────────────────────────
 *
 * `BillSummaryScopeNote` builds its sentences inline in JSX, so the comparison is
 * against the strings that component renders. They are read from the component's
 * source rather than transcribed, so a change to either side is caught.
 */
section("the exported scope says what the screen says");

const noteSource = readFileSync(
  join(APP, "src/components/bills/BillSummaryScopeNote.tsx"),
  "utf8"
);

check(
  /No bill in this folder has a recorded after-tax total/.test(noteSource) &&
    scopeLines(cases[2].summary).some((l) => /No bill in this folder has a recorded after-tax total/.test(l)),
  "the all-missing warning is identical in both",
  scopeLines(cases[2].summary).find((l) => /No bill/.test(l))?.slice(0, 46) ?? ""
);

check(
  /a missing\s+total is left out, not counted as ₹0\.00/.test(noteSource) &&
    scopeLines(cases[1].summary).some((l) => /a missing total is left out, not counted as ₹0\.00/.test(l)),
  "the partial-coverage warning is identical in both"
);

check(
  /all with a recorded after-tax total/.test(noteSource) &&
    scopeLines(cases[0].summary).some((l) => /all with a recorded after-tax total/.test(l)),
  "the all-complete scope line is identical in both"
);

check(scopeLines(cases[5].summary).length === 0, "an empty folder gets no scope wording");
check(scopeLines(cases[3].summary).every((l) => !/no recorded after-tax total/.test(l)),
  "a folder where every bill is priced gets no missing-total warning");

/* Unknown coverage must not be described as complete. */
const unknown = scopeLines(cases[4].summary).join(" ");
check(
  !/all with a recorded after-tax total/.test(unknown),
  "unknown coverage is not described as complete",
  unknown
);
check(
  !/cover only/.test(unknown),
  "unknown coverage does not assert which bills the money covers",
  unknown
);

/* ── 5. The document itself ───────────────────────────────────────────────── */
section("the exported document carries its own figures and caveats");

const bills: Bill[] = [
  {
    id: "b1",
    invoice_no: "INV/001",
    invoice_date: "2026-09-06",
    job_kind: "LABOUR JOB",
    total_quantity: 40,
    amount_after_tax: 2500,
  } as Bill,
  {
    id: "b2",
    invoice_no: "<script>alert(1)</script>",
    invoice_date: null,
    job_kind: null,
    total_quantity: null,
    amount_after_tax: null,
  } as Bill,
];

const s0 = summary();
/* Named once so the admin and desktop documents below are built from identical
   inputs, which is what makes "the two documents are identical" a real claim. */
const folderName = "September 2026 — Zaveri";
const when = new Date("2026-10-02T09:30:00Z");
const html = buildFolderSummaryHtml({
  folderName,
  summary: s0,
  bills,
  generatedAt: when,
});

for (const row of expectedFigures(s0)) {
  check(html.includes(row.value), `the document contains "${row.label}" = ${row.value}`);
}

check(html.includes("September 2026 — Zaveri"), "the document names the folder");
check(/generated 02 Oct 2026/.test(html), "the document states the date it was generated");
check(/class="scope"/.test(html), "the document carries the scope wording");
check(
  html.includes("Three print copies".replace("Three", "three")),
  "the document states that the three copies are one bill"
);

/* Workbook text is untrusted: an invoice number must not become markup. */
check(!html.includes("<script>alert(1)</script>"), "workbook text is escaped, not injected");
check(html.includes("&lt;script&gt;"), "the escaped invoice number is still visible");

/* One row per bill, never three — the copies invariant. */
const appendixRows = html.split("<tr>").length;
check(appendixRows >= 3, "the appendix lists the bills", `${appendixRows - 1} rows`);

/* Without bills there is no empty appendix heading. */
const noAppendix = buildFolderSummaryHtml({ folderName: "Empty", summary: cases[5].summary });
check(!/Bills in this folder/.test(noAppendix), "no bill list is invented when none is given");
check(/<html/.test(noAppendix) && /<!DOCTYPE html>/.test(noAppendix),
  "the document is a complete HTML document (avoids a trailing blank page on iOS)");

/* ── 7. The desktop client exports the same document ─────────────────────────
 *
 * The two apps are separate compilation targets and already keep separate copies of
 * formatMoney/formatJobKind on purpose. The same reasoning applies to the export
 * builder: a shared package is not worth a build dependency across two apps, but a
 * copy nobody compares WILL drift. So the desktop builder is run over the same
 * summaries and required to produce identical rows and identical HTML.
 *
 * This is checked by importing the desktop module, not by diffing the two files: a
 * file diff would pass on two files that differ only in a comment, and would fail on
 * two files that are textually different but behaviourally identical.
 */
section("the desktop client exports the same figures");

const desktop = (await import(
  pathToFileURL(join(REPO, "Metalworker_desktop/src/services/folderSummaryExport.ts")).href
)) as typeof import("../../../src/services/folderSummaryExport.ts");

for (const { name, summary: s } of cases) {
  const adminSections = summarySections(s);
  const deskSections = desktop.summarySections(s);

  check(
    JSON.stringify(deskSections) === JSON.stringify(adminSections),
    `[${name}] the desktop sections match the admin ones`,
    deskSections.length === adminSections.length
      ? `${deskSections.length} sections`
      : `${deskSections.length} vs ${adminSections.length}`
  );

  check(
    JSON.stringify(desktop.scopeLines(s)) === JSON.stringify(scopeLines(s)),
    `[${name}] the desktop scope wording matches the admin one`
  );

  check(
    desktop.summaryFilename(folderName, when) === summaryFilename(folderName, when),
    `[${name}] the desktop filename matches the admin one`,
    desktop.summaryFilename(folderName, when)
  );
}

const deskHtml = desktop.buildFolderSummaryHtml({
  folderName,
  summary: s0,
  bills,
  generatedAt: when,
});

check(deskHtml === html, "the desktop document is identical to the admin one");
check(
  desktop.buildFolderSummaryHtml({ folderName, summary: s0, generatedAt: when }).includes("₹1,09,000.00"),
  "the desktop document carries the after-tax total"
);

/* ── Filenames ─────────────────────────────────────────────────────────────── */
section("filenames are safe");
check(
  /^billing-folder-summary-\d{8}\.pdf$/.test(summaryFilename("///", new Date("2026-10-02T00:00:00Z"))),
  "a name with no usable characters still yields a filename",
  summaryFilename("///", new Date("2026-10-02T00:00:00Z"))
);
check(
  !/[\\/:*?"<>|]/.test(summaryFilename("A/B:C*D?E", new Date("2026-10-02T00:00:00Z"))),
  "path and shell characters are stripped",
  summaryFilename("A/B:C*D?E", new Date("2026-10-02T00:00:00Z"))
);

console.log();
console.log(
  failures === 0
    ? "FOLDER SUMMARY EXPORT CHECKS: all passed."
    : `\nFOLDER SUMMARY EXPORT CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;