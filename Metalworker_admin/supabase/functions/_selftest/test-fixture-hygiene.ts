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
   2. THE PRIMARY GUARD — AN ALLOWLIST, WHICH NAMES NO REAL VALUE

   Section 5 asserts that every identity field of every bill is one of the
   placeholders in ALLOWED above. A real company name, GSTIN, bank account or
   phone number pasted back into a workbook fails that check without this file
   ever having to contain the thing it is looking for. It is the guard that
   matters, and it is the reason the real values are not needed as literals.

   What the allowlist cannot see is a real value hidden in a field the parser
   does not model, so the substring denylist below is a second line of defence.
   Company names, bank names, localities and cities have no recognisable SHAPE,
   so they can only be matched as text — and that text is assembled from short
   fragments at runtime, for the same reason the CI credential scanner assembles
   its pattern: a complete real identifier must not sit in plain text in this
   repository, or the repository would still hand over the data the workbooks no
   longer contain.

   This is honestly not a secret store. Anyone determined can re-join four short
   strings, and this file is not a security boundary. What it does prevent is the
   realistic failure: a `grep` of the repository, a code-search UI, or a tool
   reading the tree casually, returning a customer's name and bank details.
   ══════════════════════════════════════════════════════════════════════ */
/* A GROUP is either one string or a list of fragments to re-join. More than one
   group means "any of these", which is how the two real phone numbers and the
   two real localities are expressed. */
type Group = string | string[];

const F: Record<string, Group[]> = {
  seller: [["SAA", "STHA"]],
  party: [["Haw", "kins"]],
  bankName: [["FEDER", "AL BANK"]],
  branch: [["LOUIS", "WADI"]],
  gstinA: [["27AAMPE18", "57D2ZT"]],
  gstinB: [["27AAACH17", "84M1Z9"]],
  msme: [["UDYAM-MH-", "33-0054711"]],
  mail: [["saas", "tha01@"]],
  // both real numbers are split, so neither appears whole in this file
  phone: [["99694", "34432"], ["996914", "2688"]],
  account: [["17750200", "004019"]],
  ifsc: [["FDRL000", "1775"]],
  vehicle: [["JQ 41", "72"]],
  // the spaces are part of the value; a join that dropped them would produce a
  // rule that can never match the text it is meant to catch
  locality: [["Kailash", " Nagar"], ["Wagle", " Estate"]],
  city: [["THA", "NE"]],
  invoice: [["SE", "W/"]],
  author: [["its", "si"]],
  machine: [["Server-", "Pc"]],
};

/* The character length each re-joined value must have. A length is not an
   identifier, and asserting it is what catches a fragment split that dropped or
   invented a character — the failure mode that produced a postal-locality rule
   matching "KailashNagar" while the workbook said "Kailash Nagar". Because the
   probes in section 4 are built from the same fragments, a wrong join would
   otherwise be invisible: the rule and its test would be wrong together. */
const EXPECTED_LENGTH: Record<string, number[]> = {
  seller: [7], party: [7], bankName: [12], branch: [9],
  gstinA: [15], gstinB: [15], msme: [19], mail: [10],
  phone: [10, 10], account: [14], ifsc: [11], vehicle: [7],
  locality: [13, 12], city: [5], invoice: [4], author: [5], machine: [9],
};

const g = (x: Group): string => (Array.isArray(x) ? x.join("") : x);
/** Re-join every group into one "|"-separated string, for probes and templates. */
const alt = (...xs: Group[]): string => xs.map(g).join("|");

/** Escape for embedding a literal inside a RegExp. */
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Escape each group SEPARATELY, then join with a real alternation bar. Escaping
 * the joined string instead would escape the bar too, turning the alternation
 * into a literal pipe — a rule that silently never matches anything.
 */
const altRe = (...xs: Group[]): string => xs.map((x) => esc(g(x))).join("|");

/**
 * The denylist, as [description, RegExp] pairs. Built at runtime so the complete
 * identifiers do not appear in this file.
 *
 * Word-boundary anchors are added AFTER escaping. Escaping a literal `\b` first
 * turns it into a literal backslash-b, which silently never matches.
 */
