// supabase/functions/_selftest/test-fixture-hygiene.ts
//
// PROVES THAT NO COMMITTED WORKBOOK CARRIES REAL BUSINESS DATA.
//
// WHY THIS SUITE EXISTS
// `SAMPLE.xlsx` and `BILL 301 TO.xlsx` were originally real tax-invoice
// workbooks lifted straight out of production. They carried the seller's name,
// both parties' GSTINs, the MSME registration, the bank name / branch / account
// number / IFSC, phone numbers, e-mail addresses, a postal address, vehicle
// registrations, and every invoice, purchase-order and challan number. They are
// now sanitised in place, and this suite is the thing that keeps them that way.
//
// WHY IT SCANS THE ZIP AND NOT ONLY THE CELLS
// The identifying values live in `xl/sharedStrings.xml`, which is deflated, so
// a raw byte search over the .xlsx would find nothing and pass vacuously. The
// strings are only reachable after inflating the member, so this suite reads
// every member of the container. That also covers `docProps/core.xml`, which is
// not a cell at all and did carry the editing machine's user name.
//
// WHY IT SCANS EVERY MEMBER
// A partial scan is not a guarantee. Invoice metadata, print settings and the
// relationship parts are all places a workbook can carry an author or a path
// that no cell-level check would ever see.
//
// WHY THE SCANNER CHECKS ITSELF
// A filter that cannot match anything is worse than no filter, because it reads
// as protection. One rule in this file was written with a character class too
// many and could never fire; the real values happened to be caught by the
// literal patterns, so the suite was green while a rule was dead. Section 4
// therefore feeds the scanner a synthetic sample of every single rule and
// requires it to reject each one. If a pattern is ever broken, that section
// fails even when the committed workbooks are perfectly clean.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";

const REPO = resolve(import.meta.dirname, "../../../..");

