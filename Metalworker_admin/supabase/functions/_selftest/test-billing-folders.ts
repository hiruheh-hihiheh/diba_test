// Billing folders: the aggregation rules the Billing screen depends on.
//
// WHY THIS IS A SEPARATE TEST
// `test-per-bill` proves one worksheet becomes one bill. This proves the two
// consequences that the Billing section then builds on:
//
//   1. ONE INVOICE IS ONE BILL. The original, duplicate and triplicate are three
//      PDFs on ONE row, so a folder holding one invoice reports one bill — and a
//      summary over N bills can never become a summary over 3N.
//   2. THE AGGREGATION ARITHMETIC. Totals, averages, min/max and the job-kind
//      breakdown, computed by a reference implementation of exactly what the SQL in
//      migration 0009 does, and compared against figures worked out by hand.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not connect to a database. The rules it checks are the rules that are easy
// to break by accident: a missing DISTINCT, a division that is not NULLIF-guarded, a
// breakdown that sums to something other than the bill count. Those are properties of
// the SQL, and the SQL is checked structurally further down — the same way
// `test-structure.ts` checks the renderer against its source rather than against a
// fixture.
//
//   node supabase/functions/_selftest/test-billing-folders.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_ORDER, COPY_LABEL } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { formatJobKind } from "../process-bill-upload/_shared/formatJobKind.ts";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
/** The workspace root — the sample workbooks live one level above the admin app. */
const REPO = resolve(HERE, "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");
/** The admin app, which is where the migrations live. */
const APP = resolve(HERE, "../../..");
const MIGRATION = resolve(APP, "supabase/migrations/0009_billing_folders.sql");
/** Migration 0010 redefines the aggregation, so the semantic checks below read THAT
 *  file. Checking them against 0009 would pass on the old averaging and prove nothing,
 *  and concatenating the two would be worse still: 0009 coalesces the spread to 0, so
 *  the "null survives" check would be reading a definition that is no longer in force. */
const MIGRATION_0010 = resolve(APP, "supabase/migrations/0010_billing_summary_semantics.sql");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

/* ──────────────────────────────────────────────
   The reference aggregation
   ────────────────────────────────────────────── */

/** One bill, in the shape `get_folder_bill_summary` reads. */
interface BillRow {
  id: string;
  total_quantity: number | null;
  amount_before_tax: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total_gst: number | null;
  amount_after_tax: number | null;
  round_off: number | null;
  job_kind: string | null;
}

interface Summary {
  total_bills: number;
  total_quantity: number;
  amount_before_tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_gst: number;
  amount_after_tax: number;
  round_off: number;
  average_bill_value: number;
  average_quantity: number;
  average_amount_before_tax: number;
  average_cgst: number;
  average_sgst: number;
  average_igst: number;
  average_gst: number;
  average_round_off: number;
  /** `null` when no VALID bill has the figure — distinct from a bill worth 0. */
  min_amount_after_tax: number | null;
  max_amount_after_tax: number | null;
  min_amount_before_tax: number | null;
  max_amount_before_tax: number | null;
  bills_without_total: number;
  bills_with_total: number;
  job_kind_breakdown: { job_kind: string | null; count: number }[];
}

const num = (v: number | null) => v ?? 0;
const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  // Half-up, matching Postgres `round(numeric, int)`, so the reference and the
  // function cannot differ on a .5 boundary.
  return Math.sign(v) * Math.round(Math.abs(v) * f + Number.EPSILON) / f;
};

/**
 * `get_folder_bill_summary`, in TypeScript.
 *
 * Transcribed line for line from the SQL in migration 0010, with the three
 * properties that matter kept in the transcription rather than added afterwards:
 *
 *   * `rows` is de-duplicated BY ID before anything is summed. This is the
 *     `WITH unique_bills AS (SELECT DISTINCT …)` in the SQL, and it is why a repeated
 *     folder link cannot inflate the money while the count stays right.
 *   * money and money averages use the VALID population — bills whose
 *     `amount_after_tax` IS NOT NULL — while counts and quantity use ALL bills. This
 *     is migration 0010's per-aggregate decision, and transcribing it faithfully is
 *     the only way these checks mean anything.
 *   * every average divides by `NULLIF(count, 0)`, so an empty folder yields 0 rather
 *     than NaN.
 *   * min/max return `null` — not 0 — when no bill in the population has the figure,
 *     because "no cheapest bill" and "the cheapest bill cost nothing" are different
 *     statements.
 */