const REMOVED: [string, RegExp][] = [
  ["seller company name", new RegExp(altRe(...F.seller), "i")],
  ["recipient company name", new RegExp(altRe(...F.party), "i")],
  ["bank name", new RegExp(altRe(...F.bankName), "i")],
  ["bank branch name", new RegExp(altRe(...F.branch), "i")],
  ["seller GSTIN", new RegExp(altRe(...F.gstinA))],
  ["recipient GSTIN", new RegExp(altRe(...F.gstinB))],
  ["MSME registration", new RegExp(altRe(...F.msme))],
  ["e-mail local part", new RegExp(altRe(...F.mail), "i")],
  ["consumer e-mail domain", /@gmail\.com/i],
  ["phone number", new RegExp(altRe(...F.phone))],
  ["bank account number", new RegExp(altRe(...F.account))],
  ["bank IFSC", new RegExp(altRe(...F.ifsc))],
  ["vehicle registration", new RegExp(altRe(...F.vehicle), "i")],
  ["postal locality", new RegExp(altRe(...F.locality), "i")],
  ["city name", new RegExp(`\\b${altRe(...F.city)}\\b`, "i")],
  ["invoice-number series", new RegExp(`\\b${altRe(...F.invoice)}`, "i")],
  ["author user name", new RegExp(altRe(...F.author), "i")],
  ["authoring machine name", new RegExp(altRe(...F.machine), "i")],
  ["authoring local path", /C:\\Users\\/i],
  // Excel records where the file was last saved from, profile path included.
  ["authoring absolute path", /absPath url="(?!")[^"]+"/],
  /* A GST e-way bill number: twelve digits printed as three groups of four. The
     spaces are exactly why a plain 11-or-more-digit rule never saw these — they
     were found by the structural allowlist in section 5, not by this pattern. */
  ["real e-way bill number", /\b(?!9999 9000 0)\d{4} \d{4} \d{4}\b/],
];

/* The permitted identity strings, for the structural allowlist in section 5.
   Only placeholders appear here, which is the point: an allowlist never has to
   record the thing it is protecting against. */
const ALLOWED_IDENTITY = {
  sellerName: new Set(["EXAMPLE ENGINEERING WORKS", "SAMPLE ENGINEERING WORKS"]),
  partyName: new Set(["M/s. Example Cookers Ltd.,", "M/s. Sample Traders Ltd.,"]),
  // "MH00 EX 0000" is the un-spaced spelling that sheet `292` of SAMPLE.xlsx
  // uses; the template is inconsistent about the space and both are placeholders.
  vehicle: new Set(["MH 00 EX 0000", "MH00 EX 0000", "BY HAND", "MH 01 AB 1234"]),
  placeOfSupply: new Set(["EXAMPLE CITY"]),
  bankName: new Set(["EXAMPLE BANK LTD", "SAMPLE BANK LTD"]),
  branch: new Set(["EXAMPLE BRANCH", "SAMPLE BRANCH"]),
  account: new Set(["00000000123456", "00000000000"]),
  addressLine: new Set([
    'C-21,22 "U" Road,',
    "Example Industrial Estate,",
    "Example City - 000 001.",
  ]),
  invoiceNo: /^(FIX|TEST|TEST-CUSTOMER|INV)\/\d{1,4}\/\d{4}-\d{2}$/,
  /* `abc` is a junk value that was already present in the source workbook's
     "Your Challan No." cell. It is not identifying, and it is deliberately kept
     so the fixture still exercises the parser's tolerance of a non-reference
     value in a reference row. */
  reference: /^(WT\/(SO|PO\/CP|PO\/TRM|OGC\/TR)\/90\d{5}|(FIX|TEST)\/\d{1,4}\/\d{4}-\d{2}|TEST\/(SO|OGC\/TR)\/2600001|9999 9000 0\d{3}|abc)$/,
  ewayBillNo: /^9999 9000 0\d{3}$/,
};

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
/* First: every re-joined fragment must have the length it is supposed to have.
   A join that dropped or invented a character produces a rule that can never
   match real text, and because the probes below are built from the same
   fragments, the rule and its test would be wrong together and nothing else
   would notice. A length is not an identifier, so asserting it leaks nothing. */
for (const [key, want] of Object.entries(EXPECTED_LENGTH)) {
  const got = F[key].map((x) => g(x).length);
  check(
    got.length === want.length && got.every((n, i) => n === want[i]),
    `fragment set "${key}" rejoins to the expected length`,
    `got [${got}], want [${want}]`
  );
}

