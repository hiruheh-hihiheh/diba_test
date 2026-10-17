// supabase/functions/_selftest/test-bulk-zip.ts
//
// Proves "Download ZIP" packs exactly the right documents into one valid archive.
//
// THE RISK THIS TEST EXISTS FOR
// A bulk download is the one action that can quietly hand a user the WRONG set of
// invoices: a copy that was silently skipped, a bill dropped to fit a limit so the
// count "looks right", an invoice twice because two sheets share a number, or a ZIP
// that is a valid file containing nothing. None of those raise an error; they just
// produce a plausible archive. So every check here is about the SHAPE and the
// CONTENTS of what leaves the app, not about the UI.
//
// It imports the REAL modules (`bulkBillZip`, `billDocument`) rather than
// transcribing them, builds REAL archives with `fflate`, and reads them back with
// `unzipSync` — so "the ZIP is valid" is proved by a ZIP reader, not by eyeballing
// bytes. It also imports the DESKTOP copy of the same module and requires identical
// results, because the two files are meant to be the same decision in two places.
//
//   node supabase/functions/_selftest/test-bulk-zip.ts
//
// The one case a machine cannot run is the Android share sheet; the last section
// asserts the decisions that feed it and says plainly what is left unverified.

import { unzipSync, strFromU8 } from "fflate";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BULK_ZIP_LIMITS,
  bulkZipArchiveName,
  buildBulkZip,
  planBulkZip,
  summarizeBulkZipShortfall,
  type BulkZipBill,
  type BulkZipEntry,
  type BulkZipOutcome,
  type BulkZipPlan,
} from "../../../src/services/bulkBillZip.ts";
import { billDocumentFilename } from "../../../src/services/billDocument.ts";
import { BILL_COPIES, type BillCopy } from "../../../src/types/bill.ts";