function summarize(input: BillRow[]): Summary {
  const byId = new Map<string, BillRow>();
  for (const row of input) byId.set(row.id, row);
  const unique = [...byId.values()];

  /* ALL BILLS: the record count and the physical quantity. */
  const all = unique;
  /* VALID BILLS: every money figure. A stored 0 IS valid — a null is what "not
     recorded" looks like — so this tests `!== null`, never truthiness. */
  const priced = unique.filter((r) => r.amount_after_tax !== null);

  const n = all.length;
  const nValid = priced.length;
  /* `sum(x) FILTER (WHERE has_total)`: a null component inside a VALID bill still
     contributes nothing, which is right — an intra-state invoice has no IGST, and
     0 would be a value the invoice never claimed. */
  const sumAll = (pick: (r: BillRow) => number | null) =>
    all.reduce((acc, r) => acc + num(pick(r)), 0);
  const sumPriced = (pick: (r: BillRow) => number | null) =>
    priced.reduce((acc, r) => acc + num(pick(r)), 0);
  const extremes = (pick: (r: BillRow) => number | null) => {
    // MIN/MAX over the valid population, left NULL when that population has no
    // figure at all. `null`, never 0: see the note on `Summary`.
    const values = priced.map(pick).filter((v): v is number => v !== null && v !== undefined);
    return values.length === 0
      ? { min: null, max: null }
      : { min: Math.min(...values), max: Math.max(...values) };
  };

  const qty = sumAll((r) => r.total_quantity);
  const abt = sumPriced((r) => r.amount_before_tax);
  const cg = sumPriced((r) => r.cgst);
  const sg = sumPriced((r) => r.sgst);
  const ig = sumPriced((r) => r.igst);
  const gst = sumPriced((r) => r.total_gst);
  const aat = sumPriced((r) => r.amount_after_tax);
  const ro = sumPriced((r) => r.round_off);
  const aatSpread = extremes((r) => r.amount_after_tax);
  const abtSpread = extremes((r) => r.amount_before_tax);
  /* `coalesce(round(v / NULLIF(n, 0), dp), 0)`.
   *
   * The guard is the whole point: NULLIF turns 0 into NULL, the division yields NULL
   * rather than "division by zero", and the coalesce makes it 0. Dividing by a plain
   * `n === 0 ? 1 : n` would be the same answer but would not be testing the same code
   * path, and dividing by 0 directly is the NaN this guards against.
   *
   * Two denominators, and which one a given average uses is migration 0010's whole
   * point: money divides by `nValid`, quantity by `n`. A single shared `n` here
   * would silently pass every pre-0010 expectation while being the bug under test. */
  const avg = (v: number, dp: number, by: number) => (by === 0 ? 0 : round(v / by, dp));

  const buckets = new Map<string | null, number>();
  for (const r of all) {
    const key = r.job_kind ?? null;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return {
    total_bills: n,
    total_quantity: qty,
    amount_before_tax: abt,
    cgst: cg,
    sgst: sg,
    igst: ig,
    total_gst: gst,
    amount_after_tax: aat,
    round_off: ro,
    average_bill_value: avg(aat, 2, nValid),
    average_quantity: avg(qty, 3, n),
    average_amount_before_tax: avg(abt, 2, nValid),
    average_cgst: avg(cg, 2, nValid),
    average_sgst: avg(sg, 2, nValid),
    average_igst: avg(ig, 2, nValid),
    average_gst: avg(gst, 2, nValid),
    average_round_off: avg(ro, 2, nValid),
    min_amount_after_tax: aatSpread.min,
    max_amount_after_tax: aatSpread.max,
    min_amount_before_tax: abtSpread.min,
    max_amount_before_tax: abtSpread.max,
    bills_without_total: n - nValid,
    bills_with_total: nValid,
    job_kind_breakdown: [...buckets.entries()]
      .map(([job_kind, count]) => ({ job_kind, count }))
      .sort((a, b) => b.count - a.count || (a.job_kind === null ? 1 : b.job_kind === null ? -1 : 0)),
  };
}

const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;

/* ──────────────────────────────────────────────
   1. From the real workbook
   ────────────────────────────────────────────── */

const wb = await readXlsx(readFileSync(workbook));
const { bills, skipped } = parseBills(wb.sheets);
console.log(`workbook: ${workbook}`);
console.log(`${bills.length} bill(s) parsed, ${skipped.length} skipped\n`);

check(skipped.length === 0, "no sheet was skipped", `${skipped.length} skipped`);
check(
  bills.length === wb.sheets.length,
  "one bill per worksheet — the three copies are NOT three bills",
  `${bills.length} bills from ${wb.sheets.length} sheets`
);

const rows: BillRow[] = bills.map((p) => ({
  // The sheet name stands in for the row id; what matters is that it is unique, which
  // is what the DISTINCT in the SQL keys on.
  id: p.sheetName,
  total_quantity: p.original.totalQuantity,
  amount_before_tax: p.original.amountBeforeTax,
  cgst: p.original.cgst,
  sgst: p.original.sgst,
  igst: p.original.igst,
  total_gst: p.original.totalGst,
  amount_after_tax: p.original.amountAfterTax,
  round_off: p.original.roundOff,
  job_kind: p.original.jobKind,
}));

const uniqueSheets = new Set(bills.map((p) => p.sheetName));
check(uniqueSheets.size === bills.length, "every bill has a distinct key", `${uniqueSheets.size} distinct`);

/* Each bill renders three documents, and they belong to ONE bill. */
let documents = 0;
for (const bill of bills) {
  for (const copy of COPY_ORDER) {
    const bytes = renderBillDocument([bill[copy]], COPY_LABEL[copy]);
    if (bytes.length > 0) documents++;
  }
}
check(
  documents === bills.length * 3,
  "each bill has 3 print documents that are not separate bills",
  `${documents} documents for ${bills.length} bills`
);

/* ──────────────────────────────────────────────
   2. The aggregation, at 1 / 2 / 5 / 20+
   ────────────────────────────────────────────── */

console.log("\naggregation over the whole workbook");
const all = summarize(rows);

check(all.total_bills === bills.length, "one bill per worksheet, counted once", `${all.total_bills}`);
check(
  all.total_bills * 3 === documents,
  "the bill count is a third of the PDF count — the copies are not bills",
  `${all.total_bills} bills, ${documents} PDFs`
);
check(
  all.job_kind_breakdown.reduce((acc, b) => acc + b.count, 0) === all.total_bills,
  "the job-kind breakdown sums to the bill count",
  `${all.job_kind_breakdown.map((b) => `${formatJobKind(b.job_kind ?? "") ?? "unclassified"}:${b.count}`).join(", ")}`
);
/* The identity is average x VALID COUNT, not x total_bills. Writing it the other way
   round is the pre-0010 bug: it only holds while every bill has a total, so it looks
   correct on a clean folder and silently fails on an incomplete one. */
check(
  all.bills_with_total === 0 ||
    near(all.average_bill_value * all.bills_with_total, all.amount_after_tax, 0.05),
  "average bill value x bills-with-a-total is the total after tax (to rounding)",
  `${all.average_bill_value} x ${all.bills_with_total} vs ${all.amount_after_tax}`
);
check(
  all.bills_without_total === rows.filter((r) => r.amount_after_tax === null).length,
  "bills without a total are counted, not treated as zero",
  `${all.bills_without_total} of ${all.total_bills}`
);
check(
  all.bills_with_total + all.bills_without_total === all.total_bills,
  "the two populations partition the folder — no bill is counted twice or dropped",
  `${all.bills_with_total} + ${all.bills_without_total} = ${all.total_bills}`
);
check(
  all.total_bills === 0 || near(all.average_quantity * all.total_bills, all.total_quantity, 0.005),
  "average quantity x bill count is the total quantity (quantity uses ALL bills)",
  `${all.average_quantity} x ${all.total_bills} vs ${all.total_quantity}`
);

/* ---- 2a. A folder of 1 ---- */
console.log("\n1 bill");
const one = summarize(rows.slice(0, 1));
check(one.total_bills === 1, "one bill is one bill", `${one.total_bills}`);
check(
  near(one.amount_after_tax, num(rows[0].amount_after_tax)),
  "with one bill, the total is that bill",
  `${one.amount_after_tax}`
);
check(
  /* `near` is not used here because both sides are nullable now: the point of the
     check is that they are the SAME figure, and `near(null, 5000)` is not the same
     statement as `near(5000, 5000)`. */
  one.min_amount_after_tax !== null &&
    one.min_amount_after_tax === one.max_amount_after_tax &&
    near(one.min_amount_after_tax, one.amount_after_tax),
  "with one bill, min equals max equals the total — the spread is not zero by accident",
  `${one.min_amount_after_tax} .. ${one.max_amount_after_tax}`
);
check(
  near(one.average_bill_value, one.amount_after_tax),
  "with one bill, the average is the total",
  `${one.average_bill_value}`
);
check(one.job_kind_breakdown.length === 1, "one job-kind bucket", `${one.job_kind_breakdown.length}`);

/* ---- 2b. A folder of 2 ---- */
console.log("\n2 bills");
const two = summarize(rows.slice(0, 2));
const twoTotal = num(rows[0].amount_after_tax) + num(rows[1].amount_after_tax);
check(two.total_bills === 2, "two bills are two bills", `${two.total_bills}`);
check(two.total_bills * 3 === 6, "and six PDFs, not six bills", `${two.total_bills * 3} PDFs`);
check(near(two.amount_after_tax, twoTotal), "the total is the sum of the two", `${two.amount_after_tax}`);
check(
  near(two.average_bill_value, round(twoTotal / 2, 2)),
  "the average is the total over 2",
  `${two.average_bill_value}`
);

/* ---- 2c. A folder of 5 ---- */
console.log("\n5 bills");
const five = summarize(rows.slice(0, 5));
const fiveTotal = rows.slice(0, 5).reduce((acc, r) => acc + num(r.amount_after_tax), 0);
check(five.total_bills === 5, "five bills are five bills", `${five.total_bills}`);
check(five.total_bills * 3 === 15, "and fifteen PDFs, not fifteen bills", `${five.total_bills * 3} PDFs`);
check(near(five.amount_after_tax, fiveTotal), "the total is the sum of the five", `${five.amount_after_tax}`);
check(
  near(five.average_bill_value, round(fiveTotal / 5, 2)),
  "the average is the total over 5",
  `${five.average_bill_value}`
);

/* ---- 2d. Twenty or more ---- */
console.log("\n20+ bills");
const twenty = rows.slice(0, Math.min(20, rows.length));
const big = summarize(twenty);
const bigTotal = twenty.reduce((acc, r) => acc + num(r.amount_after_tax), 0);
check(big.total_bills === twenty.length, "twenty bills are twenty bills", `${big.total_bills}`);
check(big.total_bills * 3 === twenty.length * 3, "and sixty PDFs, not sixty bills", `${big.total_bills * 3}`);
check(near(big.amount_after_tax, bigTotal), "the total is the sum of the twenty", `${big.amount_after_tax}`);
check(
  near(big.average_bill_value, round(bigTotal / twenty.length, 2)),
  "the average is the total over 20",
  `${big.average_bill_value}`
);
check(
  /* Over the VALID population only, so this holds by construction: the mean of the
     priced bills cannot sit outside the cheapest and dearest priced bill. If a
     missing bill ever re-entered the denominator this is the check that breaks. */
  big.min_amount_after_tax !== null &&
    big.max_amount_after_tax !== null &&
    big.min_amount_after_tax <= big.average_bill_value &&
    big.average_bill_value <= big.max_amount_after_tax,
  "min <= average <= max over priced bills, so the spread brackets the mean",
  `${big.min_amount_after_tax} <= ${big.average_bill_value} <= ${big.max_amount_after_tax}`
);

/* ---- 2e. An empty folder ---- */
console.log("\n0 bills");
const empty = summarize([]);
check(empty.total_bills === 0, "an empty folder holds no bills", `${empty.total_bills}`);
{
  /* Named explicitly rather than looping over the object, so that ADDING a figure to
     the summary without adding it here fails the test instead of silently passing. */
  const zeroed: [string, number][] = [
    ["total_quantity", empty.total_quantity],
    ["amount_before_tax", empty.amount_before_tax],
    ["cgst", empty.cgst],
    ["sgst", empty.sgst],
    ["igst", empty.igst],
    ["total_gst", empty.total_gst],
    ["amount_after_tax", empty.amount_after_tax],
    ["round_off", empty.round_off],
    ["average_bill_value", empty.average_bill_value],
    ["average_quantity", empty.average_quantity],
    ["average_amount_before_tax", empty.average_amount_before_tax],
    ["average_cgst", empty.average_cgst],
    ["average_sgst", empty.average_sgst],
    ["average_igst", empty.average_igst],
    ["average_gst", empty.average_gst],
    ["average_round_off", empty.average_round_off],
    ["bills_without_total", empty.bills_without_total],
    ["bills_with_total", empty.bills_with_total],
  ];
  const bad = zeroed.filter(([, v]) => !Number.isFinite(v) || v !== 0);
  check(
    bad.length === 0,
    "every SUM and AVERAGE is 0 on an empty folder, never NaN or Infinity",
    bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(", ") : `${zeroed.length} figures all 0`
  );
}
check(empty.job_kind_breakdown.length === 0, "an empty folder has no buckets", "[]");

/* The four spread figures are the exception, and deliberately. An empty folder has no
   cheapest bill, so the answer is `null`. Were it 0, the summary would claim the
   cheapest bill in the folder costs nothing — a financial statement about work that
   was never billed. The count of bills and their totals may be 0; the extremes of an
   absent set may not. */
{
  const spread: [string, number | null][] = [
    ["min_amount_after_tax", empty.min_amount_after_tax],
    ["max_amount_after_tax", empty.max_amount_after_tax],
    ["min_amount_before_tax", empty.min_amount_before_tax],
    ["max_amount_before_tax", empty.max_amount_before_tax],
  ];
  const notNull = spread.filter(([, v]) => v !== null);
  check(
    notNull.length === 0,
    "the spread is null on an empty folder, not ₹0",
    notNull.length ? notNull.map(([k, v]) => `${k}=${v}`).join(", ") : "all four null"
  );
}

/* ---- 2f. The three copies can never triple a total ---- */
console.log("\ncopy inflation");
const once = summarize(rows);
/* The same bills presented as if each copy were its own folder item. The DISTINCT in
   the SQL is what stops this; simulating the rows without it shows what it prevents. */
const tripledRows = rows.flatMap((r) =>
  COPY_ORDER.map((_, i) => ({ ...r, id: `${r.id}::copy${i}` }))
);
const tripled = summarize(tripledRows);
check(
  tripled.total_bills === tripledRows.length,
  "without the DISTINCT the count WOULD triple — so the DISTINCT is load-bearing",
  `${tripled.total_bills} vs ${once.total_bills}`
);
check(
  tripled.total_bills === once.total_bills * 3 && tripled.amount_after_tax > once.amount_after_tax,
  "which is exactly the inflation the real function prevents",
  `₹${tripled.amount_after_tax} vs ₹${once.amount_after_tax}`
);
/* And the real set, presented three times as duplicate LINKS to the same ids, must not
   move at all — this is the case the 0001 unique index plus the DISTINCT both cover. */
const relinked = summarize([...rows, ...rows, ...rows]);
check(
  relinked.total_bills === once.total_bills && relinked.amount_after_tax === once.amount_after_tax,
  "repeated folder links to the same bills change nothing",
  `${relinked.total_bills} bills, ₹${relinked.amount_after_tax}`
);

/* ──────────────────────────────────────────────
   2g. Bills with no recorded total
   ──────────────────────────────────────────────
   The seven cases migration 0010 exists for. Each is stated with figures worked out
   by hand rather than taken from the implementation, because a test that compares the
   reference against itself checks nothing.

   The worked example used throughout: bills worth ₹10,000 and ₹20,000 plus bills with
   no total. The mean of the two PRICED bills is ₹15,000. Pre-0010 the function
   returned ₹10,000, because the unpriced bill sat in the denominator and pulled the
   average down by a third while contributing nothing to the sum. That single number
   is the whole reason this section exists. */
console.log("\nmissing totals: one, several, all");

/** A priced bill worth the given amount, with a consistent tax identity. */
const priced = (id: string, afterTax: number, qty = 1, jobKind: string | null = null): BillRow => ({
  id,
  total_quantity: qty,
  amount_before_tax: round(afterTax * 0.84, 2),
  cgst: round(afterTax * 0.08, 2),
  sgst: round(afterTax * 0.08, 2),
  igst: 0,
  total_gst: round(afterTax * 0.16, 2),
  amount_after_tax: afterTax,
  round_off: 0,
  job_kind: jobKind,
});

/** A bill whose grand total was never imported: no money at all. */
const unpriced = (id: string, qty: number | null = null, jobKind: string | null = null): BillRow => ({
  id,
  total_quantity: qty,
  amount_before_tax: null,
  cgst: null,
  sgst: null,
  igst: null,
  total_gst: null,
  amount_after_tax: null,
  round_off: null,
  job_kind: jobKind,
});

/* ---- 2g-i. All bills complete: nothing is excluded, so nothing changes ---- */
{
  const s = summarize([priced("a", 10000), priced("b", 20000)]);
  check(
    s.total_bills === 2 && s.bills_with_total === 2 && s.bills_without_total === 0,
    "complete folder: both bills are priced",
    `${s.bills_with_total} priced of ${s.total_bills}`
  );
  check(
    near(s.amount_after_tax, 30000) && near(s.average_bill_value, 15000),
    "complete folder: total 30000, average 15000",
    `total ${s.amount_after_tax}, avg ${s.average_bill_value}`
  );
  check(
    s.min_amount_after_tax === 10000 && s.max_amount_after_tax === 20000,
    "complete folder: the spread is the two bills",
    `${s.min_amount_after_tax} .. ${s.max_amount_after_tax}`
  );
  check(
    near(s.total_gst, 4800) && near(s.average_gst, 2400),
    "complete folder: GST totals and averages over both bills",
    `gst ${s.total_gst}, avg ${s.average_gst}`
  );
}

/* ---- 2g-ii. ONE missing ---- */
{
  const s = summarize([priced("a", 10000), priced("b", 20000), unpriced("c")]);
  check(
    s.total_bills === 3 && s.bills_with_total === 2 && s.bills_without_total === 1,
    "one missing: counted as a bill, and excluded from the money",
    `${s.bills_with_total} priced + ${s.bills_without_total} missing = ${s.total_bills}`
  );
  check(
    near(s.amount_after_tax, 30000),
    "one missing: the total is unchanged — a missing total contributed nothing anyway",
    `total ${s.amount_after_tax}`
  );
  check(
    /* THE CHECK THIS MIGRATION EXISTS FOR. Pre-0010 this was 10000. */
    near(s.average_bill_value, 15000),
    "one missing: the average is still 15000 — the unpriced bill is NOT in the denominator",
    `avg ${s.average_bill_value} (was 10000 under migration 0009)`
  );
  check(
    s.min_amount_after_tax === 10000 && s.max_amount_after_tax === 20000,
    "one missing: the spread ignores the unpriced bill entirely",
    `${s.min_amount_after_tax} .. ${s.max_amount_after_tax}`
  );
}

/* ---- 2g-iii. SEVERAL missing ---- */
{
  const s = summarize([
    priced("a", 10000),
    unpriced("b"),
    priced("c", 20000),
    unpriced("d"),
    unpriced("e"),
  ]);
  check(
    s.total_bills === 5 && s.bills_with_total === 2 && s.bills_without_total === 3,
    "three missing: the populations still partition the folder",
    `${s.bills_with_total} + ${s.bills_without_total} = ${s.total_bills}`
  );
  check(
    near(s.amount_after_tax, 30000) && near(s.average_bill_value, 15000),
    "three missing: total and average are the two priced bills, not diluted by 5",
    `total ${s.amount_after_tax}, avg ${s.average_bill_value}`
  );
  check(
    near(s.total_quantity, 2) && near(s.average_quantity, 0.4, 0.0005),
    "three missing: QUANTITY still counts all 5 bills — it is not money",
    `qty ${s.total_quantity}, avg ${s.average_quantity}`
  );
}

/* ---- 2g-iv. ALL missing ---- */
{
  const s = summarize([unpriced("a", 3), unpriced("b", 2), unpriced("c", 1)]);
  check(
    s.total_bills === 3 && s.bills_with_total === 0 && s.bills_without_total === 3,
    "all missing: three bills, none of them priced",
    `${s.bills_with_total} priced of ${s.total_bills}`
  );
  check(
    s.amount_after_tax === 0 && s.average_bill_value === 0,
    "all missing: the money reads 0 — which is why the UI must warn, not call it a total",
    `total ${s.amount_after_tax}, avg ${s.average_bill_value}`
  );
  check(
    /* The null-vs-zero case. Both of these being 0 would assert the cheapest bill in
       this folder cost nothing, which is a statement about work that was never billed. */
    s.min_amount_after_tax === null && s.max_amount_after_tax === null,
    "all missing: the spread is NULL, not ₹0",
    `min ${s.min_amount_after_tax}, max ${s.max_amount_after_tax}`
  );
  check(
    near(s.total_quantity, 6),
    "all missing: the quantity is still real — 3+2+1",
    `qty ${s.total_quantity}`
  );
  check(
    s.job_kind_breakdown.reduce((acc, b) => acc + b.count, 0) === 3,
    "all missing: the job-kind split still counts all three bills",
    `${s.job_kind_breakdown.map((b) => `${b.job_kind}:${b.count}`).join(", ")}`
  );
}

/* ---- 2g-v. NULL is not ZERO: a genuinely free bill is priced ---- */
{
  /* A ₹0 invoice is a real thing — a sample, a no-charge job — and must be counted,
     averaged in and able to BE the cheapest bill. Testing it with a truthiness check
     (`if (!amount_after_tax)`) would drop it and quietly break the average. */
  const s = summarize([priced("a", 0), priced("b", 10000)]);
  check(
    s.bills_with_total === 2 && s.bills_without_total === 0,
    "a ₹0 bill is PRICED, not missing",
    `${s.bills_with_total} priced of ${s.total_bills}`
  );
  check(
    s.min_amount_after_tax === 0,
    "and it can be the cheapest bill — a real zero, distinct from null",
    `min ${s.min_amount_after_tax}`
  );
  check(
    near(s.amount_after_tax, 10000) && near(s.average_bill_value, 5000),
    "a ₹0 bill pulls the average down, correctly — it is half the folder",
    `total ${s.amount_after_tax}, avg ${s.average_bill_value}`
  );
  /* And the contrast in one line: same row, null instead of 0. */
  const asNull = summarize([unpriced("a", 1), priced("b", 10000)]);
  check(
    asNull.bills_with_total === 1 &&
      asNull.min_amount_after_tax === 10000 &&
      near(asNull.average_bill_value, 10000),
    "the same bill with a null total is excluded instead — zero and null differ",
    `priced ${asNull.bills_with_total}, min ${asNull.min_amount_after_tax}`
  );
}

/* ---- 2g-vi. A PARTIAL bill contributes nothing ---- */
{
  /* A bill whose before-tax and GST parsed but whose grand total did not. Folding
     these into the folder total would break the identity
     `before tax + GST + round off = after tax` for the folder as a whole. */
  const partial: BillRow = {
    ...priced("p", 9999),
    amount_after_tax: null,
  };
  const s = summarize([priced("a", 10000), partial]);
  check(
    s.bills_without_total === 1 && s.bills_with_total === 1,
    "a partial bill is excluded, not half-included",
    `${s.bills_with_total} priced of ${s.total_bills}`
  );
  check(
    near(s.amount_after_tax, 10000) && near(s.average_bill_value, 10000),
    "a partial bill's components do not leak into the total or the average",
    `total ${s.amount_after_tax}, avg ${s.average_bill_value}`
  );
}

/* ---- 2g-vii. A valid bill with a null COMPONENT ---- */
{
  /* An intra-state invoice writes IGST as "-": a valid total, a null igst. It is
     priced and belongs in the averages; its null IGST must contribute nothing rather
     than being invented as 0 and then averaged as if it were. */
  const intraState: BillRow = { ...priced("i", 10000), igst: null };
  const s = summarize([intraState, priced("j", 20000)]);
  check(
    s.bills_with_total === 2 && s.bills_without_total === 0,
    "a valid bill with a null IGST is still priced",
    `${s.bills_with_total} priced of ${s.total_bills}`
  );
  check(
    near(s.igst, 0) && near(s.average_igst, 0),
    "its null IGST contributes nothing — 0 here is an absence, not a claimed value",
    `igst ${s.igst}, avg ${s.average_igst}`
  );
  check(
    near(s.amount_after_tax, 30000) && near(s.average_bill_value, 15000),
    "and it does not affect the other figures",
    `total ${s.amount_after_tax}, avg ${s.average_bill_value}`
  );
  check(
    s.min_amount_before_tax !== null && s.max_amount_before_tax !== null,
    "the before-tax spread is still present — only IGST was absent",
    `${s.min_amount_before_tax} .. ${s.max_amount_before_tax}`
  );
}

/* ---- 2g-viii. The old "gaps" scenario, restated under 0010 ---- */
console.log("\nmissing totals: spread across a real folder");
const withGaps = rows.map((r, i) => (i % 4 === 3 ? { ...r, amount_after_tax: null } : r));
const gapped = summarize(withGaps);
check(
  gapped.bills_without_total === withGaps.filter((r) => r.amount_after_tax === null).length,
  "a bill with no total is reported as missing, not as ₹0",
  `${gapped.bills_without_total} missing`
);
check(
  gapped.min_amount_after_tax !== null && gapped.min_amount_after_tax > 0,
  "and it does not drag the cheapest-bill figure to zero",
  `min ${gapped.min_amount_after_tax}`
);
check(
  gapped.bills_with_total > 0 &&
    near(gapped.average_bill_value, round(gapped.amount_after_tax / gapped.bills_with_total, 2)),
  "the real folder's average is the total over the PRICED bills",
  `${gapped.average_bill_value} = ${gapped.amount_after_tax} / ${gapped.bills_with_total}`
);

/* ──────────────────────────────────────────────
   3. The SQL, structurally
   ────────────────────────────────────────────── */

console.log("\nmigration 0009");
const sql = readFileSync(MIGRATION, "utf8");

check(
  /folder_type\s+IN\s*\('labour',\s*'with_material',\s*'general',\s*'billing'\)/i.test(sql),
  "folder_type can hold 'billing'"
);
check(
  /BEFORE INSERT OR UPDATE ON public\.folder_items/i.test(sql),
  "the bills-only rule is a trigger on folder_items"
);
check(
  /kind\s*=\s*'billing'\s+AND NEW\.item_type IS DISTINCT FROM 'bill'/i.test(sql),
  "and it refuses anything that is not a bill in a billing folder"
);
check(
  !/BEFORE INSERT OR UPDATE OR DELETE ON public\.folder_items/i.test(sql),
  "the trigger is not on DELETE — emptying a folder must keep working"
);
check(
  /SELECT DISTINCT/i.test(sql),
  "the summary de-duplicates before summing"
);
check(
  /count\(\s*\*\s*\) FILTER \(WHERE u\.amount_after_tax IS NULL\)/i.test(sql),
  "bills without a total are counted separately"
);
/* Pre-0010 this counted `/ NULLIF(n_bills, 0)` and required >= 8. Migration 0010 moved
   seven of the eight averages onto `n_valid` — the priced-bill count — so the same
   guard now has to be checked on whichever denominator each average uses. Counting
   `NULLIF(...)` alone would pass if the money averages had kept dividing by the bill
   count, which is precisely the regression being guarded against. */
const sql0010 = readFileSync(MIGRATION_0010, "utf8");
console.log("\nmigration 0010 — which bills each figure covers");
const guardedDivisions = [...sql0010.matchAll(/\/\s*NULLIF\((n_bills|n_valid),\s*0\)/gi)].length;
check(
  guardedDivisions >= 8,
  "every average divides by a NULLIF-guarded denominator",
  `${guardedDivisions} guarded divisions`
);
const byValid = [...sql0010.matchAll(/NULLIF\(n_valid,\s*0\)/gi)].length;
check(
  byValid === 7,
  "all SEVEN money averages divide by the priced-bill count, not the bill count",
  `${byValid} money averages on n_valid`
);
const byBills = [...sql0010.matchAll(/NULLIF\(n_bills,\s*0\)/gi)].length;
check(
  byBills === 1,
  "only the QUANTITY average divides by the bill count",
  `${byBills} average on n_bills`
);
check(
  /bills_with_total\s+bigint/i.test(sql0010),
  "the priced-bill count is reported, so the UI can state the scope"
);
check(
  !/min_amount_after_tax\s+:=\s*coalesce/i.test(sql0010) &&
    !/max_amount_after_tax\s+:=\s*coalesce/i.test(sql0010),
  "the spread is NOT coalesced to 0 — null survives as null"
);
check(
  /min\(u\.amount_after_tax\)\s+FILTER \(WHERE u\.has_total\)/i.test(sql0010),
  "the spread is taken over priced bills only"
);
check(
  /count\(\*\)\s+FILTER \(WHERE u\.has_total\)/i.test(sql0010),
  "and the priced count uses the same predicate as the sums"
);
check(
  /sum\(u\.amount_after_tax\)\s+FILTER \(WHERE u\.has_total\)/i.test(sql0010),
  "money is summed over priced bills only"
);
/* Every money sum must carry the filter, not just the after-tax one. Checking one line
   would let `cgst` silently revert to summing every bill. */
{
  const moneyCols = [
    "amount_before_tax",
    "cgst",
    "sgst",
    "igst",
    "total_gst",
    "amount_after_tax",
    "round_off",
  ];
  const unfiltered = moneyCols.filter(
    (c) => !new RegExp(`sum\\(u\\.${c}\\)\\s+FILTER \\(WHERE u\\.has_total\\)`, "i").test(sql0010)
  );
  check(
    unfiltered.length === 0,
    "EVERY money total filters on has_total, not just after-tax",
    unfiltered.length ? `unfiltered: ${unfiltered.join(", ")}` : `${moneyCols.length} money totals filtered`
  );
  /* And the one figure that must NOT carry it. */
  check(
    /coalesce\(sum\(coalesce\(u\.total_quantity, 0\)\), 0\)/i.test(sql0010) &&
      !/sum\(u\.total_quantity\)\s+FILTER/i.test(sql0010),
    "the quantity sum is the ONE total with no has_total filter"
  );
  check(
    /avg_quantity\s+:=\s+coalesce\(round\(v_qty \/ NULLIF\(n_bills, 0\)/i.test(sql0010),
    "quantity still sums and averages over ALL bills"
  );
}
check(
  /SELECT DISTINCT b\.id, b\.job_kind AS raw_kind/i.test(sql0010),
  "the job-kind breakdown still covers all bills, priced or not"
);
/* The grants must be re-issued after a DROP + CREATE, or the rebuilt function would
   inherit the default PUBLIC execute privilege. This is the single most likely thing
   to be forgotten when a SECURITY DEFINER function is recreated by hand. */
check(
  /REVOKE ALL ON FUNCTION public\.get_folder_bill_summary\(uuid\) FROM public;\s*GRANT EXECUTE ON FUNCTION public\.get_folder_bill_summary\(uuid\) TO authenticated;/i.test(
    sql0010
  ),
  "the revoke and grant immediately follow the recreate, in that order"
);
check(
  /SECURITY DEFINER/i.test(sql0010) && /SET search_path = public/i.test(sql0010),
  "the summary is still SECURITY DEFINER with a pinned search_path"
);
check(
  /IF auth\.uid\(\) IS NULL THEN\s*RAISE EXCEPTION 'not_authenticated'/i.test(sql0010),
  "and still refuses an unauthenticated caller before reading anything"
);
check(
  /DROP FUNCTION IF EXISTS public\.get_folder_bill_summary\(uuid\);/i.test(sql0010),
  "the function is recreated under the same name and signature"
);
/* The change to the money's meaning has to be recorded where someone upgrading will
   actually read it, not only in a comment inside the function body. */
check(
  /WHAT CHANGES IN THE NUMBERS/i.test(sql0010) && /silently/i.test(sql0010),
  "the migration documents the change in the financial meaning of the totals"
);
check(
  /avg_bill_value[\s\S]{0,400}NULLIF\(n_valid, 0\)/i.test(sql0010),
  "and the header comment explains the denominator beside the figure it changes"
);

console.log("\nmigration 0009");
check(
  /count\(DISTINCT b\.id\)/i.test(sql),
  "the folder list counts DISTINCT bills"
);
check(
  /WHERE f\.folder_type = 'billing'/i.test(sql),
  "the counts RPC is restricted to billing folders"
);
check(
  /GRANT EXECUTE ON FUNCTION public\.get_folder_bill_summary\(uuid\) TO authenticated/i.test(sql) &&
    /REVOKE ALL ON FUNCTION public\.get_folder_bill_summary\(uuid\) FROM public/i.test(sql),
  "the summary RPC is granted to authenticated and revoked from public"
);
check(
  /GRANT EXECUTE ON FUNCTION public\.get_billing_folder_bill_counts\(\) TO authenticated/i.test(sql) &&
    /REVOKE ALL ON FUNCTION public\.get_billing_folder_bill_counts\(\) FROM public/i.test(sql),
  "and so is the counts RPC"
);
check(
  /CREATE OR REPLACE FUNCTION public\.get_folder_bill_summary/i.test(sql) === false,
  "the summary is replaced under the same name, not duplicated by a parallel function"
);

/* ---- 3a. The job-kind breakdown is a single array ---- */
const breakdownBlock = sql.slice(
  sql.indexOf("SELECT coalesce(jsonb_agg("),
  sql.indexOf("job_kind_breakdown :=")
);
check(
  /GROUP BY u\.raw_kind/.test(breakdownBlock),
  "the breakdown groups per job_kind inside a subquery"
);
check(
  /SELECT DISTINCT b\.id, b\.job_kind AS raw_kind/.test(breakdownBlock),
  "over the same de-duplicated bills as the totals"
);
check(
  /'job_kind',\s*g\.raw_kind/.test(breakdownBlock) && /'count',\s*g\.bill_count/.test(breakdownBlock),
  "and emits the raw stored job_kind with its count"
);
check(
  /ORDER BY g\.bill_count DESC, g\.raw_kind NULLS LAST/.test(breakdownBlock),
  "ordered by count, so the biggest bucket is first"
);
check(
  /coalesce\([\s\S]*'::jsonb\)/.test(breakdownBlock),
  "an empty folder yields [] rather than NULL"
);

console.log(
  failures === 0
    ? "\nBILLING FOLDER CHECKS: all passed."
    : `\nBILLING FOLDER CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
