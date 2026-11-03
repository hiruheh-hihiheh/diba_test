// src/services/billSorting.ts
//
// How the Billing lists order their records, as pure functions.
//
// WHY THIS IS SEPARATE FROM `bills.ts`
//
// The list is paginated in the database. Sorting the twenty rows that happen to be
// on screen is not sorting the list: with 1,000 bills, the smallest document number
// can be on page 40 and would stay there. The order therefore has to be decided over
// the whole filtered set before a page is cut from it, and the comparator that
// decides it must be the same in both apps. This module has no imports, so the two
// app copies can be kept byte-identical and the Node self-tests can load it directly.
//
// NUMBERS ARE NOT STRINGS
//
// `localeCompare` and `<` both put "100" before "20", and "INV-10" before "INV-9".
// Document numbers are a numbering series, so each run of digits is compared as a
// NUMBER and each run of text as text. Leading zeros ("007") parse to the same value
// as "7" and are separated deterministically afterwards, so they can never make a
// bill disappear by sorting inconsistently.

/** The ordering the user picked. `default` is the list's existing newest-first order. */
export type BillSortMode = "default" | "document_number" | "upload_date";

export const BILL_SORT_MODES: readonly BillSortMode[] = [
  "default",
  "document_number",
  "upload_date",
];

/** The two modes a checkbox can turn on. `default` is reached only by unticking. */
export type BillSortChoice = Exclude<BillSortMode, "default">;

/**
 * What the checkboxes do, in one place.
 *
 * The controls are mutually exclusive and the active one can be unticked, which
 * returns the list to its default order. Both screens call THIS, so "ticking the
 * other one turns this one off" cannot be implemented one way on a phone and another
 * way at a desk.
 */
export function nextSortMode(current: BillSortMode, clicked: BillSortChoice): BillSortMode {
  return current === clicked ? "default" : clicked;
}

/** The fields an ordering reads. Nothing financial is here. */
export interface SortableBillRow {
  id: string;
  /** The document number (`bills.invoice_no`), or null when the sheet had none. */
  invoice_no: string | null;
  /** `bills.created_at` — the row's own timestamp, used only as a tie-breaker. */
  created_at: string | null;
  /** `bill_uploads.created_at` — when the source workbook was uploaded. */
  upload_created_at: string | null;
}

/** Alternating runs of digits and non-digits: the units of a natural comparison. */
const RUNS = /(\d+|\D+)/g;

/**
 * Compare two document numbers the way a person reads a numbering series.
 *
 * "2" < "3" < "10" < "20" < "100"; "INV-9" < "INV-10" < "INV-100". Digits compare by
 * value, everything else compares case-insensitively, and a longer number that
 * shares a prefix ("INV-1" vs "INV-10") sorts after it. The result is never 0 for
 * two different strings, so the ordering is total.
 */
export function naturalCompare(a: string, b: string): number {
  const left = a.match(RUNS) ?? [];
  const right = b.match(RUNS) ?? [];
  const shared = Math.min(left.length, right.length);

  for (let i = 0; i < shared; i++) {
    const x = left[i];
    const y = right[i];
    if (x === y) continue;

    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);

    if (xNumeric && yNumeric) {
      const nx = Number(x);
      const ny = Number(y);
      if (nx !== ny) return nx < ny ? -1 : 1;
      /* Equal value, different spelling ("007" vs "7"). Shorter first is arbitrary
         but fixed, so two bills with those numbers never swap between pages. */
      if (x.length !== y.length) return x.length - y.length;
      return x < y ? -1 : 1;
    }

    /* A number before a letter at the same position ("INV-9" before "INV-A"), which
       keeps a partly-numeric series readable instead of interleaving it. */
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;

    const lx = x.toLowerCase();
    const ly = y.toLowerCase();
    if (lx !== ly) return lx < ly ? -1 : 1;
    /* Text that differs ONLY in case must not decide the order here: "inv-" vs "INV-"
       would otherwise settle "inv-2" against "INV-10" on letter case, before the
       digits ever get compared. Keep walking; a case-only difference is broken at the
       very end, and only when nothing else separates the two numbers. */
    continue;
  }

  if (left.length !== right.length) return left.length - right.length;
  /* A total order: two different strings never compare equal, so "A" and "a" cannot
     swap places between page requests. */
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** A stored timestamp in milliseconds, or null when absent/unreadable. */
function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The final, total tie-breaker: row creation time, then id.
 *
 * Two bills can legitimately share a document number (a re-issued invoice) and can
 * even share an upload timestamp. Without this they could swap places between page
 * requests, which would make a selection point at the wrong row.
 */
