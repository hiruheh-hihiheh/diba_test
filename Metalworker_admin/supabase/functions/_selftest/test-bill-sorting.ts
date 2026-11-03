// test-bill-sorting.ts — the ordering behind the two Billing sort checkboxes.
//
// WHAT THIS CAN AND CANNOT PROVE
//
// These are unit tests of the pure model plus source assertions on the call sites.
// They run in Node with no database, so they prove the comparator, the page slice and
// the checkbox rule are correct, and that both screens and both services USE them.
// They do not prove a particular PostgREST response is ordered correctly — that needs
// a live database, and is checked by using the screen.
//
// The document-number cases are the point of the exercise: `2, 3, 10, 20, 100` in that
// order, INV-9 before INV-10, leading zeros, missing numbers last, and duplicates
// resolved deterministically so a selection never points at the wrong row after a page
// change.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  billSortHelp,
  compareBills,
  describeBillSort,
  naturalCompare,
  nextSortMode,
  sliceBillPage,
  sortBillRows,
  type SortableBillRow,
} from "../../../src/services/billSorting.ts";
import {
  formatUploadDate,
  isExcelUpload,
  readAllPages,
  summarizeBilling,
  summarizeUploads,
} from "../../../src/services/billingOverview.ts";

const REPO = resolve(import.meta.dirname, "../../../..");

let failures = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}
function readFile(path: string): string {
  return readFileSync(resolve(REPO, path), "utf8");
}
function numbers(rows: SortableBillRow[]): string[] {
  return rows.map((r) => r.invoice_no ?? "");
}
function ids(rows: SortableBillRow[]): string[] {
  return rows.map((r) => r.id);
}

function bill(
  id: string,
  invoice_no: string | null,
  upload = "2026-10-01T00:00:00Z",
  created = "2026-10-02T00:00:00Z"
): SortableBillRow {
  return { id, invoice_no, upload_created_at: upload, created_at: created };
}

/* ──────────────────────────────────────────────
   A. Natural comparison
   ────────────────────────────────────────────── */

section("A. document numbers compare as numbers, not as text");

{
  check(
    JSON.stringify(["100", "20", "3", "10", "2"].sort(naturalCompare)) ===
      JSON.stringify(["2", "3", "10", "20", "100"]),
    "2, 3, 10, 20, 100 — not 100 before 20"
  );
  check(
    JSON.stringify(["369", "367", "368"].sort(naturalCompare)) ===
      JSON.stringify(["367", "368", "369"]),
    "367, 368, 369"
  );
  check(
    JSON.stringify(["INV-100", "INV-9", "INV-10"].sort(naturalCompare)) ===
      JSON.stringify(["INV-9", "INV-10", "INV-100"]),
    "INV-9, INV-10, INV-100 — the prefix does not defeat the number"
  );
  check(
    JSON.stringify(["007", "7", "10"].sort(naturalCompare)) === JSON.stringify(["7", "007", "10"]),
    "leading zeros: 007 is seven, so it stays before 10",
    ["007", "7", "10"].sort(naturalCompare).join(",")
  );
  check(
    naturalCompare("inv-2", "INV-10") < 0,
    "text compared case-insensitively, digits still by value"
  );
  check(naturalCompare("A", "a") !== 0, "two different strings never compare equal");
  check(naturalCompare("INV-1", "INV-10") < 0, "a longer number sharing a prefix sorts after it");
  check(naturalCompare("5", "5") === 0, "the same string compares equal");
}

/* ──────────────────────────────────────────────
   B. Sort by document number
   ────────────────────────────────────────────── */

section("B. sort by document number, missing last, duplicates deterministic");