const APP = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const REPO = resolve(APP, "..");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}`);

/* ──────────────────────────────────────────────
   Fixtures
   ────────────────────────────────────────────── */

const utf8 = new TextEncoder();
const pdf = (seed: string): Uint8Array => utf8.encode(`%PDF-1.4\n% ${seed}\n%%EOF\n`);

const bytesEqual = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * A `bills` row reduced the way `fetchBillDocumentsByIds` returns one.
 *
 * The defaults are laid down first and the caller's fields are spread over them, so
 * an explicit `null` path (a copy that was never generated — the case most of these
 * tests turn on) is honoured rather than replaced by a default.
 */
function bill(over: Partial<BulkZipBill> & { id: string }): BulkZipBill {
  const base: BulkZipBill = {
    id: over.id,
    invoice_no: `INV/${over.id}`,
    sheet_name: `Sheet ${over.id}`,
    original_pdf_path: `bills/${over.id}/original.pdf`,
    duplicate_pdf_path: null,
    triplicate_pdf_path: null,
  };
  return { ...base, ...over };
}

/** A bill carrying all three copies. */
const fullBill = (id: string, over: Partial<BulkZipBill> = {}): BulkZipBill =>
  bill({
    id,
    duplicate_pdf_path: `bills/${id}/duplicate.pdf`,
    triplicate_pdf_path: `bills/${id}/triplicate.pdf`,
    ...over,
  });

/** A bill uploaded before per-bill documents existed: no paths at all. */
const legacyBill = (id: string): BulkZipBill =>
  bill({ id, original_pdf_path: null, duplicate_pdf_path: null, triplicate_pdf_path: null });

/** Bytes are derived from the storage path, so the archive can be compared against
    exactly what was requested with no separate expected-content table. */
const downloadFrom = (entries: BulkZipEntry[]) => {
  const byPath = new Map(entries.map((e) => [e.path, pdf(e.path)]));
  return async (path: string): Promise<Uint8Array> => {
    const bytes = byPath.get(path);
    if (!bytes) throw new Error(`No fixture for ${path}`);
    return bytes;
  };
};

/** A local-midday date, so `getFullYear/Month/Date` name the same day in every zone. */
const LOCAL_DAY = new Date(2026, 9, 17, 12, 0, 0);

/** Every plan satisfies: everything requested is either an entry or a named skip. */
function checkPartition(plan: BulkZipPlan, label: string) {
  check(
    plan.entries.length + plan.skipped.length === plan.requested,
    `[${label}] every requested PDF is either an entry or a named skip`,
    `${plan.entries.length} + ${plan.skipped.length} = ${plan.requested}`
  );
  const names = plan.entries.map((e) => e.filename);
  check(new Set(names).size === names.length, `[${label}] no entry shares a filename`);
}

/** Plan, build, and read the archive back with a real ZIP reader. */
async function run(
  plan: BulkZipPlan,
  opts: { download?: (path: string) => Promise<Uint8Array>; concurrency?: number; maxInputBytes?: number } = {}
) {
  const outcome = await buildBulkZip(plan, {
    download: opts.download ?? downloadFrom(plan.entries),
    ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    ...(opts.maxInputBytes !== undefined ? { maxInputBytes: opts.maxInputBytes } : {}),
  });
  return { outcome, members: unzipSync(outcome.bytes) };
}

/** The bytes the archive should hold for a given outcome, by member name. */
function expectedMembers(plan: BulkZipPlan, outcome: BulkZipOutcome, members: Record<string, Uint8Array>) {
  const byName = new Map(plan.entries.map((e) => [e.filename, pdf(e.path)]));
  for (const member of outcome.included) {
    check(
      bytesEqual(members[member.filename], byName.get(member.filename)),
      `member "${member.filename}" holds exactly the stored document`
    );
  }
}

/* ──────────────────────────────────────────────
   The archive is named for what it holds
   ────────────────────────────────────────────── */

section("the archive is named for what it holds");

check(
  bulkZipArchiveName(["original"], LOCAL_DAY) === "selected_bills_original_2026-10-17.zip",
  "one copy is named after itself",
  bulkZipArchiveName(["original"], LOCAL_DAY)
);
check(
  bulkZipArchiveName(["duplicate"], LOCAL_DAY) === "selected_bills_duplicate_2026-10-17.zip",
  "duplicate-only is named for the duplicate"
);
check(
  bulkZipArchiveName(["triplicate"], LOCAL_DAY) === "selected_bills_triplicate_2026-10-17.zip",
  "triplicate-only is named for the triplicate"
);
check(
  bulkZipArchiveName(["triplicate", "duplicate", "original"], LOCAL_DAY) ===
    "selected_bills_all_copies_2026-10-17.zip",
  "all three read as all_copies, not three words"
);
check(
  bulkZipArchiveName(["triplicate", "original"], LOCAL_DAY) ===
    "selected_bills_original_triplicate_2026-10-17.zip",
  "a partial mix lists the copies in PRINT order, not in tick order"
);

/* ──────────────────────────────────────────────
   Cases 1-5: which copies go in
   ────────────────────────────────────────────── */

section("1. one bill, ORIGINAL");
{
  const bills = [bill({ id: "b1", invoice_no: "FIX/301/2026-27" })];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  checkPartition(plan, "one/original");
  check(plan.entries.length === 1, "one entry", String(plan.entries.length));
  check(
    plan.entries[0].filename === "FIX_301_2026-27_original.pdf",
    "the member is named from the bill, not the workbook",
    plan.entries[0].filename
  );
  const { outcome, members } = await run(plan);
  check(Object.keys(members).length === 1, "the archive holds exactly one member");
  check(
    strFromU8(members["FIX_301_2026-27_original.pdf"]).startsWith("%PDF-"),
    "the member is the stored PDF, byte for byte"
  );
  expectedMembers(plan, outcome, members);
}

section("2-5. several bills, one or all copies");
for (const copies of [["original"], ["duplicate"], ["triplicate"]] as BillCopy[][]) {
  const bills = [
    bill({ id: "a" }),
    bill({ id: "b" }),
    bill({ id: "c" }),
  ].map((b) => (copies[0] === "original" ? b : fullBill(b.id, { invoice_no: b.invoice_no, sheet_name: b.sheet_name })));
  const plan = planBulkZip(bills, copies, LOCAL_DAY);
  checkPartition(plan, `${copies[0]} x3`);
  check(plan.entries.length === 3, `[${copies[0]} x3] three entries`, String(plan.entries.length));
  const { outcome, members } = await run(plan);
  check(Object.keys(members).length === 3, `[${copies[0]} x3] three members`);
  check(
    outcome.included.every((e) => e.copy === copies[0]),
    `[${copies[0]} x3] every member is the requested copy`
  );
  expectedMembers(plan, outcome, members);
}

{
  const bills = [fullBill("x"), fullBill("y")];
  const plan = planBulkZip(bills, BILL_COPIES, LOCAL_DAY);
  checkPartition(plan, "all three x2");
  check(plan.entries.length === 6, "two bills x three copies = six entries", String(plan.entries.length));
  check(
    plan.entries.map((e) => `${e.billId}:${e.copy}`).join(",") ===
      "x:original,x:duplicate,x:triplicate,y:original,y:duplicate,y:triplicate",
    "copies are ordered original, duplicate, triplicate within each bill",
    plan.entries.map((e) => e.copy).join(",")
  );
  const { outcome, members } = await run(plan);
  check(Object.keys(members).length === 6, "six members", String(Object.keys(members).length));
  expectedMembers(plan, outcome, members);
}

/* ──────────────────────────────────────────────
   Case 6: mixed available / missing copies
   ────────────────────────────────────────────── */

section("6. mixed available and missing copies");
{
  const bills = [
    bill({ id: "only-original" }), // original only
    fullBill("all-three"), // everything
    bill({ id: "no-triplicate", duplicate_pdf_path: "bills/no-triplicate/duplicate.pdf" }), // original + duplicate
  ];
  const plan = planBulkZip(bills, BILL_COPIES, LOCAL_DAY);
  checkPartition(plan, "mixed");
  check(plan.entries.length === 6, "only the copies that exist become entries", String(plan.entries.length));
  check(
    plan.skipped.length === 3 && plan.skipped.every((s) => s.reason === "missing-copy"),
    "the three missing copies are named skips, not silent omissions",
    plan.skipped.map((s) => `${s.billId}:${s.copy}`).join(",")
  );
  const { outcome, members } = await run(plan);
  check(Object.keys(members).length === 6, "the archive still holds every available copy");
  check(
    !Object.keys(members).some((name) => name.startsWith("no-triplicate") && name.includes("triplicate")),
    "no missing copy is invented"
  );
  check(outcome.failed.length === 0, "nothing failed: a missing copy is not an error");
  const shortfall = summarizeBulkZipShortfall(outcome);
  check(shortfall !== null && shortfall.count === 3, "the result reports the three missing copies", String(shortfall?.count));
  expectedMembers(plan, outcome, members);
}

/* ──────────────────────────────────────────────
   Case 7: legacy bills with no per-bill paths
   ────────────────────────────────────────────── */

section("7. legacy bills have no per-bill document to substitute");
{
  const bills = [legacyBill("old-1"), legacyBill("old-2")];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  checkPartition(plan, "legacy only");
  check(plan.entries.length === 0, "a legacy bill yields no entry at all", String(plan.entries.length));
  check(
    plan.skipped.length === 2 && plan.skipped.every((s) => s.reason === "legacy"),
    "both are skipped with the legacy reason, never the workbook PDF"
  );
  check(
    plan.skipped.every((s) => /re-upload/i.test(s.detail)),
    "the reason tells the admin what to do about it"
  );
}
{
  const bills = [legacyBill("old"), fullBill("good", { invoice_no: "GOOD/1" })];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  checkPartition(plan, "legacy + good");
  const { outcome, members } = await run(plan);
  check(
    Object.keys(members).length === 1 && Object.keys(members)[0] === "GOOD_1_original.pdf",
    "one good bill in a mixed selection still produces a valid one-member archive",
    Object.keys(members).join(",")
  );
  check(outcome.skipped.length === 1, "the legacy bill is still reported");
  expectedMembers(plan, outcome, members);
}

/* ──────────────────────────────────────────────
   Case 8: two bills that collide on filename
   ────────────────────────────────────────────── */

section("8. two bills sharing an invoice number do not overwrite each other");
{
  const bills = [
    bill({ id: "dup-a", invoice_no: "FIX/301/2026-27", sheet_name: "First Book" }),
    bill({ id: "dup-b", invoice_no: "FIX/301/2026-27", sheet_name: "Second Book" }),
  ];
  /* Both would be called the same thing by the single-bill rule. */
  check(
    billDocumentFilename(bills[0], "original") === billDocumentFilename(bills[1], "original"),
    "the single-bill filename rule alone WOULD collide (so this case is real)"
  );
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  checkPartition(plan, "collision by sheet");
  check(
    new Set(plan.entries.map((e) => e.filename)).size === 2,
    "the collision is broken",
    plan.entries.map((e) => e.filename).join(", ")
  );
  check(
    plan.entries[1].filename === "FIX_301_2026-27_original_Second_Book.pdf",
    "the second name carries the sheet that distinguishes it",
    plan.entries[1].filename
  );
  const { outcome, members } = await run(plan);
  check(Object.keys(members).length === 2, "BOTH invoices are in the archive, neither lost");
  expectedMembers(plan, outcome, members);
}
{
  /* The sheet token is already inside the name, so the sheet cannot disambiguate and
     the bill id must. */
  const bills = [
    bill({ id: "abc12345-1111", invoice_no: "SameBook/301", sheet_name: "SameBook" }),
    bill({ id: "abc12345-2222", invoice_no: "SameBook/301", sheet_name: "SameBook" }),
  ];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  checkPartition(plan, "collision by id");
  check(
    new Set(plan.entries.map((e) => e.filename)).size === 2,
    "still unique when the sheet name cannot help"
  );
  check(
    plan.entries[1].filename.includes("abc12345"),
    "the bill id is the fallback disambiguator",
    plan.entries[1].filename
  );
}
{
  /* A worst case: fifty bills all named the same thing. Every one must survive. */
  const many = Array.from({ length: 50 }, (_, i) =>
    bill({ id: `same-${i}`, invoice_no: "DUP/1", sheet_name: "Same Book" })
  );
  const plan = planBulkZip(many, ["original"], LOCAL_DAY);
  checkPartition(plan, "50-way collision");
  check(plan.entries.length === 50, "all fifty are entries", String(plan.entries.length));
  check(new Set(plan.entries.map((e) => e.filename)).size === 50, "all fifty names are distinct");
}

/* ──────────────────────────────────────────────
   Case 9: a selection across pages and filters
   ────────────────────────────────────────────── */

section("9. a selection that spans pages and filters");
{
  /* The caller hands over a flat set of ids; page boundaries and filter tabs are
     already gone by then. Planning must not care about order or grouping. */
  const pageOne = [bill({ id: "p1a" }), bill({ id: "p1b" })];
  const pageFive = [fullBill("p5a"), fullBill("p5b"), fullBill("p5c")];
  const selected = [...pageFive, ...pageOne]; // an order no page could produce
  const plan = planBulkZip(selected, ["original"], LOCAL_DAY);
  checkPartition(plan, "cross-page");
  check(plan.entries.length === 5, "every selected bill is planned, across pages", String(plan.entries.length));
  check(
    plan.entries.map((e) => e.billId).join(",") === "p5a,p5b,p5c,p1a,p1b",
    "the caller's order is preserved (the archive order is reproducible)"
  );
  const { outcome, members } = await run(plan);
  check(Object.keys(members).length === 5, "all five are in the archive");
  expectedMembers(plan, outcome, members);
}
{
  /* The same id twice must not put the same invoice in the archive twice. */
  const bills = [fullBill("once"), fullBill("once")];
  const plan = planBulkZip(bills, BILL_COPIES, LOCAL_DAY);
  check(
    plan.entries.length === 3 && plan.requested === 3,
    "a repeated id is counted once",
    `${plan.entries.length} entries, ${plan.requested} requested`
  );
}

/* ──────────────────────────────────────────────
   Case 10: bounded concurrency
   ────────────────────────────────────────────── */

section("10. a moderately large selection downloads with bounded concurrency");
{
  const bills = Array.from({ length: 40 }, (_, i) => bill({ id: `n${i}` }));
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);

  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const download = async (path: string): Promise<Uint8Array> => {
    calls += 1;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return pdf(path);
    } finally {
      inFlight -= 1;
    }
  };

  const progress: number[] = [];
  const outcome = await buildBulkZip(plan, {
    download,
    concurrency: 4,
    onProgress: (p) => progress.push(p.done),
  });

  check(outcome.included.length === 40, "all forty are included", String(outcome.included.length));
  check(calls === 40, "each document is fetched exactly once", String(calls));
  check(
    peak <= 4,
    "no more than `concurrency` requests are ever open",
    `peak ${peak}`
  );
  check(peak > 1, "the downloads really do overlap (not silently serialised)", `peak ${peak}`);
  check(
    progress.join(",") === Array.from({ length: 40 }, (_, i) => i + 1).join(","),
    "progress counts real completions, 1..40 with no gaps"
  );
  const expectedInputBytes = plan.entries.reduce((sum, e) => sum + pdf(e.path).byteLength, 0);
  check(
    outcome.totalInputBytes === expectedInputBytes,
    "the input size is the sum of the documents",
    `${outcome.totalInputBytes} vs ${expectedInputBytes}`
  );
}

/* ──────────────────────────────────────────────
   Case 11: a download fails mid-operation
   ────────────────────────────────────────────── */

section("11. one document failing mid-operation does not lose the rest");
{
  const bills = [bill({ id: "ok1" }), bill({ id: "bad1" }), bill({ id: "ok2" }), bill({ id: "bad2" }), bill({ id: "ok3" })];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);

  const outcome = await buildBulkZip(plan, {
    download: async (path) => {
      if (path.includes("bad")) throw new Error("network down");
      return pdf(path);
    },
  });
  const members = unzipSync(outcome.bytes);

  check(outcome.included.length === 3, "the three good documents are included", String(outcome.included.length));
  check(outcome.failed.length === 2, "the two failures are recorded", String(outcome.failed.length));
  check(
    outcome.failed.every((f) => f.error === "network down" && f.filename.endsWith("_original.pdf")),
    "each failure names its document and its reason"
  );
  check(Object.keys(members).length === 3, "the archive is still a valid ZIP of what did arrive");
  check(
    outcome.skipped.length + outcome.failed.length + outcome.included.length === 5,
    "nothing is dropped silently: 3 in + 2 failed = 5 requested"
  );

  const shortfall = summarizeBulkZipShortfall(outcome);
  check(shortfall !== null && shortfall.count === 2, "the report says two are missing", String(shortfall?.count));
  check(
    (shortfall?.examples ?? []).every((line) => line.includes("network down")),
    "the report carries the reason the user can act on"
  );
}
{
  /* If NOTHING can be fetched there is no honest archive to hand over. */
  const plan = planBulkZip([bill({ id: "z" })], ["original"], LOCAL_DAY);
  const outcome = await buildBulkZip(plan, {
    download: async () => {
      throw new Error("offline");
    },
  });
  check(outcome.included.length === 0, "no entries when every download fails");
  check(outcome.failed.length === 1, "the failure is still recorded so the caller can error, not pretend");
}

/* ──────────────────────────────────────────────
   Case 12: the ZIP itself
   ────────────────────────────────────────────── */

section("12. the archive is a real, complete ZIP");
{
  const bills = [fullBill("one", { invoice_no: "SEW/1" }), fullBill("two", { invoice_no: "SEW/2" })];
  const plan = planBulkZip(bills, BILL_COPIES, LOCAL_DAY);
  const { outcome, members } = await run(plan);

  check(outcome.bytes[0] === 0x50 && outcome.bytes[1] === 0x4b, "the file begins with the ZIP signature 'PK'");
  check(outcome.archiveName === plan.archiveName, "the outcome names the archive");
  check(/^selected_bills_all_copies_\d{4}-\d{2}-\d{2}\.zip$/.test(outcome.archiveName), "the archive name has the expected shape");

  const names = Object.keys(members).sort();
  const expected = outcome.included.map((e) => e.filename).sort();
  check(
    names.join(",") === expected.join(","),
    "the archive holds exactly the entries that were included — no more, no fewer",
    `${names.length} vs ${expected.length}`
  );
  check(names.length === 6, "six members for two all-copy bills", String(names.length));
  check(
    names.every((n) => BILL_COPIES.some((copy) => n.endsWith(`_${copy}.pdf`))),
    "every member name still says which copy it is"
  );
  check(
    names.every((n) => !/[\\/:*?"<>|]/.test(n)),
    "no member name contains a path or shell character"
  );
  expectedMembers(plan, outcome, members);
}

/* ──────────────────────────────────────────────
   The size limit is reported, never silent
   ────────────────────────────────────────────── */

section("the size cap stops the archive, it does not truncate it");
{
  const bills = [bill({ id: "s1" }), bill({ id: "s2" }), bill({ id: "s3" })];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  const onePdf = pdf(plan.entries[0].path).byteLength;

  const { outcome, members } = await run(plan, { maxInputBytes: onePdf });
  check(outcome.truncated === true, "the outcome records that the cap was reached");
  check(outcome.included.length === 1, "the archive holds what fit", String(outcome.included.length));
  check(
    outcome.skipped.filter((s) => s.reason === "size-limit").length === 2,
    "the two that did not fit are NAMED, not silently dropped",
    outcome.skipped.map((s) => s.reason).join(",")
  );
  check(Object.keys(members).length === 1, "the ZIP holds only the included member");
  const shortfall = summarizeBulkZipShortfall(outcome);
  check(shortfall !== null && shortfall.count === 2, "the shortfall is reported");
}

/* ──────────────────────────────────────────────
   The document count limit is the caller's gate
   ────────────────────────────────────────────── */

section("the document-count limit is a stated number, checked before anything starts");
{
  check(BULK_ZIP_LIMITS.maxDocuments === 2000, "the limit is 2000 documents", String(BULK_ZIP_LIMITS.maxDocuments));
  /* The planner must NOT quietly drop bills to fit the limit — it reports the true
     size so the caller can refuse. A plan cannot be silently smaller than the
     selection. */
  const bills = Array.from({ length: 5 }, (_, i) => fullBill(`m${i}`));
  const plan = planBulkZip(bills, BILL_COPIES, LOCAL_DAY);
  check(plan.entries.length === 15, "the plan is the full 15, well under the limit", String(plan.entries.length));
  check(
    BULK_ZIP_LIMITS.concurrency >= 1 && BULK_ZIP_LIMITS.concurrency <= 8,
    "concurrency is a small, sane number",
    String(BULK_ZIP_LIMITS.concurrency)
  );
  check(BULK_ZIP_LIMITS.maxInputBytes > 0, "the byte cap is set");
}

/* ──────────────────────────────────────────────
   Case 13: the Android share/save flow
   ────────────────────────────────────────────── */

section("13. what the Android share sheet is handed (device flow not verifiable here)");
{
  /* The native write-and-share cannot run without a device. What CAN be pinned is
     everything the platform glue depends on: the archive name it will be offered
     under and the properties the save function relies on. */
  const bills = [bill({ id: "share1" })];
  const plan = planBulkZip(bills, ["original"], LOCAL_DAY);
  const { outcome } = await run(plan);

  check(/\.zip$/.test(outcome.archiveName), "the shared file has a .zip extension", outcome.archiveName);
  check(
    /^[A-Za-z0-9._-]+\.zip$/.test(outcome.archiveName),
    "the name is safe to write to a filesystem as-is",
    outcome.archiveName
  );
  check(outcome.bytes.byteLength > 0, "there are real bytes to write");
  console.log(
    "  NOTE  the Android/iOS share sheet itself is UNVERIFIED here: it needs a device.\n" +
      "        The archive name, bytes and MIME choice above are what feed it."
  );
}

/* ──────────────────────────────────────────────
   Parity: the desktop module decides identically
   ────────────────────────────────────────────── */

section("the desktop build packs the same archive");
{
  const desktop = (await import(
    pathToFileURL(join(REPO, "Metalworker_desktop/src/services/bulkBillZip.ts")).href
  )) as typeof import("../../../src/services/bulkBillZip.ts");

  for (const copies of [["original"], ["duplicate"], ["triplicate"], ["original", "triplicate"], [...BILL_COPIES]] as BillCopy[][]) {
    check(
      desktop.bulkZipArchiveName(copies, LOCAL_DAY) === bulkZipArchiveName(copies, LOCAL_DAY),
      `the desktop archive name matches for [${copies.join(",")}]`
    );
  }

  const bills = [
    fullBill("d1", { invoice_no: "FIX/9" }),
    bill({ id: "d2", invoice_no: "FIX/9", sheet_name: "Book Two" }),
    legacyBill("d3"),
    bill({ id: "d4", invoice_no: "FIX/9", sheet_name: "Book Two" }),
  ];

  for (const copies of [["original"], ["original", "duplicate"], [...BILL_COPIES]] as BillCopy[][]) {
    const deskPlan = desktop.planBulkZip(bills, copies, LOCAL_DAY);
    const adminPlan = planBulkZip(bills, copies, LOCAL_DAY);
    check(
      JSON.stringify(deskPlan) === JSON.stringify(adminPlan),
      `the desktop plan matches for [${copies.join(",")}]`,
      `${deskPlan.entries.length} entries`
    );

    const desk = await desktop.buildBulkZip(deskPlan, { download: downloadFrom(deskPlan.entries) });
    const admin = await buildBulkZip(adminPlan, { download: downloadFrom(adminPlan.entries) });
    const deskMembers = unzipSync(desk.bytes);
    const adminMembers = unzipSync(admin.bytes);
    check(
      Object.keys(deskMembers).sort().join(",") === Object.keys(adminMembers).sort().join(","),
      `the desktop archive holds the same members for [${copies.join(",")}]`
    );
    check(
      Object.keys(deskMembers).every((name) => bytesEqual(deskMembers[name], adminMembers[name])),
      `the desktop member contents match for [${copies.join(",")}]`
    );
    check(
      JSON.stringify(desktop.summarizeBulkZipShortfall(desk)) ===
        JSON.stringify(summarizeBulkZipShortfall(admin)),
      `the desktop shortfall report matches for [${copies.join(",")}]`
    );
  }
}

console.log();
console.log(
  failures === 0
    ? "BULK ZIP CHECKS: all passed."
    : `\nBULK ZIP CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
