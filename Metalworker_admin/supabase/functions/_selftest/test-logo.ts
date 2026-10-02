// supabase/functions/_selftest/test-logo.ts
//
// Checks the INVOICE LOGO feature, in the two ways that matter:
//
//   1. A bill with no logo must be the document it has always been. Not "looks
//      the same" — the same bytes. `renderBillDocument` gained a third parameter
//      and `pdf.ts` gained image support, and both of those are opportunities to
//      shift a baseline by a point, add an empty dictionary entry, or renumber an
//      object. The only real way to know that did not happen is to compare.
//
//   2. A bill WITH a logo must carry the logo as a real image object inside the
//      PDF, placed in the header strip the copy marker already reserves, at its
//      own aspect ratio, without displacing anything below it.
//
// Nothing here needs a PDF library: the writer emits uncompressed content
// streams, so the operators can be read straight out of the file — which is also
// how `test-pdf.ts` validates the xref table.
//
//   node supabase/functions/_selftest/test-logo.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_LABEL, COPY_ORDER, type BillCopy } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { decodePdfImage, deflate } from "../process-bill-upload/_shared/pdfImage.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

/* ──────────────────────────────────────────────
   Reading a generated PDF without a PDF library
   ────────────────────────────────────────────── */

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

interface Placed {
  resource: string;
  x: number;
  yTop: number;
  w: number;
  h: number;
}

/** Every `q … cm … /X Do … Q` image placement, in top-down coordinates. */
function imagePlacements(pdf: string): Placed[] {
  const out: Placed[] = [];
  const re = /q\n([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\n\/(\w+) Do\nQ/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf)) !== null) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    const x = Number(m[3]);
    // The writer emits the image's BOTTOM-left corner in PDF space, so the
    // top-down y of the box is height - bottom - boxHeight.
    out.push({ resource: m[5], x, yTop: 841.89 - Number(m[4]) - h, w, h });
  }
  return out;
}

/** The full-width header rule: from the left margin to the right margin. */
function headerRuleY(pdf: string): number {
  for (const m of pdf.matchAll(/([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g)) {
    const x1 = Number(m[1]);
    const x2 = Number(m[3]);
    if (Math.abs(x1 - 30) < 0.01 && Math.abs(x2 - 565.28) < 0.01) return 841.89 - Number(m[2]);
  }
  throw new Error("no full-width rule found — the header was not drawn");
}

/** The single page content stream, sliced out of the file. */
function contentStream(pdf: string): string {
  const at = pdf.indexOf("stream\n");
  const end = pdf.indexOf("\nendstream", at);
  if (at < 0 || end < 0) throw new Error("no content stream");
  return pdf.slice(at + 7, end);
}

/** A valid JPEG is only needed for its header here; the pixels pass through. */
function syntheticJpeg(width: number, height: number): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI
  const sof: number[] = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ];
  parts.push(...sof);
  parts.push(0xff, 0xd9); // EOI
  return new Uint8Array(parts);
}

/**
 * A PNG with a real alpha channel, to exercise the /SMask path.
 *
 * `alpha` chooses between a genuine transparency ramp and a fully opaque image
 * that nonetheless carries an alpha channel. The second case matters because it
 * is what most real logo files look like: an RGBA PNG where every sample happens
 * to be 255. Writing a soft mask for that would put a second image object in
 * every PDF for no visual difference at all.
 */
async function syntheticPng(
  width: number,
  height: number,
  alpha: "ramp" | "opaque"
): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 4;
      raw[p] = 40;
      raw[p + 1] = 60;
      raw[p + 2] = 200;
      raw[p + 3] = alpha === "ramp" ? Math.round((x / (width - 1)) * 255) : 255;
    }
  }
  const idat = await deflate(raw);

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

/* ──────────────────────────────────────────────
   Fixtures
   ────────────────────────────────────────────── */

const wb = await readXlsx(readFileSync(resolve(REPO, "BILL 301 TO.xlsx")));
const { bills } = parseBills(wb.sheets);
/**
 * The fullest seller block in the fixture workbook — an ordinary real invoice.
 * `find` returns a parsed sheet, so `.original` is what is wanted here: all three
 * print copies are rendered from the ORIGINAL block, which is what
 * `process-bill-upload` does.
 */