{
  const rows = [
    bill("f", null),
    bill("c", "10"),
    bill("a", "2"),
    bill("e", "100"),
    bill("b", "3"),
    bill("d", "20"),
    bill("g", "  "),
  ];
  const sorted = sortBillRows(rows, "document_number");
  check(
    JSON.stringify(numbers(sorted).slice(0, 5)) === JSON.stringify(["2", "3", "10", "20", "100"]),
    "numbered bills ascend numerically",
    numbers(sorted).join(",")
  );
  check(numbers(sorted).slice(5).every((n) => n.trim() === ""), "missing/blank numbers go last");

  const duplicates = [
    bill("late", "367", "2026-10-05T00:00:00Z"),
    bill("early", "367", "2026-10-01T00:00:00Z"),
    bill("same-a", "367", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
    bill("same-b", "367", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
  ];
  const forward = ids(sortBillRows(duplicates, "document_number")).join(",");
  const backward = ids(sortBillRows([...duplicates].reverse(), "document_number")).join(",");
  check(forward === "early,same-a,same-b,late", "equal numbers: earliest upload first", forward);
  check(forward === backward, "and the same order whichever way the rows arrive", backward);
  const total = [bill("x", "367"), bill("y", "367"), bill("z", null)];
  check(
    total.every((a, i) => total.every((b, j) => i === j || compareBills(a, b, "document_number") !== 0)),
    "the ordering is total: no two distinct rows are left unordered"
  );
}

/* ──────────────────────────────────────────────
   C. Sort by Excel upload date
   ────────────────────────────────────────────── */

section("C. sort by Excel upload date, oldest first");

{
  const rows = [
    bill("dec", "1", "2026-12-01T00:00:00Z"),
    bill("oct", "1", "2026-10-01T00:00:00Z"),
    bill("nov", "1", "2026-11-01T00:00:00Z"),
  ];
  check(
    ids(sortBillRows(rows, "upload_date")).join(",") === "oct,nov,dec",
    "older uploads first, newer last"
  );

  const sameWorkbook = [
    bill("ten", "10", "2026-10-01T00:00:00Z"),
    bill("two", "2", "2026-10-01T00:00:00Z"),
    bill("one", "1", "2026-10-01T00:00:00Z"),
  ];
  check(
    ids(sortBillRows(sameWorkbook, "upload_date")).join(",") === "one,two,ten",
    "bills from the same workbook stay grouped and are numbered within it"
  );

  const tie = [
    bill("b", "5", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
    bill("a", "5", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
    bill("c", "5", "2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z"),
  ];
  check(
    ids(sortBillRows(tie, "upload_date")).join(",") === "a,b,c",
    "equal timestamps fall back to creation time, then id"
  );

  check(
    ids(sortBillRows([bill("none", "1", null as unknown as string), bill("some", "2")], "upload_date"))[0] ===
      "some",
    "a bill with no known upload date goes last"
  );

  const invoiceDates = [
    { ...bill("old-upload-new-invoice", "1", "2026-10-01T00:00:00Z"), invoice_date: "2026-12-31" },
    { ...bill("new-upload-old-invoice", "2", "2026-12-01T00:00:00Z"), invoice_date: "2026-01-01" },
  ] as (SortableBillRow & { invoice_date: string })[];
  check(
    ids(sortBillRows(invoiceDates, "upload_date")).join(",") ===
      "old-upload-new-invoice,new-upload-old-invoice",
    "the upload timestamp decides, NOT invoice_date"
  );
}

/* ──────────────────────────────────────────────
   D. Checkbox behaviour
   ────────────────────────────────────────────── */

section("D. one sorting mode at a time");

{
  check(nextSortMode("default", "document_number") === "document_number", "numeric checkbox activates");
  check(nextSortMode("default", "upload_date") === "upload_date", "date checkbox activates");
  check(
    nextSortMode("document_number", "upload_date") === "upload_date",
    "date checkbox turns the numeric sort off"
  );
  check(
    nextSortMode("upload_date", "document_number") === "document_number",
    "numeric checkbox turns the date sort off"
  );
  check(nextSortMode("document_number", "document_number") === "default", "unticking restores default");
  check(nextSortMode("upload_date", "upload_date") === "default", "unticking date restores default");
  check(describeBillSort("default") === "Newest first", "the default order is described as it is");
  check(/Oldest/i.test(describeBillSort("upload_date")), "the active mode is named for the user");
}

/* ──────────────────────────────────────────────
   E. Pagination across pages
   ────────────────────────────────────────────── */

section("E. the order is over the whole set, not one page");

{
  const rows = Array.from({ length: 45 }, (_, i) => bill(`id-${i + 1}`, String(45 - i)));
  const ordered = sortBillRows(rows, "document_number");
  check(numbers(ordered)[0] === "1" && numbers(ordered)[44] === "45", "all 45 ordered 1…45");

  const page1 = sliceBillPage(ordered, 1, 20);
  const page2 = sliceBillPage(ordered, 2, 20);
  const page3 = sliceBillPage(ordered, 3, 20);
  check(numbers(page1)[0] === "1" && numbers(page1)[19] === "20", "page 1 is 1–20");
  check(numbers(page2)[0] === "21" && numbers(page2)[19] === "40", "page 2 continues at 21");
  check(numbers(page3).join(",") === "41,42,43,44,45", "page 3 finishes the set");
  check(page2[0].id === ordered[20].id, "page 2 starts exactly where page 1 stopped");

  const defaultOrder = sortBillRows(rows, "default");
  check(
    defaultOrder[0].id === rows[0].id && defaultOrder[44].id === rows[44].id,
    "the default mode preserves the list's own order"
  );
  check(sliceBillPage(ordered, 99, 20).length === 0, "a page past the end is empty, not wrapped");
  check(sliceBillPage(ordered, 0, 20)[0].id === ordered[0].id, "page numbers below 1 are clamped");
}

/* ──────────────────────────────────────────────
   F. Document-type separation and the overview counts
   ────────────────────────────────────────────── */

section("F. tax invoices and challans are counted and sorted separately");

{
  const tax = summarizeBilling({ workbooks: 2, latestUpload: "2026-10-05T00:00:00Z" }, 7);
  const challan = summarizeBilling({ workbooks: 1, latestUpload: "2026-09-01T00:00:00Z" }, 3);
  check(tax.workbooks === 2 && tax.bills === 7, "tax card counts only what it was given");
  check(challan.workbooks === 1 && challan.bills === 3, "challan card counts only what it was given");
  check(tax.latestUpload === "2026-10-05T00:00:00Z", "latest upload is the newest timestamp");
  check(summarizeBilling({ workbooks: 0, latestUpload: null }, 0).bills === 0, "an empty section reads zero, not blank");
  check(summarizeBilling({ workbooks: Number.NaN, latestUpload: null }, -4).bills === 0, "unreadable data cannot produce a negative or NaN count");
  check(formatUploadDate(null) === "—", "a missing upload date is a dash");
  check(/Oct 2026/.test(formatUploadDate("2026-10-05T00:00:00Z")), "an upload date is printed readably");

  /* Both services order through the same module and keep the section's type. */
  for (const [name, path] of [
    ["admin", "Metalworker_admin/src/services/bills.ts"],
    ["desktop", "Metalworker_desktop/src/services/bills.ts"],
  ] as const) {
    const service = readFile(path);
    check(
      service.includes('if ((query.sort ?? "default") !== "default")'),
      `${name}: fetchBills routes the two sort modes before paginating`
    );
    check(
      /sort: "default",\s*\n\s*page: chunkPage,/.test(service),
      `${name}: the scan reuses fetchBills, so every filter is the list's own`
    );
    check(
      /export async function fetchBillUploadSummary\([\s\S]{0,400}?\.eq\("document_type", documentType\)/.test(
        service
      ),
      `${name}: Excel workbooks are counted for this section's document type only`
    );
    check(
      /fetchUploadTimeMetadata\(documentType\)/.test(service),
      `${name}: sorting reads upload provenance and timestamps, not the bill's own date`
    );
    check(
      /creation_source !== "manual"/.test(service),
      `${name}: manual upload rows are identified by provenance, not by filename`
    );
    check(
      /\.order\("id", \{ ascending: true \}\)/.test(service),
      `${name}: paging and scanning have a unique final ordering key`
    );
    check(
      /\.eq\("document_type", query\.documentType \?\? "tax_invoice"\)/.test(service),
      `${name}: the bill query is still confined to one document type`
    );
  }

  for (const [name, path] of [
    ["desktop", "Metalworker_desktop/src/pages/Bills.tsx"],
    ["mobile", "Metalworker_admin/src/components/bills/BillsScreen.tsx"],
  ] as const) {
    const screen = readFile(path);
    check(/sort: sortMode/.test(screen), `${name}: the screen sends its chosen ordering`);
    check(
      /nextSortMode\(current,/.test(screen) &&
        /"document_number"/.test(screen) &&
        /"upload_date"/.test(screen),
      `${name}: both checkboxes go through the shared exclusive-mode rule`
    );
    check(
      /setSortMode\(/.test(screen) && /setPage\(1\)/.test(screen),
      `${name}: changing the order returns to page 1`
    );
    check(
      /documentType=\{documentType\}|documentType,/.test(screen),
      `${name}: the ordering request carries the section's document type`
    );
  }
}

/* ──────────────────────────────────────────────
   G. Billing Overview and the routes that must survive
   ────────────────────────────────────────────── */

section("G. the Billing overview chooses between two unchanged sections");

{
  const app = readFile("Metalworker_desktop/src/App.tsx");
  check(/path="\/billing"/.test(app), "desktop has a /billing route");
  check(/path="\/bills"/.test(app), "desktop /bills still works");
  check(/path="\/challan-bills"/.test(app), "desktop /challan-bills still works");

  const mobileRoute = readFile("Metalworker_admin/src/app/billing.tsx");
  check(/BillingOverviewScreen/.test(mobileRoute), "mobile has a /billing route file");
  check(
    readFile("Metalworker_admin/src/app/bills.tsx").includes('documentType="tax_invoice"'),
    "mobile /bills still mounts the Tax Bills section"
  );
  check(
    readFile("Metalworker_admin/src/app/challan-bills.tsx").includes('documentType="delivery_challan"'),
    "mobile /challan-bills still mounts the Challan section"
  );

  const nav = readFile("Metalworker_admin/src/navigation/navigationConfig.ts");
  check(/label: "Billing"/.test(nav) && /route: "\/billing"/.test(nav), "the Billing tab opens the overview");
  check(/activeRoutes: \["\/billing", "\/bills", "\/challan-bills"/.test(nav), "both sections keep the tab lit");
  check(/ROUTE_TITLES[\s\S]*"\/billing": "Billing Overview"/.test(nav), "the header names the page");
  check(
    readFile("Metalworker_admin/src/components/shell/AdminShell.tsx").includes('navigateTo("/billing")'),
    "the bottom tab lands on the overview"
  );

  const sidebar = readFile("Metalworker_desktop/src/components/layout/Sidebar.tsx");
  check(sidebar.includes('path: "/billing"'), "desktop sidebar has one Billing entry");
  check(!sidebar.includes('path: "/challan-bills"'), "and no longer lists the sections separately");

  const desktopOverview = readFile("Metalworker_desktop/src/pages/BillingOverview.tsx");
  const mobileOverview = readFile("Metalworker_admin/src/components/bills/BillingOverviewScreen.tsx");
  for (const [name, source] of [
    ["desktop", desktopOverview],
    ["mobile", mobileOverview],
  ] as const) {
    check(
      /fetchBillUploadSummary\(type\)/.test(source),
      `${name} overview asks for one type's Excel workbooks`
    );
    check(/fetchBills\(\{ documentType: type/.test(source), `${name} overview counts one type's records`);
    check(
      !/fetchBillDocumentsByIds|downloadBillCopyBytes|fetchBillLineItems/.test(source),
      `${name} overview reads no PDFs, workbook bytes or line items`
    );
    check(/info\.route/.test(source), `${name} overview links through the document-type config`);
  }

  const adminSort = readFile("Metalworker_admin/src/services/billSorting.ts");
  const desktopSort = readFile("Metalworker_desktop/src/services/billSorting.ts");
  check(adminSort === desktopSort, "the two app copies of the comparator are byte-identical");
  const adminOverview = readFile("Metalworker_admin/src/services/billingOverview.ts");
  const desktopOverviewService = readFile("Metalworker_desktop/src/services/billingOverview.ts");
  check(adminOverview === desktopOverviewService, "and so are the two overview summaries");
}

/* ──────────────────────────────────────────────
   H. Manual bills are documents, not Excel workbooks
   ────────────────────────────────────────────── */

section("H. manual bills count as documents, never as Excel workbooks");

{
  check(isExcelUpload({ creation_source: "workbook" }), "a workbook row is an Excel upload");
  check(isExcelUpload({}), "an absent creation_source keeps the Excel-import behaviour");
  check(isExcelUpload({ creation_source: null }), "and so does an explicit null");
  check(!isExcelUpload({ creation_source: "manual" }), "a manual row is not an Excel workbook");

  const mixed = summarizeUploads([
    { created_at: "2026-10-01T00:00:00Z", creation_source: "workbook" },
    { created_at: "2026-12-31T00:00:00Z", creation_source: "manual" },
    { created_at: "2026-10-05T00:00:00Z", creation_source: "workbook" },
    { created_at: "2026-11-30T00:00:00Z" },
  ]);
  check(mixed.workbooks === 3, "manual rows are excluded from the workbook count", String(mixed.workbooks));
  check(
    mixed.latestUpload === "2026-11-30T00:00:00Z",
    "and the latest date is the newest WORKBOOK, not the newer manual row",
    String(mixed.latestUpload)
  );

  const manualOnly = summarizeUploads([
    { created_at: "2026-12-31T00:00:00Z", creation_source: "manual" },
  ]);
  check(
    manualOnly.workbooks === 0 && manualOnly.latestUpload === null,
    "a section of only manual bills has no workbook and no upload date"
  );

  check(
    summarizeBilling({ workbooks: 2, latestUpload: null }, 9).bills === 9,
    "manually created bills stay in the document count"
  );

  const rows = [
    bill("manual", "1", null as unknown as string),
    bill("excel-new", "2", "2026-12-01T00:00:00Z"),
    bill("excel-old", "3", "2026-10-01T00:00:00Z"),
  ];
  check(
    ids(sortBillRows(rows, "upload_date")).join(",") === "excel-old,excel-new,manual",
    "a manual bill sorts after every real Excel upload, even a newer one"
  );
  check(
    /manual/i.test(billSortHelp("upload_date")) && /Excel/.test(billSortHelp("upload_date")),
    "the helper text says manual bills have no Excel upload date"
  );
}

/* ──────────────────────────────────────────────
   I. Bounded paging
   ────────────────────────────────────────────── */

section("I. upload metadata is read completely, in bounded pages");

{
  const dataset = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
  const pagesRead: number[] = [];
  const rows = await readAllPages(async (page, pageSize) => {
    pagesRead.push(page);
    const start = (page - 1) * pageSize;
    return { rows: dataset.slice(start, start + pageSize), total: dataset.length };
  }, 5);
  check(rows.length === 12, "all 12 rows arrive, not the backend's first page", String(rows.length));
  check(new Set(rows.map((r) => r.id)).size === 12, "no row is returned twice");
  check(
    JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(dataset.map((r) => r.id)),
    "no row is skipped, and the order is the server's deterministic one"
  );
  check(pagesRead.join(",") === "1,2,3", "a partially filled last page ends the walk", pagesRead.join(","));

  let calls = 0;
  const exact = await readAllPages(async (page, pageSize) => {
    calls++;
    const start = (page - 1) * pageSize;
    return { rows: dataset.slice(0, 10).slice(start, start + pageSize), total: 10 };
  }, 5);
  check(
    exact.length === 10 && calls === 2,
    "an exact multiple of the page size stops on the reported total, with no empty request",
    `${exact.length} rows / ${calls} calls`
  );

  let emptyCalls = 0;
  const none = await readAllPages(async () => {
    emptyCalls++;
    return { rows: [], total: 0 };
  }, 5);
  check(none.length === 0 && emptyCalls === 1, "an empty section costs one request");

  let surfaced = false;
  try {
    await readAllPages(async () => {
      throw new Error("network down");
    }, 5);
  } catch (err) {
    surfaced = err instanceof Error && err.message === "network down";
  }
  check(surfaced, "a genuine error is surfaced rather than silently truncated");

  let capped = false;
  try {
    await readAllPages(async (_page, size) => ({ rows: dataset.slice(0, size) }), 5, 3);
  } catch {
    capped = true;
  }
  check(capped, "a server that ignores paging cannot loop forever");
}

console.log(
  failures === 0
    ? "\nBILL SORTING CHECKS: all passed."
    : `\nBILL SORTING CHECKS: ${failures} failure(s).`
);
process.exit(failures === 0 ? 0 : 1);