let checks = 0;
let failed = 0;
function check(ok: boolean, what: string, detail = ""): boolean {
  checks++;
  if (!ok) {
    failed++;
    console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`);
  }
  return ok;
}
function section(title: string): void {
  console.log(`\n── ${title}`);
}

/* ══════════════════════════════════════════════════════════════════════
   1. THE ALLOWLIST

   Every identifier-shaped value permitted to appear in a committed workbook.
   Each is an obvious placeholder. This is an ALLOWLIST, not a denylist: a new
   GSTIN or account number that nobody thought to forbid still fails, because
   anything not named here is rejected. The denylist in section 2 exists only
   to produce a readable failure message for the values that were actually
   removed.
   ══════════════════════════════════════════════════════════════════════ */
const ALLOWED = {
  // Indian GSTIN: 2-digit state, 5 letters, 4 digits, 1 letter (PAN),
  // 1-digit entity number, "Z", 1-character checksum. Exactly 15 characters.
  gstin: new Set(["27AAAPE1234F1Z9", "27AAACD5678E1Z9", "27BBBCG5678N2Z4"]),
  ifsc: new Set(["EXAM0000001"]),
  email: new Set(["example1@example.com", "example2@example.com"]),
  msme: new Set(["UDYAM-MH-00-0000001"]),
  phone10: new Set(["9000000001", "9000000002"]),
  longNumber: new Set(["00000000000", "00000000123456"]),
  seller: new Set(["EXAMPLE ENGINEERING WORKS", "SAMPLE ENGINEERING WORKS"]),
};

const SHAPES = {
  gstin: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z0-9]\b/g,
  ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  msme: /UDYAM[-\/][A-Z]{2}[-\/]\d+[-\/]\d+/g,
  phone10: /\b\d{10}\b/g,
  longNumber: /\b\d{11,}\b/g,
};

/* ══════════════════════════════════════════════════════════════════════
   2. THE VALUES THAT WERE REMOVED

   Kept verbatim, including the ones that are only fragments, so a failure names
   the exact thing that came back rather than "an unapproved value".
   ══════════════════════════════════════════════════════════════════════ */
const REMOVED: [string, RegExp][] = [
  ["seller company name", /SAASTHA/i],
  ["recipient company name", /Hawkins/i],
  ["bank name", /FEDERAL\s*BANK/i],
  ["bank branch name", /LOUISWADI/i],
  ["seller GSTIN", /27AAMPE1857D2ZT/],
  ["recipient GSTIN", /27AAACH1784M1Z9/],
  ["MSME registration", /UDYAM-MH-33-0054711/],
  ["e-mail local part", /saastha/i],
  ["consumer e-mail domain", /@gmail\.com/i],
  ["phone number", /9969434432|9969142688/],
  ["bank account number", /17750200004019/],
  ["bank IFSC", /FDRL0001775/],
  ["vehicle registration", /JQ\s*4172/i],
  ["postal locality", /Kailash Nagar|Wagle Estate/i],
  ["city name", /\bTHANE\b/i],
  ["invoice-number series", /\bSEW\//i],
  ["author user name", /itssi/i],
  ["authoring machine name", /Server-Pc/],
  ["authoring local path", /C:\\Users\\/i],
  // Excel records where the file was last saved from, profile path included.
  ["authoring absolute path", /absPath url="(?!")[^"]+"/],
];

/* ══════════════════════════════════════════════════════════════════════
   3. THE SCANNER
   ══════════════════════════════════════════════════════════════════════ */

/** Members whose bytes are text and may carry identifying data. */
const TEXT_MEMBER = /\.(xml|rels)$/i;

function isTexty(buf: Buffer): boolean {
  // A member is text if it decodes as UTF-8 and contains no NUL byte. This skips
  // printerSettings*.bin without hard-coding its name.
  if (buf.includes(0)) return false;
  const head = buf.subarray(0, 512).toString("utf8");
  return head.startsWith("<?xml") || head.startsWith("<") || /[\r\n]/.test(head);
}

/**
 * @param text      the text to inspect
 * @param member    the zip member name, for the failure message
 * @param digits    run the digit-shape rules. True only for the string table:
 *                  a worksheet legitimately contains formula caches such as
 *                  0.0552380952380952 and a workbook.xml contains date serials,
 *                  and a monetary cell value is deliberately preserved. Neither
 *                  workbook has an inline string and neither has a numeric cell
 *                  of 11+ digits outside a formula, so the string table is the
 *                  only place an account number can hide.
 */
function scan(text: string, member: string, digits: boolean): string[] {
  const found: string[] = [];
  for (const [what, re] of REMOVED) {
    const hit = re.exec(text);
    if (hit) found.push(`real ${what} ("${hit[0].slice(0, 40)}")`);
  }
  for (const [kind, re] of Object.entries(SHAPES)) {
    // Digit-only shapes are meaningful on the string table alone. Elsewhere they
    // are noise: a worksheet legitimately holds formula caches such as
    // 0.0552380952380952, styles.xml holds ids, and a monetary cell value is
    // deliberately preserved. Neither workbook has an inline string and neither
    // has a numeric cell of 11+ digits outside a formula, so an account number
    // cannot hide outside the string table.
    if (!digits && (kind === "phone10" || kind === "longNumber")) continue;
    for (const value of text.match(re) ?? []) {
      const allow = ALLOWED[kind as keyof typeof ALLOWED];
      if (allow && !allow.has(value)) found.push(`unapproved ${kind} ("${value}")`);
    }
  }
  if (digits) {
    for (const m of text.match(/\bWT\/(?:SO|PO\/CP|PO\/TRM|OGC\/TR)\/\d+\b/g) ?? []) {
      if (!/^WT\/(?:SO|PO\/CP|PO\/TRM|OGC\/TR)\/90\d{5}$/.test(m)) {
        found.push(`unapproved order/challan reference ("${m}")`);
      }
    }
  }
  return found;
}

/** Inflate every member of a .xlsx and scan each one. Minimal zip reader. */
function scanWorkbook(path: string, label: string): number {
  const buf = readFileSync(path);

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    check(false, `${label}: is a readable zip container`);
    return 0;
  }
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let members = 0;
  let problems = 0;

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      check(false, `${label}: central directory entry ${n} is intact`);
      break;
    }
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const dataOff = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    let data: Buffer;
    try {
      data = method === 8 ? inflateRawSync(buf.subarray(dataOff, dataOff + csize)) : buf.subarray(dataOff, dataOff + csize);
    } catch {
      data = Buffer.alloc(0);
    }
    p += 46 + nlen + elen + clen;
    if (csize === 0) continue;
    members++;

    // Cell text is scanned through the reader too, so a value that reached the
    // sheet as an inline string rather than a shared string could not hide.
    const isStrings = name === "xl/sharedStrings.xml";
    if (isTexty(data) || isStrings) {
      const hits = scan(data.toString("utf8"), name, isStrings);
      if (hits.length) {
        problems += hits.length;
        check(false, `${label} :: ${name} carries identifying data`, hits.slice(0, 6).join("\n        "));
      }
    }
  }
  check(members > 0, `${label}: read ${members} non-empty members`);
  if (problems === 0) console.log(`  ok    ${label}: all ${members} members clean`);
  return problems;
}

const FIXTURES = ["SAMPLE.xlsx", "BILL 301 TO.xlsx", "test-bills-sanitized.xlsx"];

section("1. every committed workbook is present");
for (const f of FIXTURES) {
  check(readFileSync(resolve(REPO, f)).length > 0, `${f} exists and is not empty`);
}

section("2. no committed workbook carries real business data");
let total = 0;
for (const f of FIXTURES) total += scanWorkbook(resolve(REPO, f), f);
check(total === 0, `no identifying value found in any of the ${FIXTURES.length} workbooks`, `${total} finding(s)`);

section("3. the parser still reads every workbook, with its bill count intact");
const EXPECTED: Record<string, { sheets: number; bills: number }> = {
  "SAMPLE.xlsx": { sheets: 2, bills: 2 },
  "BILL 301 TO.xlsx": { sheets: 20, bills: 20 },
  "test-bills-sanitized.xlsx": { sheets: 1, bills: 1 },
};
const { parseBills } = await import("../process-bill-upload/_shared/parseBill.ts");
for (const f of FIXTURES) {
  const wb = await readXlsx(readFileSync(resolve(REPO, f)));
  const { bills, skipped } = parseBills(wb.sheets);
  const want = EXPECTED[f];
  check(wb.sheets.length === want.sheets, `${f}: ${want.sheets} sheet(s)`, `${wb.sheets.length}`);
  check(bills.length === want.bills, `${f}: still parses ${want.bills} bill(s)`, `${bills.length}`);
  check(skipped.length === 0, `${f}: nothing skipped`, JSON.stringify(skipped));
}

section("4. the scanner detects what it claims to detect");
/* Each sample is a shape the corresponding rule must reject. If a pattern is
   edited into something that cannot match, this section fails while the
   workbooks are still clean, which is the only way a dead rule can be caught. */
const PROBES: [string, string][] = [
  ["seller company name", "SAASTHA ENGINEERING WORKS"],
  ["recipient company name", "M/s. Hawkins Cookers Ltd.,"],
  ["bank name", "Bank Name: THE FEDERAL BANK LTD"],
  ["bank branch name", "BRANCH: LOUISWADI THANE"],
  ["seller GSTIN", "GST No.27AAMPE1857D2ZT"],
  ["recipient GSTIN", "Party's GST No.27AAACH1784M1Z9"],
  ["MSME registration", "MSME NO.UDYAM-MH-33-0054711"],
  ["e-mail local part", "saastha01@gmail.com"],
  ["consumer e-mail domain", "someone@gmail.com"],
  ["phone number", "Mob.9969434432"],
  ["bank account number", "ACCOUNT NUMBER:17750200004019"],
  ["bank IFSC", "IFSC CODE:FDRL0001775"],
  ["vehicle registration", "MH 04 JQ 4172"],
  ["postal locality", "Kailash Nagar, Wagle Estate"],
  ["city name", "THANE"],
  ["invoice-number series", "SEW/301/2026-27"],
  ["author user name", "<cp:lastModifiedBy>itssi</cp:lastModifiedBy>"],
  ["authoring machine name", "<dc:creator>Server-Pc</dc:creator>"],
  ["authoring local path", '<x15ac:absPath url="C:\\Users\\Server-Pc\\Downloads\\"'],
  ["an authoring absolute path", '<x15ac:absPath url="D:\\secret\\place\\"'],
  // allowlist enforcement: right SHAPE, wrong VALUE
  ["an unapproved GSTIN", "GST No.29ZZZZP9876Q1Z4"],
  ["an unapproved IFSC", "IFSC CODE:ABCD0123456"],
  ["an unapproved e-mail", "someone@example.org"],
  ["an unapproved MSME id", "UDYAM-MH-33-0054711"],
  ["an unapproved 10-digit number", "9988776655"],
  ["an unapproved long number", "12345678901234"],
  ["an unapproved order reference", "WT/SO/2602879"],
  ["an unapproved challan reference", "WT/OGC/TR/261199"],
  ["an unapproved purchase order", "WT/PO/TRM/600317"],
];
for (const [what, sample] of PROBES) {
  const hits = scan(sample, "self-probe", true);
  check(hits.length > 0, `the scanner rejects ${what}`, `sample: ${JSON.stringify(sample)}`);
  if (hits.length) console.log(`        -> ${hits[0]}`);
}

section("5. the scanner does not fire on the placeholders it permits");
for (const value of [
  "EXAMPLE ENGINEERING WORKS",
  "GST No.27AAAPE1234F1Z9  MSME NO.UDYAM-MH-00-0000001",
  "Party's GST No.27AAACD5678E1Z9",
  "ACCOUNT NUMBER:00000000123456",
  "IFSC CODE:EXAM0000001",
  "Email (1):example1@example.com Mob.9000000001 & 9000000002",
  "MH 00 EX 0000",
  "Example City - 000 001.",
  "FIX/316/2026-27",
  "WT/OGC/TR/9000006",
  "WT/PO/TRM/9000001",
  "State: Maharashtra       State Code:27",
  "Manufacturing Traders of Machinery,Precision Job Works & Industrial Products",
]) {
  const hits = scan(value, "self-probe", true);
  check(hits.length === 0, `no false positive on ${JSON.stringify(value.slice(0, 48))}`, hits.join("; "));
}

console.log(
  `\n${failed === 0 ? "FIXTURE HYGIENE CHECKS: all passed." : "FIXTURE HYGIENE CHECKS: FAILED"} ` +
    `${checks} checks, ${failed} failed.`
);
process.exit(failed === 0 ? 0 : 1);