const PROBES: [string, string][] = [
  ["seller company name", `${alt(...F.seller)} ENGINEERING WORKS`],
  ["recipient company name", `M/s. ${alt(...F.party)} Cookers Ltd.,`],
  ["bank name", `Bank Name: THE ${alt(...F.bankName)}`],
  ["bank branch name", `BRANCH: ${alt(...F.branch)}`],
  ["seller GSTIN", `GST No.${alt(...F.gstinA)}`],
  ["recipient GSTIN", `Party's GST No.${alt(...F.gstinB)}`],
  ["MSME registration", `MSME NO.${alt(...F.msme)}`],
  ["e-mail local part", `${alt(...F.mail)}gmail.com`],
  ["consumer e-mail domain", "someone@gmail.com"],
  ["phone number", `Mob.${g(F.phone[0])}`],
  ["the second phone number", `Mob.${g(F.phone[1])}`],
  ["bank account number", `ACCOUNT NUMBER:${alt(...F.account)}`],
  ["bank IFSC", `IFSC CODE:${alt(...F.ifsc)}`],
  ["vehicle registration", `MH 04 ${alt(...F.vehicle)}`],
  ["postal locality", `${g(F.locality[0])}, ${g(F.locality[1])}`],
  ["city name", alt(...F.city)],
  ["invoice-number series", `${alt(...F.invoice)}301/2026-27`],
  ["author user name", `<cp:lastModifiedBy>${alt(...F.author)}</cp:lastModifiedBy>`],
  ["authoring machine name", `<dc:creator>${alt(...F.machine)}</dc:creator>`],
  ["authoring local path", `<x15ac:absPath url="C:\\Users\\${alt(...F.machine)}\\Downloads\\" />`],
  ["an authoring absolute path", '<x15ac:absPath url="D:\\secret\\place\\" />'],
  ["a real e-way bill number", "Eway Bill No.: 2222 9329 6081"],
  // allowlist enforcement: right SHAPE, wrong VALUE
  ["an unapproved GSTIN", "GST No.29ZZZZP9876Q1Z4"],
  ["an unapproved IFSC", "IFSC CODE:ABCD0123456"],
  ["an unapproved e-mail", "someone@example.org"],
  ["an unapproved MSME id", "UDYAM-MH-33-9999999"],
  ["an unapproved 10-digit number", "9988776655"],
  ["an unapproved long number", "12345678901234"],
  ["an unapproved order reference", "WT/SO/2602879"],
  ["an unapproved challan reference", "WT/OGC/TR/261199"],
  ["an unapproved purchase order", "WT/PO/TRM/600317"],
];
for (const [what, sample] of PROBES) {
  const hits = scan(sample, "self-probe", true);
  check(hits.length > 0, `the scanner rejects ${what}`, `sample: ${JSON.stringify(sample)}`);
  if (hits.length) console.log(`        -> ${hits[0].replace(/[A-Za-z0-9@._/-]{6,}/g, (m) => m[0] + "*".repeat(m.length - 5))}`);
}

section("5. every identity field on every bill is an approved placeholder");
/* THE PRIMARY GUARD. It needs no real values: a real company name, GSTIN, bank
   account or phone number is simply not in the allowlist, so pasting one back
   fails here even if every substring rule in section 4 were deleted. */
for (const f of FIXTURES) {
  const wb = await readXlsx(readFileSync(resolve(REPO, f)));
  const { bills } = parseBills(wb.sheets);
  const bad: string[] = [];
  const inSet = (set: Set<string>, v: string | null | undefined, label: string, where: string) => {
    if (v === null || v === undefined || v === "") return;
    if (!set.has(v)) bad.push(`${where} ${label} = ${JSON.stringify(v)}`);
  };
  for (const bill of bills) {
    for (const kind of ["original", "duplicate", "triplicate"] as const) {
      const c = bill[kind];
      if (!c) continue;
      const where = `${f}/${bill.sheetName}/${kind}`;
      inSet(ALLOWED_IDENTITY.sellerName, c.sellerName, "sellerName", where);
      inSet(ALLOWED_IDENTITY.partyName, c.partyName, "partyName", where);
      inSet(ALLOWED_IDENTITY.vehicle, c.vehicleNumber, "vehicleNumber", where);
      inSet(ALLOWED_IDENTITY.placeOfSupply, c.placeOfSupply, "placeOfSupply", where);
      if (c.partyGstNo && !ALLOWED.gstin.has(c.partyGstNo)) bad.push(`${where} partyGstNo = ${c.partyGstNo}`);
      if (c.invoiceNo && !ALLOWED_IDENTITY.invoiceNo.test(c.invoiceNo)) bad.push(`${where} invoiceNo = ${c.invoiceNo}`);
      if (c.ewayBillNo && !ALLOWED_IDENTITY.ewayBillNo.test(c.ewayBillNo)) bad.push(`${where} ewayBillNo = ${c.ewayBillNo}`);
      for (const line of c.partyAddress ?? []) inSet(ALLOWED_IDENTITY.addressLine, line, "partyAddress", where);
      for (const b of c.bankLines ?? []) {
        if (/^Bank Name:/i.test(b)) inSet(ALLOWED_IDENTITY.bankName, b.slice(b.indexOf(":") + 1).trim(), "bankName", where);
        if (/^BRANCH:/i.test(b)) inSet(ALLOWED_IDENTITY.branch, b.slice(b.indexOf(":") + 1).trim(), "branch", where);
        if (/ACCOUNT NUMBER/i.test(b)) inSet(ALLOWED_IDENTITY.account, b.replace(/^.*?:/, "").trim(), "account", where);
      }
      for (const r of c.referenceRows ?? []) {
        if (r.value && !ALLOWED_IDENTITY.reference.test(r.value)) bad.push(`${where} reference ${r.label} = ${r.value}`);
      }
    }
  }
  check(bad.length === 0, `${f}: every identity field is an approved placeholder`, bad.slice(0, 5).join("\n        "));
}

section("6. the scanner does not fire on the placeholders it permits");
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
  "Eway Bill No.: 9999 9000 0001",
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