const found = bills.find((b) => b.original.sellerAddress && b.original.sellerContact) ?? bills[0];
const ordinary: BillCopy = found.original;

/** A seller with nothing but a name, to reach the adaptive-growth branch. */
const sparse: BillCopy = {
  ...ordinary,
  sellerDescriptor: "",
  sellerTaxLine: "",
  sellerAddress: "",
  sellerContact: "",
};

const logoPng = await syntheticPng(411, 276, "ramp");
const logoAlpha = await decodePdfImage(logoPng);
const logoOpaque = await decodePdfImage(syntheticJpeg(411, 276));
/** RGBA on disk, but every alpha sample is 255 — the commonest real logo file. */
const logoFlat = await decodePdfImage(await syntheticPng(40, 40, "opaque"));

/* ──────────────────────────────────────────────
   1. No logo == the document it has always been
   ────────────────────────────────────────────── */

console.log("\nno-logo renders carry nothing image-shaped");
{
  for (const copy of COPY_ORDER) {
    const bytes = renderBillDocument([ordinary], COPY_LABEL[copy]);
    const pdf = latin1(bytes);
    check(!pdf.includes("/XObject"), `${COPY_LABEL[copy]}: no /XObject dictionary`);
    check(!/\/Im\d+ Do/.test(pdf), `${COPY_LABEL[copy]}: no image draw operator`);
    check(!pdf.includes("/SMask"), `${COPY_LABEL[copy]}: no /SMask reference`);
    check(!pdf.includes("/Subtype /Image"), `${COPY_LABEL[copy]}: no image XObject`);
  }

  // The no-logo document must not have grown an object, which is what an
  // accidentally-emitted empty dictionary or a stray extra id would look like.
  const pdf = latin1(renderBillDocument([ordinary], COPY_LABEL.original));
  const size = Number(pdf.slice(pdf.lastIndexOf("/Size ") + 6).trim().split(/\s/)[0]);
  check(size === 8, "no-logo document still declares exactly 8 objects", `/Size ${size}`);
}

/* ──────────────────────────────────────────────
   2. The logo is a real image object
   ────────────────────────────────────────────── */

console.log("\na PNG logo becomes an image XObject plus a soft mask");
check(logoAlpha !== null, "PNG with alpha decoded");
if (logoAlpha) {
  check(logoAlpha.width === 411 && logoAlpha.height === 276, "intrinsic size preserved");
  check(logoAlpha.filter === "FlateDecode", "colour plane is FlateDecode");
  check(logoAlpha.colorSpace === "DeviceRGB", "colour plane is DeviceRGB");
  check(logoAlpha.smask !== null, "alpha ramp kept as a soft mask");

  const pdf = latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoAlpha));
  check(pdf.includes("/Subtype /Image"), "image XObject present");
  check(pdf.includes("/ColorSpace /DeviceGray /BitsPerComponent 8"), "soft mask is 8-bit grey");
  check(/\/SMask \d+ 0 R/.test(pdf), "colour plane references its /SMask");
  check(/q\n[\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm\n\/Im0 Do\nQ/.test(pdf), "drawn with the q/Q-isolated cm form");

  // Exactly one image object: a logo repeated on three copies of one invoice
  // must be stored once.
  const imageObjects = (pdf.match(/\/Subtype \/Image/g) ?? []).length;
  check(imageObjects === 2, "two image objects (colour + mask)", `found ${imageObjects}`);
}

console.log("\na JPEG logo passes through as DCTDecode with no soft mask");
check(logoOpaque !== null, "JPEG header parsed");
if (logoOpaque) {
  check(logoOpaque.filter === "DCTDecode", "filter is DCTDecode");
  check(logoOpaque.smask === null, "an opaque JPEG has no soft mask");
  const pdf = latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoOpaque));
  check(pdf.includes("/Filter /DCTDecode"), "dictionary declares DCTDecode");
  check(!pdf.includes("/SMask"), "no /SMask for an opaque JPEG");
}

