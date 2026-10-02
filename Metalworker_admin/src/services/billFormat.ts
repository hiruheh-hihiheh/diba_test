// src/services/billFormat.ts
//
// How a bill figure is written down. Pure, dependency-free, platform-agnostic.
//
// WHY IT IS NOT IN services/bills.ts
// It was. Two things needed it from outside a React Native module:
//   * the folder summary export (Phase 4), whose figures must be byte-identical to
//     the on-screen ones — that guarantee is only real if the export calls THESE
//     functions rather than a second copy of them, and
//   * a Node self-test that compares the exported figures against the summary.
//     A test cannot import a module that pulls in react-native and the Supabase
//     client, so a test over a copy of these functions would verify the copy.
//
// services/bills.ts re-exports every name below, so the ~30 call sites that already
// import formatMoney from there keep working untouched.
//
// This module performs NO financial arithmetic. Every value it is given has already
// been computed by get_folder_bill_summary (migration 0010); this only decides how a
// number is spelled, and renders a missing one as an em dash rather than a zero.

/**
 * Indian digit grouping without `Intl`.
 *
 * `Number.prototype.toLocaleString("en-IN", …)` is correct but not dependable on
 * every Hermes build: a reduced ICU silently falls back to `en-US` grouping, so
 * 15,635 would render as 15.635 on one phone and 15,635 on another. Grouping the
 * last three digits and then pairs is a few lines and always identical, on every
 * platform, which the two clients also need for their figures to match.
 */
export function groupIndianInteger(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, digits.length - 3);
  const tail = digits.slice(digits.length - 3);
  let out = "";
  for (let i = head.length; i > 0; i -= 2) {
    out = head.slice(Math.max(0, i - 2), i) + out;
    if (i - 2 > 0) out = "," + out;
  }
  return `${out},${tail}`;
}

/**
 * Coerce a value that arrived over the wire into a finite number, or `null`.
 *
 * Takes `unknown` on purpose. `numeric` columns come back from PostgREST as strings,
 * but the values read from a `jsonb` array (the folder's job-kind breakdown) are
 * whatever shape that jsonb holds, and `unknown` at the signature is what forces each
 * caller to decide. A narrow signature here only pushes a cast to the call site.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Money with Indian digit grouping and two decimals, and never "₹NaN".
 *
 * `numeric` columns arrive as strings over PostgREST, so every value is coerced
 * first. A non-finite value is an em dash, which is what "not recorded" looks
 * like everywhere else in the app.
 */
export function formatMoney(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n === null) return "—";
  const negative = n < 0;
  const abs = Math.abs(n).toFixed(2);
  const [whole, frac] = abs.split(".");
  return `${negative ? "-" : ""}₹${groupIndianInteger(whole)}.${frac}`;
}

/** Quantity: up to 3 decimals, trailing zeros dropped (1 stays "1", not "1.000"). */
export function formatQuantity(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const whole = Math.floor(abs).toString();
  const frac = (abs - Math.floor(abs)).toFixed(3).slice(2).replace(/0+$/, "");
  const sign = n < 0 ? "-" : "";
  return frac ? `${sign}${groupIndianInteger(whole)}.${frac}` : `${sign}${groupIndianInteger(whole)}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2026-09-06` -> `06 Sep 2026`, built without `Intl` for the same reason. */
export function formatBillDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, y, m, d] = match;
    return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The job classification, as a label a person can read.
 *
 * WHY THIS EXISTS
 * `bills.job_kind` stores what the source workbook actually said, verbatim, so
 * the database never loses the original. But the workbook is hand-written and the
 * same classification arrives spelled several ways — "LABOUR JOB", "LABOUR",
 * "WITHMETAL", "WITH METAL", "with  material", and once "WITH_METAL" — and
 * "WITHMETAL" is not something to show an operator or print on an invoice. So the
 * stored value stays raw and only the DISPLAY is normalized, here, once, for both
 * the list and the detail view. The PDF renderer has its own copy in
 * `supabase/functions/process-bill-upload/_shared/formatJobKind.ts` because that
 * module is a separate Deno compilation target; the two implementations are
 * identical and deliberately so.
 *
 * This is NOT a second job-type system. It maps a string to a presentable string
 * and nothing else. It never infers the classification from the invoice number,
 * the sheet name, an amount or a description — an invoice that never declared a
 * job type shows nothing, because guessing "LABOUR JOB" onto it would be a
 * fabricated financial classification.
 *
 * Returns `null` when there is nothing to show, so callers can omit the element
 * instead of printing an empty pill.
 */
export function formatJobKind(jobKind: string | null | undefined): string | null {
  if (jobKind === null || jobKind === undefined) return null;

  // Collapse whitespace runs (some templates use tabs) and trim.
  const cleaned = String(jobKind).replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;

  /* Match on a "squashed" key — uppercase, alphanumerics only — so case, spacing,
     hyphens and underscores cannot change the answer. Same trick the field parser
     uses for labels. */
  const key = cleaned.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (key === "LABOURJOB" || key === "LABOUR") return "LABOUR JOB";
  if (key === "WITHMETAL" || key === "WITHMATERIAL") return "WITH METAL";

  /* Unrecognised but non-empty: clean separators and title-case, so an unknown
     classification is visible and readable rather than silently discarded. */
  return cleaned
    .replace(/[_-]+/g, " ")
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}