function tieBreak(a: SortableBillRow, b: SortableBillRow): number {
  const at = timeOf(a.created_at);
  const bt = timeOf(b.created_at);
  if (at !== null && bt !== null && at !== bt) return at - bt;
  if (at === null && bt !== null) return 1;
  if (bt === null && at !== null) return -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compare two bills under one sort mode.
 *
 * Document numbers that are missing sort LAST in both modes: a bill with no number
 * is not "smallest", it is unnumbered, and burying it at the end keeps the numbered
 * series readable while still showing the bill.
 */
export function compareBills(
  a: SortableBillRow,
  b: SortableBillRow,
  mode: BillSortMode
): number {
  if (mode === "default") return 0;

  const an = a.invoice_no?.trim() ?? "";
  const bn = b.invoice_no?.trim() ?? "";

  if (mode === "document_number") {
    if (an === "" && bn !== "") return 1;
    if (bn === "" && an !== "") return -1;
    if (an !== "" && bn !== "") {
      const byNumber = naturalCompare(an, bn);
      if (byNumber !== 0) return byNumber;
    }
    /* Equal numbers: the brief's order is upload timestamp, then bill creation time,
       then id. A missing upload timestamp goes last. */
    const au = timeOf(a.upload_created_at);
    const bu = timeOf(b.upload_created_at);
    if (au !== null && bu !== null && au !== bu) return au - bu;
    if (au === null && bu !== null) return 1;
    if (bu === null && au !== null) return -1;
    return tieBreak(a, b);
  }

  /* mode === "upload_date": the workbook's upload time, oldest first. This is
     deliberately NOT invoice_date and NOT the bill's own created_at — the user asked
     for when the Excel file arrived. Bills from one workbook share the timestamp, so
     the document number orders them within it. */
  const au = timeOf(a.upload_created_at);
  const bu = timeOf(b.upload_created_at);
  if (au !== null && bu !== null && au !== bu) return au - bu;
  if (au === null && bu !== null) return 1;
  if (bu === null && au !== null) return -1;

  if (an === "" && bn !== "") return 1;
  if (bn === "" && an !== "") return -1;
  if (an !== "" && bn !== "") {
    const byNumber = naturalCompare(an, bn);
    if (byNumber !== 0) return byNumber;
  }
  return tieBreak(a, b);
}

/**
 * A sorted COPY of the rows. The input is never reordered in place: the caller may
 * still be holding it as state, and sorting somebody else's array is the kind of
 * surprise that shows up as a row jumping in an unrelated list.
 */
export function sortBillRows<T extends SortableBillRow>(
  rows: readonly T[],
  mode: BillSortMode
): T[] {
  if (mode === "default") return [...rows];
  return [...rows].sort((a, b) => compareBills(a, b, mode));
}

/**
 * The page to show, cut from the already-ordered list.
 *
 * This is the step that makes the sort correct ACROSS pages: page 2 is whatever
 * follows page 1 in the ordered list, not the second block of the database's own
 * order. Out-of-range pages are empty, which the screens already render as an empty
 * list once their own clamping runs.
 */
export function sliceBillPage<T>(ordered: readonly T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, Math.floor(Number(pageSize)) || 1);
  const index = Math.max(1, Math.floor(Number(page)) || 1);
  const start = (index - 1) * size;
  return ordered.slice(start, start + size);
}

/** One line describing the active ordering, for the control's own label. */
export function describeBillSort(mode: BillSortMode): string {
  if (mode === "document_number") return "Document number, ascending";
  if (mode === "upload_date") return "Excel upload date, oldest first";
  return "Newest first";
}