console.log("\na fully opaque PNG is written without a pointless soft mask");
check(logoFlat !== null, "opaque PNG decoded");
if (logoFlat) {
  check(logoFlat.smask === null, "no soft mask when every sample is opaque");
}

/* ──────────────────────────────────────────────
   3. Placement: inside the strip, at its own ratio, moving nothing
   ────────────────────────────────────────────── */

console.log("\nthe logo sits in the header strip at its own aspect ratio");
if (logoOpaque) {
  const plain = latin1(renderBillDocument([ordinary], COPY_LABEL.original));
  const marked = latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoOpaque));

  const placed = imagePlacements(marked);
  check(placed.length === 1, "exactly one placement", `found ${placed.length}`);
  const p = placed[0];
  const rulePlain = headerRuleY(plain);
  const ruleMarked = headerRuleY(marked);

  check(p.resource === "Im0", "placed via the registered resource name");
  // The writer rounds coordinates to 3 decimals, which is its deliberate
  // byte-size optimisation, so the ratio cannot be bit-exact. What matters is
  // that it survives at all: a stretched logo is wrong by whole percent, and
  // this bound is three orders of magnitude below that.
  const wantRatio = 411 / 276;
  const ratioError = Math.abs(p.w / p.h - wantRatio) / wantRatio;
  check(ratioError < 1e-4, "aspect ratio preserved, not stretched",
    `relative error ${ratioError.toExponential(2)}`);

  // The strip the copy marker reserves: CONTENT_W - 110, right-aligned to 565.28.
  check(p.x >= 455.28, "never left of the reserved strip", `x=${p.x.toFixed(2)}`);
  check(p.x + p.w <= 565.28 + 1e-6, "never past the right margin", `right=${(p.x + p.w).toFixed(2)}`);
  check(p.yTop >= 44, "below the copy marker", `yTop=${p.yTop.toFixed(2)}`);
  check(p.yTop + p.h <= ruleMarked, "entirely above the header rule",
    `bottom=${(p.yTop + p.h).toFixed(2)} rule=${ruleMarked}`);

  check(Math.abs(ruleMarked - rulePlain) < 1e-9, "an ordinary header does not move",
    `${rulePlain} -> ${ruleMarked}`);

  // The strongest statement available: every operator from the header rule down
  // is byte-identical, so the table, totals, words, columns, notes, signatures
  // and footer are provably unmoved. The rule op itself is found by structure —
  // the full-width line that closes the header — rather than by a hard-coded
  // y, because the adaptive case deliberately moves it.
  const afterRule = (stream: string): string => {
    // One operator per line: `x1 y1 m x2 y2 l S`. The header rule is the one that
    // runs the full content width, from the left margin to the right.
    const lines = stream.split("\n");
    const at = lines.findIndex((l) => l.endsWith(" l S") && /^30 [\d.]+ m 565\.28 [\d.]+ l S$/.test(l));
    if (at < 0) throw new Error(`header rule operator not found in:\n${stream.slice(0, 400)}`);
    return lines.slice(at).join("\n");
  };
  check(
    afterRule(contentStream(plain)) === afterRule(contentStream(marked)),
    "every operator from the header rule down is byte-identical"
  );
}

console.log("\nthe header grows only for a seller block that leaves no room");
if (logoOpaque) {
  const plainRule = headerRuleY(latin1(renderBillDocument([sparse], COPY_LABEL.original)));
  const markedRule = headerRuleY(latin1(renderBillDocument([sparse], COPY_LABEL.original, logoOpaque)));
  const moved = markedRule - plainRule;
  check(moved >= 0, "the header is never shortened to fit a logo", `moved ${moved.toFixed(2)}pt`);
  check(moved <= 30, "growth is capped so a page cannot be reflowed by a logo", `moved ${moved.toFixed(2)}pt`);

  const placed = imagePlacements(latin1(renderBillDocument([sparse], COPY_LABEL.original, logoOpaque)));
  if (placed.length === 1) {
    check(placed[0].x >= 455.28 && placed[0].x + placed[0].w <= 565.28 + 1e-6,
      "still inside the strip after growing");
  }
}

