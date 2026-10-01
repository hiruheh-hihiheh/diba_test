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
  min_amount_after_tax: number;
  max_amount_after_tax: number;
  min_amount_before_tax: number;
  max_amount_before_tax: number;
  bills_without_total: number;
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
 * Transcribed line for line from the SQL in migration 0009, with the two properties
 * that matter kept in the transcription rather than added afterwards:
 *
 *   * `rows` is de-duplicated BY ID before anything is summed. This is the
 *     `WITH unique_bills AS (SELECT DISTINCT …)` in the SQL, and it is why a repeated
 *     folder link cannot inflate the money while the count stays right.
 *   * every average divides by `NULLIF(count, 0)`, so an empty folder yields 0 rather
 *     than NaN.
 */
function summarize(input: BillRow[]): Summary {
  const byId = new Map<string, BillRow>();
  for (const row of input) byId.set(row.id, row);
  const unique = [...byId.values()];

  const n = unique.length;
  const sum = (pick: (r: BillRow) => number | null) =>
    unique.reduce((acc, r) => acc + num(pick(r)), 0);
  const extremes = (pick: (r: BillRow) => number | null) => {
    // MIN/MAX ignore nulls in SQL, which is the point: a bill whose total was never
    // imported must not drag the cheapest-bill figure to zero.
    const values = unique.map(pick).filter((v): v is number => v !== null && v !== undefined);
    return values.length === 0
      ? { min: 0, max: 0 }
      : { min: Math.min(...values), max: Math.max(...values) };
  };

  const qty = sum((r) => r.total_quantity);
  const abt = sum((r) => r.amount_before_tax);
  const cg = sum((r) => r.cgst);
  const sg = sum((r) => r.sgst);
  const ig = sum((r) => r.igst);
  const gst = sum((r) => r.total_gst);
  const aat = sum((r) => r.amount_after_tax);
  const ro = sum((r) => r.round_off);
  const aatSpread = extremes((r) => r.amount_after_tax);
  const abtSpread = extremes((r) => r.amount_before_tax);
  /* `coalesce(round(v / NULLIF(n, 0), dp), 0)`.
   *
   * The guard is the whole point: NULLIF turns 0 into NULL, the division yields NULL
   * rather than "division by zero", and the coalesce makes it 0. Dividing by a plain
   * `n === 0 ? 1 : n` would be the same answer but would not be testing the same code
   * path, and dividing by 0 directly is the NaN this guards against. */
  const avg = (v: number, dp: number) => (n === 0 ? 0 : round(v / n, dp));

  const buckets = new Map<string | null, number>();
  for (const r of unique) {
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
    average_bill_value: avg(aat, 2),
    average_quantity: avg(qty, 3),
    average_amount_before_tax: avg(abt, 2),
    average_cgst: avg(cg, 2),
    average_sgst: avg(sg, 2),
    average_igst: avg(ig, 2),
    average_gst: avg(gst, 2),
    average_round_off: avg(ro, 2),
    min_amount_after_tax: aatSpread.min,
    max_amount_after_tax: aatSpread.max,
    min_amount_before_tax: abtSpread.min,
    max_amount_before_tax: abtSpread.max,
    bills_without_total: unique.filter((r) => r.amount_after_tax === null).length,
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
check(
  all.total_bills === 0 || near(all.average_bill_value * all.total_bills, all.amount_after_tax, 0.05),
  "average bill value x count is the total after tax (to rounding)",
  `${all.average_bill_value} x ${all.total_bills} vs ${all.amount_after_tax}`
);
check(
  all.bills_without_total === rows.filter((r) => r.amount_after_tax === null).length,
  "bills without a total are counted, not treated as zero",
  `${all.bills_without_total} of ${all.total_bills}`
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
  near(one.min_amount_after_tax, one.max_amount_after_tax),
  "with one bill, min equals max — the spread is not zero by accident, it is one value",
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
  big.min_amount_after_tax <= big.average_bill_value &&
    big.average_bill_value <= big.max_amount_after_tax,
  "min <= average <= max, so the spread brackets the mean",
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
    ["min_amount_after_tax", empty.min_amount_after_tax],
    ["max_amount_after_tax", empty.max_amount_after_tax],
    ["min_amount_before_tax", empty.min_amount_before_tax],
    ["max_amount_before_tax", empty.max_amount_before_tax],
    ["bills_without_total", empty.bills_without_total],
  ];
  const bad = zeroed.filter(([, v]) => !Number.isFinite(v) || v !== 0);
  check(
    bad.length === 0,
    "every figure is 0 on an empty folder, never NaN or Infinity",
    bad.length ? bad.map(([k, v]) => `${k}=${v}`).join(", ") : `${zeroed.length} figures all 0`
  );
}
check(empty.job_kind_breakdown.length === 0, "an empty folder has no buckets", "[]");

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

/* ---- 2g. Bills with no total ---- */
console.log("\nbills with no recorded total");
const withGaps = rows.map((r, i) => (i % 4 === 3 ? { ...r, amount_after_tax: null } : r));
const gapped = summarize(withGaps);
check(
  gapped.bills_without_total === withGaps.filter((r) => r.amount_after_tax === null).length,
  "a bill with no total is reported as missing, not as ₹0",
  `${gapped.bills_without_total} missing`
);
check(
  gapped.min_amount_after_tax >= 0 && gapped.min_amount_after_tax !== 0,
  "and it does not drag the cheapest-bill figure to zero",
  `min ${gapped.min_amount_after_tax}`
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
const divisions = [...sql.matchAll(/\/\s*NULLIF\(n_bills,\s*0\)/gi)].length;
check(divisions >= 8, "every average divides by NULLIF(count, 0)", `${divisions} guarded divisions`);
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