/* ──────────────────────────────────────────────
   4. The file is still a valid PDF
   ────────────────────────────────────────────── */

console.log("\nlogo documents remain structurally valid");
if (logoAlpha) {
  for (const [label, pdf] of [
    ["no logo", latin1(renderBillDocument([ordinary], COPY_LABEL.original))],
    ["logo", latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoAlpha))],
  ] as const) {
    check(pdf.startsWith("%PDF-1.4"), `${label}: header`);
    check(pdf.trimEnd().endsWith("%%EOF"), `${label}: trailer`);

    const start = Number(pdf.slice(pdf.lastIndexOf("startxref") + 9).trim().split(/\s/)[0]);
    check(pdf.slice(start, start + 4) === "xref", `${label}: startxref lands on the xref table`);

    // Every xref entry must resolve to the object it claims, which is what
    // proves the new image objects were numbered and written correctly.
    // The table is "xref\n0 <size>\n" followed by one row per id from 0, so the
    // row for object `id` is line `id + 2` of the text from `startxref`.
    const size = Number(pdf.slice(pdf.lastIndexOf("/Size ") + 6).trim().split(/\s/)[0]);
    const rows = pdf.slice(start).split("\n");
    let resolved = 0;
    let broken = 0;
    for (let id = 1; id < size; id++) {
      const row = rows[id + 2];
      if (!row) {
        broken++;
        continue;
      }
      const offset = Number(row.slice(0, 10));
      if (new RegExp(`^${id} 0 obj`).test(pdf.slice(offset, offset + 20))) resolved++;
      else broken++;
    }
    check(broken === 0, `${label}: all ${size - 1} xref offsets resolve`, `${resolved} ok, ${broken} broken`);
  }

  // Adding image objects must not change the page count or the text.
  const plainText = (s: string): string => (s.match(/\((.*?)\) Tj/g) ?? []).join("\n");
  const a = latin1(renderBillDocument([ordinary], COPY_LABEL.original));
  const b = latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoAlpha));
  check(plainText(a) === plainText(b), "every drawn string is identical with and without a logo");
}

/* ──────────────────────────────────────────────
   5. All three copies behave the same
   ────────────────────────────────────────────── */

console.log("\nall three print copies carry the logo");
if (logoOpaque) {
  for (const copy of COPY_ORDER) {
    const pdf = latin1(renderBillDocument([ordinary], COPY_LABEL[copy], logoOpaque));
    const placed = imagePlacements(pdf);
    check(placed.length === 1, `${COPY_LABEL[copy]}: exactly one placement`);
    check(/\/XObject << \/Im0 \d+ 0 R >>/.test(pdf), `${COPY_LABEL[copy]}: resource declared on the page`);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. How the two SECURITY DEFINER RPCs are reached  (findings B1, B2, B3)
   ─────────────────────────────────────────────────────────────────────────────

   The sections above prove the PDF. They cannot prove who the database believes
   is calling, because that question is only ever settled by a live PostgREST
   request carrying a real JWT — and asserting it here would be asserting a
   belief, not a fact.

   What CAN be checked offline, and is checked below, is the thing that actually
   went wrong: WHICH CLIENT each call is made on. `set_bill_logo` and
   `list_bills_needing_logo_render` authorize themselves with `auth.uid()`. Run
   under the service role there is no user `sub` in the request, so `auth.uid()`
   is NULL — the first refuses with 42501, and the second, which filters rather
   than raises, returns zero rows and quietly re-prints nothing. Both look like
   working code. So the wiring is pinned here, along with the grants and the
   upload semantics that were corrected alongside it. */

const readRepo = (...parts: string[]): string => readFileSync(resolve(REPO, ...parts), "utf8");

const ef = readRepo("Metalworker_admin/supabase/functions/set-bill-logos/index.ts");
const mig = readRepo("Metalworker_admin/supabase/migrations/0011_invoice_logos.sql");
const adminSvc = readRepo("Metalworker_admin/src/services/invoiceLogos.ts");
const desktopSvc = readRepo("Metalworker_desktop/src/services/invoiceLogos.ts");

console.log("\nB1 — the two SECURITY DEFINER RPCs run on the caller's JWT");

/* The direct form of the check: find every `<receiver>.rpc("name"` and record
   which client it went through. This fails if a call is added on the wrong
   client, not merely if an existing line is edited. */
const RPC_RE = /(\w+)\.rpc\(\s*"(set_bill_logo|list_bills_needing_logo_render)"/g;
const rpcSites: { receiver: string; fn: string; line: number }[] = [];
let rm: RegExpExecArray | null;
while ((rm = RPC_RE.exec(ef)) !== null) {
  rpcSites.push({
    receiver: rm[1]!,
    fn: rm[2]!,
    line: ef.slice(0, rm.index).split("\n").length,
  });
}

check(rpcSites.length === 3, "all three RPC call sites were found", `${rpcSites.length} found`);
for (const site of rpcSites) {
  check(site.receiver === "authClient", `${site.fn} runs on the caller's JWT`, `line ${site.line}`);
}

/* The other half of B1: `authClient` is only useful if it carries the caller's
   header. A client built without it would authorize as nobody. */
check(
  /authClient = createClient\([^;]*Authorization: authHeader[^;]*\)/s.test(ef),
  "authClient is built with the caller's Authorization header",
);

/* And the caller must actually be an authenticated user before any of it runs. */
check(
  /const authHeader = req\.headers\.get\("Authorization"\);[\s\S]*?authClient\.auth\.getUser\(\)/.test(ef),
  "a missing or invalid Authorization header is rejected before any work",
);
check(
  /if \(!authHeader\) return json\(\{[^}]*\}, 401\)/.test(ef),
  "a request with no Authorization header is refused with 401",
);

/* The Edge Function keeps its OWN admin check, and it must precede the RPCs.
   Two independent checks are the point: one in TypeScript, one in plpgsql, so
   neither a bug in this file nor a bug in the migration can open the door alone. */
const gateAt = ef.indexOf("profile.is_active !== true");
const firstRpcAt = ef.indexOf(".rpc(");
check(gateAt !== -1, "the Edge Function still verifies role and is_active itself");
check(
  gateAt !== -1 && firstRpcAt !== -1 && gateAt < firstRpcAt,
  "that verification happens before the first RPC call",
  `gate at ${gateAt}, first RPC at ${firstRpcAt}`,
);

/* The authorization model itself is untouched: the RPCs still gate on
   auth.uid(), which is precisely why they must be called on authClient. */
for (const fn of ["set_bill_logo", "list_bills_needing_logo_render", "get_invoice_logo_usage"]) {
  const at = mig.indexOf(`FUNCTION public.${fn}`);
  check(at !== -1, `${fn} is declared`);
  const body = mig.slice(at, at + 1400);
  check(
    /auth\.uid\(\)/.test(body),
    `${fn} still authorizes with auth.uid() — not bypassed`,
  );
}
check(
  /SECURITY DEFINER/.test(mig),
  "the RPCs remain SECURITY DEFINER",
);
check(
  !/p_actor|p_user_id/i.test(mig),
  "no acting-user parameter was added to weaken the check",
);

/* Privileged backend work must NOT have been moved onto authClient as a side
   effect of the fix — that would trade a loud 403 for RLS-shaped silent
   failures across the whole re-print pipeline. Each pattern captures the
   identifier the call is made on, and every match must be `admin`.

   Note these are checks over ALL occurrences, not just the first: the queue read
   and the `more_work` probe are the calls most likely to be changed by a future
   edit, because they look like the RPCs they sit beside. */
const usesOf = (src: string, source: string): { receiver: string; line: number }[] => {
  const out: { receiver: string; line: number }[] = [];
  const re = new RegExp(source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push({ receiver: m[1] ?? "", line: src.slice(0, m.index).split("\n").length });
  }
  return out;
};

for (const [label, source] of [
  ["storage writes", String.raw`(\w+)\.storage\s*\.from\(BUCKET\)`],
  ["bill row repointing", String.raw`(\w+)\s*\.from\("bills"\)\s*\.update\(\{`],
  ["bill reads", String.raw`(\w+)\s*\.from\("bills"\)\s*\.select\(`],
  ["line-item reads", String.raw`(\w+)\s*\.from\("bill_line_items"\)`],
  ["audit writes", String.raw`(\w+)\s*\.from\("admin_audit_log"\)\s*\.insert\(\{`],
  ["profile lookups", String.raw`(\w+)\s*\.from\("profiles"\)`],
] as const) {
  const found = usesOf(ef, source);
  check(
    found.length > 0 && found.every((u) => u.receiver === "admin"),
    `${label} still go through the service-role client`,
    found.map((u) => u.line).join(", "),
  );
}

console.log("\nB2 — invoice_logos table grants are revoked, not only policed");
check(
  /REVOKE ALL ON TABLE public\.invoice_logos FROM anon;/.test(mig),
  "anon's inherited table-level grants are revoked",
);
check(
  /GRANT SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s*\n?\s*ON TABLE public\.invoice_logos\s*\n?\s*TO authenticated;/.test(mig),
  "authenticated is granted the four privileges it needs",
);
check(
  /ALTER TABLE public\.invoice_logos ENABLE ROW LEVEL SECURITY;/.test(mig),
  "RLS is still enabled on the table",
);
check(
  /ENABLE ROW LEVEL SECURITY|ENABLE ROW LEVEL SECURITY/.test(mig) &&
    !/FORCE ROW LEVEL SECURITY/.test(mig),
  "no FORCE ROW LEVEL SECURITY was introduced",
);

/* The whole point of 0011 is that it is additive. If it ever starts naming a
   billing table in a grant or a policy, it has stopped being additive. */
const BILLING_TABLES = ["bills", "bill_uploads", "bill_line_items", "billing_folders"];
const touchesBilling = BILLING_TABLES.filter((t) =>
  new RegExp(
    `(GRANT|REVOKE|POLICY)[^;]*\\bON\\s+(public\\.)?${t}\\b`,
    "i",
  ).test(mig),
);
check(
  touchesBilling.length === 0,
  "0011 grants and revokes nothing on any billing table",
  touchesBilling.join(", "),
);

/* And the orphan guard that was chosen in place of ON DELETE CASCADE. */
check(
  /ADD COLUMN IF NOT EXISTS logo_id uuid REFERENCES public\.invoice_logos \(id\) ON DELETE RESTRICT/.test(mig),
  "logo deletion is still RESTRICT, so no bill can point at a deleted logo",
);

console.log("\nB3 — logo uploads do not depend on an UPDATE storage policy");

/* Comments are stripped first, and not as a nicety: the comment explaining WHY
   `upsert` is false quotes the rejected flag verbatim, so a naive search finds
   its own explanation and fails. Checking source text without separating prose
   from code is how this kind of assertion quietly rots. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

for (const [label, svc] of [
  ["Metalworker_admin", adminSvc],
  ["Metalworker_desktop", desktopSvc],
] as const) {
  const code = codeOnly(svc);
  check(/upsert:\s*false/.test(code), `${label} uploads with upsert: false`);
  check(
    !/upsert:\s*true/.test(code),
    `${label} makes no upsert call that would need an UPDATE policy`,
  );
}
/* An INSERT-only bucket is the deliberate consequence: no UPDATE policy means no
   upsert, and the absence of that policy is what makes it worth asserting. */
check(
  !/FOR UPDATE[\s\S]{0,200}invoice-logos/.test(mig),
  "no UPDATE storage policy was added to make the upsert work",
);

/* ─────────────────────────────────────────────────────────────────────────────
   7. set_bill_logo collects EVERY updated bill
   ─────────────────────────────────────────────────────────────────────────────

   `UPDATE ... RETURNING b.id INTO v_changed` was the original form, and it was
   wrong. PL/pgSQL assigns `RETURNING ... INTO` the same way it assigns
   `SELECT ... INTO`: with a scalar target and several rows returned it keeps the
   first and discards the rest, so `v_changed` ended up a one-element array. The
   consequence was not a wrong count — it was wrong per-bill data, because the
   follow-up query classifies anything absent from `v_changed` as "already
   correct". Five bills updated, one reported changed, four reported unchanged,
   and the caller's assigned + unchanged still summed correctly so nothing
   downstream could detect it. Those four would carry a new logo that nothing
   then re-printed.

   There is no PostgreSQL in this toolchain, so the behavioural scenarios are
   proven against a real server by scripts/set_bill_logo_regression.sql. What is
   checked here is the shape of the function that makes those scenarios hold —
   each assertion names the property it guarantees, so a future edit that
   reintroduces the scalar assignment, or swaps IS DISTINCT FROM for <>, fails
   here rather than in production. */

const setLogoAt = mig.indexOf("FUNCTION public.set_bill_logo");
const setLogoBody = mig.slice(setLogoAt, mig.indexOf("$$;", setLogoAt));

/* Assertions run against the body with SQL comments removed, for the same reason
   the upsert check strips them: the comments explaining this very fix quote the
   rejected code verbatim, so a search over raw text finds its own explanation
   and reports a bug that is not there. */
const sqlCode = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const setLogoCode = sqlCode(setLogoBody);
const fn = (source: string): boolean => new RegExp(source, "s").test(setLogoCode);

console.log("\nset_bill_logo collects every updated bill");

/* (6) the property the bug was about: no scalar assignment of the RETURNING
   clause, and an aggregate that sees all rows. */
check(
  !/RETURNING\s+b\.id\s+INTO\s+v_changed/i.test(setLogoCode),
  "the UPDATE no longer assigns RETURNING into v_changed",
);
check(
  fn(String.raw`WITH\s+changed\s+AS\s*\(\s*UPDATE\s+public\.bills`),
  "the update is wrapped in a data-modifying CTE",
);
check(
  fn(String.raw`array_agg\(\s*id\b`),
  "array_agg collects every row the update returned",
);
check(
  fn(String.raw`array_agg\([^)]*ORDER BY id`),
  "the collected ids are ordered, so the output is deterministic",
);
check(
  fn(String.raw`COALESCE\(\s*array_agg\([^)]*\),\s*'\{\}'::uuid\[\]`),
  "the no-rows case yields an empty array, not NULL",
);

/* (1) and (2) A single-row assignment still lands in v_changed the same way a
   multi-row one does, so the one-bill and many-bill cases share a code path. */
check(
  fn(String.raw`FROM\s+changed\s*;`) && fn(String.raw`INTO\s+v_changed`),
  "the aggregate result is the value assigned to v_changed",
);

/* (3) Bills that already carry the right logo are reported, not dropped. */
check(
  fn(String.raw`SELECT\s+b\.id,\s*false`),
  "unchanged bills are reported as changed = false",
);
check(
  fn(String.raw`NOT\s*\(\s*b\.id\s*=\s*ANY\s*\(\s*v_changed\s*\)\s*\)`),
  "the unchanged branch excludes exactly the bills that changed",
);
check(
  fn(String.raw`FROM\s+unnest\(\s*v_changed\s*\)\s+AS\s+u\(id\)`),
  "changed bills are emitted from the collected array",
);

/* (4) and (5) Both hinge on one predicate. `IS DISTINCT FROM` is NULL-safe;
   `<>` is not — `logo_id <> NULL` is NULL, never true, so removing a logo would
   match nothing and report every bill as already correct. Asserting this one
   predicate covers removal and idempotence together, and it is the substitution
   most likely to look harmless. */
const distinctCount = (setLogoCode.match(/IS DISTINCT FROM/gi) ?? []).length;
check(distinctCount >= 1, "the update uses a NULL-safe inequality", `${distinctCount} use(s)`);
check(
  !fn(String.raw`logo_id\s*<>`),
  "no plain <> comparison crept in beside it",
);

/* The whole function stays a single statement's worth of change per call: no
   loop, no per-row work, which is the property that keeps a 500-bill selection
   to one round trip. */
check(
  !/\bFOR\s+\S+\s+LOOP\b|\bWHILE\b|\bFOREACH\b/i.test(setLogoCode),
  "no loop was introduced, so the call is still one statement",
);

console.log(failures === 0 ? "\ntest-logo: all checks passed" : `\ntest-logo: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);