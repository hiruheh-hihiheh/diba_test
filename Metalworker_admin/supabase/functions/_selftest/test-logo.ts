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
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_LABEL, COPY_ORDER, type BillCopy, type CopyKind } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { decodePdfImage, deflate } from "../process-bill-upload/_shared/pdfImage.ts";
// The client's own fit function, imported rather than re-implemented: a test that
// restates the geometry it is checking proves only that the restatement is
// self-consistent. This file has no imports from `src/`, so it is safe to load
// under bare Node.
import {
  fitLogoWithinLimits,
  INVOICE_LOGO_MAX_EDGE,
  INVOICE_LOGO_MAX_PIXELS,
} from "../../../src/types/invoiceLogo.ts";

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

/* ──────────────────────────────────────────────
   Page geometry, and reading the letterhead back out
   ────────────────────────────────────────────── */

/**
 * The page numbers the renderer works in, restated here so the assertions below
 * can be written against the document's own margins rather than against whatever
 * a stroke happens to measure.
 */
const PAGE_H = 841.89;
const MARGIN_X = 30;
const CONTENT_W = 535.28;
const RIGHT_EDGE = MARGIN_X + CONTENT_W; // 565.28
/** Below this the renderer is into the bottom margin, which is the footer's. */
const CONTENT_BOTTOM = PAGE_H - 34;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Every STROKED rectangle, in top-down coordinates.
 *
 * Stroke-only on purpose: the letterhead border and the logo compartment are both
 * hairlines, while the filled rules and the tinted table headers elsewhere on the
 * page are `f` or `f`+`S`. Requiring `re` immediately followed by `S` therefore
 * picks out exactly the boxes that frame something and nothing else.
 */
function strokedRects(pdf: string): Box[] {
  const out: Box[] = [];
  for (const m of pdf.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\nS/g)) {
    const w = Number(m[3]);
    const h = Number(m[4]);
    out.push({ x: Number(m[1]), y: PAGE_H - Number(m[2]) - h, w, h });
  }
  return out;
}

/** Every stroked straight line, as a top-down segment. */
function strokedLines(pdf: string): Box[] {
  const out: Box[] = [];
  for (const m of pdf.matchAll(/([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g)) {
    const x1 = Number(m[1]);
    const x2 = Number(m[3]);
    const y1 = PAGE_H - Number(m[2]);
    const y2 = PAGE_H - Number(m[4]);
    out.push({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    });
  }
  return out;
}

interface PlacedText {
  size: number;
  x: number;
  /** The text's BASELINE, in top-down coordinates. */
  y: number;
  text: string;
}

/** Every drawn string, with the size and baseline it was set at. */
function textPlacements(pdf: string): PlacedText[] {
  const out: PlacedText[] = [];
  const re = /\/F\d+ ([\d.-]+) Tf\n1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\n\((.*?)\) Tj/g;
  for (const m of pdf.matchAll(re)) {
    out.push({ size: Number(m[1]), x: Number(m[2]), y: PAGE_H - Number(m[3]), text: m[4] });
  }
  return out;
}

/**
 * The ink a left-aligned string occupies, generously.
 *
 * `y` is a baseline, so the glyphs sit above it. Helvetica-Bold's cap height is
 * 718/1000 em and its descender 212/1000, and rounding both outwards keeps this a
 * superset of the real ink — a box that clears this cannot clip anything.
 */
function inkBox(t: PlacedText): Box {
  return { x: t.x, y: t.y - t.size * 0.72, w: Number.POSITIVE_INFINITY, h: t.size * 0.94 };
}

/** Two boxes overlap if their interiors intersect. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The letterhead's two boxes, read back out of a finished page.
 *
 * Everything is identified by shape rather than by a hard-coded coordinate: the
 * border is the one stroked rectangle that spans the full content width, and the
 * compartment is the one strictly nested inside it. That way the test cannot pass
 * by agreeing with the renderer about a literal — if the layout moved, these
 * still find the boxes.
 */
function letterhead(pdf: string): { border: Box; compartment: Box | null } {
  const all = strokedRects(pdf);
  const border = all.find(
    (b) => Math.abs(b.w - CONTENT_W) < 0.01 && Math.abs(b.x - MARGIN_X) < 0.01
  );
  if (!border) return { border: null as unknown as Box, compartment: null };
  const inside = all.filter(
    (b) =>
      b !== border &&
      b.x >= border.x - 0.01 &&
      b.y >= border.y - 0.01 &&
      b.x + b.w <= border.x + border.w + 0.01 &&
      b.y + b.h <= border.y + border.h + 0.01
  );
  return { border, compartment: inside[0] ?? null };
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

/* The letterhead redesign adds a border, a compartment and an image to the
   header. None of that may reach a document with no logo — not one byte.

   "Looks unchanged" is not a claim worth much here: shifting a baseline by a
   point, dropping an empty dictionary, or renumbering an object all leave a
   document that still looks right. So the bytes themselves are pinned. These are
   the SHA-256 digests of the no-logo renderings as they stood before the logo
   letterhead existed, taken from sheet 301 of `BILL 301 TO.xlsx` — a real
   seller block with a name, descriptor, GST line, address and contact, which is
   the fullest header anything in the fixtures produces. If a change to the
   header, the type scale or the PDF writer perturbs a no-logo invoice by so much
   as a byte, these fail and say which copy moved. */
const NO_LOGO_DIGESTS: Record<CopyKind, string> = {
  original: "b76c2e51c7eab106e986837760bac04639cfea9979188abd72ffefbfe0047812",
  duplicate: "574ab94954e7500d6a738f9f767a8ae2c4fc4d4d0ce0b00fa0c555bedac046f0",
  triplicate: "a27f092902cad94e2e992c7952a9e9d6904f88738f62df3de0103c5561a36ade",
};

console.log("\nno-logo renders are byte-identical to the pre-letterhead documents");
{
  for (const copy of COPY_ORDER) {
    const bytes = renderBillDocument([found[copy]], COPY_LABEL[copy]);
    const digest = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const want = NO_LOGO_DIGESTS[copy];
    check(
      digest === want,
      `${COPY_LABEL[copy]}: sha256 matches the pinned pre-letterhead bytes`,
      digest === want ? "" : `${bytes.length}B got ${digest.slice(0, 16)} want ${want.slice(0, 16)}`
    );
  }

  // And the header of a no-logo invoice still has no frame of any kind: the border
  // and the compartment are drawn only when a logo is present.
  const rule = headerRuleY(latin1(renderBillDocument([ordinary], COPY_LABEL.original)));
  const above = strokedRects(latin1(renderBillDocument([ordinary], COPY_LABEL.original)))
    .filter((b) => b.y + b.h <= rule + 0.01);
  check(above.length === 0, "no stroked rectangle anywhere in the no-logo header", `found ${above.length}`);
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
   3. The letterhead: a bordered box, a compartment, and no collisions
   ────────────────────────────────────────────── */

console.log("\nthe letterhead draws a border and a compartment around the logo");
if (logoOpaque) {
  const plain = latin1(renderBillDocument([ordinary], COPY_LABEL.original));
  const marked = latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoOpaque));
  const rulePlain = headerRuleY(plain);
  const ruleMarked = headerRuleY(marked);
  const { border, compartment } = letterhead(marked);

  /* --- the border ------------------------------------------------------- */
  check(border !== null, "the letterhead border is drawn when a logo is present");
  check(
    Math.abs(border.x - MARGIN_X) < 0.01 && Math.abs(border.w - CONTENT_W) < 0.01,
    "the border spans the full content width, margin to margin",
    `x=${border.x} w=${border.w}`
  );
  check(border.y > 0, "the border sits below the top margin", `y=${border.y}`);
  check(
    border.y + border.h <= ruleMarked + 0.01,
    "the border closes above the header rule",
    `bottom=${(border.y + border.h).toFixed(2)} rule=${ruleMarked}`
  );

  /* --- the compartment -------------------------------------------------- */
  check(compartment !== null, "the logo compartment is drawn inside the border");
  check(
    compartment.x > border.x && compartment.y > border.y &&
      compartment.x + compartment.w < border.x + border.w &&
      compartment.y + compartment.h < border.y + border.h,
    "the compartment is strictly inside the border, on all four sides"
  );
  const padLeft = compartment.x - border.x;
  const padRight = border.x + border.w - (compartment.x + compartment.w);
  const padTop = compartment.y - border.y;
  const padBottom = border.y + border.h - (compartment.y + compartment.h);
  // The compartment is left-aligned, so only the left/top/bottom padding is the
  // border's own margin — the space on the right is the company text's column,
  // not padding. Those three must agree, or the box would look off-centre.
  check(
    Math.abs(padLeft - padTop) < 0.01 && Math.abs(padLeft - padBottom) < 0.01,
    "the border's padding is even on the left, top and bottom",
    `l=${padLeft} t=${padTop} b=${padBottom}`
  );
  check(padLeft > 0 && padTop > 0, "the padding is real clear space, not zero");
  check(
    padRight > padLeft * 4,
    "the compartment leaves the rest of the letterhead for the company text",
    `right=${padRight.toFixed(2)} left=${padLeft}`
  );
  // 18-25% of the letterhead width: a mark of that share reads as a letterhead
  // rather than as an illustration dropped into the corner.
  const share = (compartment.w / CONTENT_W) * 100;
  check(
    share >= 18 && share <= 25,
    "the compartment is 18-25% of the letterhead width",
    `${share.toFixed(1)}%`
  );
  check(
    compartment.x < border.x + border.w / 2,
    "the compartment is on the LEFT of the letterhead",
    `x=${compartment.x} mid=${(border.x + border.w / 2).toFixed(2)}`
  );

  /* --- the logo sits inside the compartment ------------------------------ */
  const placed = imagePlacements(marked);
  check(placed.length === 1, "exactly one placement", `found ${placed.length}`);
  const p = placed[0];
  check(p.resource === "Im0", "placed via the registered resource name");

  // The writer rounds coordinates to 3 decimals, which is its deliberate
  // byte-size optimisation, so the ratio cannot be bit-exact. What matters is
  // that it survives at all: a stretched logo is wrong by whole percent, and
  // this bound is three orders of magnitude below that.
  const wantRatio = 411 / 276;
  const ratioError = Math.abs(p.w / p.h - wantRatio) / wantRatio;
  check(
    ratioError < 1e-4,
    "aspect ratio preserved, not stretched",
    `relative error ${ratioError.toExponential(2)}`
  );

  const inset = {
    left: p.x - compartment.x,
    right: compartment.x + compartment.w - (p.x + p.w),
    top: p.yTop - compartment.y,
    bottom: compartment.y + compartment.h - (p.yTop + p.h),
  };
  check(
    inset.left > 0 && inset.right > 0 && inset.top > 0 && inset.bottom > 0,
    "the logo never touches the compartment's border",
    `l=${inset.left.toFixed(2)} r=${inset.right.toFixed(2)} t=${inset.top.toFixed(2)} b=${inset.bottom.toFixed(2)}`
  );
  // Centred on both axes: a mark that hugs one edge reads as misaligned.
  check(
    Math.abs(inset.left - inset.right) < 0.05,
    "the logo is horizontally centred in its compartment",
    `l=${inset.left.toFixed(2)} r=${inset.right.toFixed(2)}`
  );
  check(
    Math.abs(inset.top - inset.bottom) < 0.05,
    "the logo is vertically centred in its compartment",
    `t=${inset.top.toFixed(2)} b=${inset.bottom.toFixed(2)}`
  );

  /* --- the company text is to the RIGHT of the compartment --------------- */
  const headerTexts = textPlacements(marked).filter((t) => t.y <= ruleMarked + 0.01);
  const seller = headerTexts.filter((t) => t.text !== "ORIGINAL");
  check(seller.length > 0, "the seller block is still drawn");
  const firstLine = seller[0];
  check(
    firstLine.x >= compartment.x + compartment.w,
    "the company text starts to the right of the compartment",
    `text x=${firstLine.x} compartment right=${compartment.x + compartment.w}`
  );
  check(
    Math.abs(firstLine.x - (compartment.x + compartment.w) - 12) < 0.01,
    "the gap between compartment and text is the designed clear space",
    `gap=${(firstLine.x - (compartment.x + compartment.w)).toFixed(2)}pt`
  );
  check(
    seller.every((t) => t.x >= compartment.x + compartment.w),
    "every seller line starts right of the compartment, not just the first"
  );
  // Left-aligned, which is the requirement: the first line is flush with every
  // other line's left edge, and the seller name is the strongest thing in it.
  check(
    seller.every((t) => Math.abs(t.x - firstLine.x) < 0.01),
    "the company text is left-aligned, not centred",
    `xs=${[...new Set(seller.map((t) => t.x))].join(",")}`
  );
  check(
    Math.max(...seller.map((t) => t.size)) === firstLine.size &&
      firstLine.size > Math.max(...seller.filter((t) => t !== firstLine).map((t) => t.size)),
    "the seller's name is still the largest type in the letterhead",
    `${firstLine.size}pt over ${Math.max(...seller.filter((t) => t !== firstLine).map((t) => t.size))}pt`
  );

  /* --- ORIGINAL is outside the border ------------------------------------ */
  const mark = headerTexts.find((t) => t.text === "ORIGINAL");
  check(mark !== undefined, "the copy marker is still drawn");
  if (mark) {
    check(
      mark.y < border.y,
      "ORIGINAL's baseline is ABOVE the border — outside the box",
      `baseline=${mark.y} border top=${border.y}`
    );
    // Caps have no descender, so the ink stops at the baseline. The gap between
    // the two is the clearance a reader actually sees.
    const clearance = border.y - mark.y;
    check(clearance >= 6, "there is clear space between ORIGINAL and the border", `${clearance.toFixed(2)}pt`);
    // Ink from the top of the sheet: printers cannot reach the first few
    // millimetres, and the mark must not be the thing that gets shaved off.
    const inkFromTop = mark.y - mark.size * 0.72;
    check(
      inkFromTop >= 14,
      "ORIGINAL's ink keeps clear of the unprintable top margin",
      `${inkFromTop.toFixed(2)}pt from the sheet edge`
    );
    check(
      Math.abs(mark.x + mark.text.length * mark.size * 0.5 - RIGHT_EDGE) < 40 &&
        mark.x <= RIGHT_EDGE,
      "ORIGINAL is right-aligned to the content edge",
      `x=${mark.x} right edge=${RIGHT_EDGE}`
    );
  }

  /* --- nothing collides -------------------------------------------------- */
  if (mark) {
    const markInk = inkBox(mark);
    check(
      !overlaps(markInk, border),
      "ORIGINAL does not overlap the letterhead border",
      `ink ${markInk.y.toFixed(2)}..${(markInk.y + markInk.h).toFixed(2)} vs border ${border.y}..${(border.y + border.h).toFixed(2)}`
    );
    check(
      !overlaps(markInk, compartment),
      "ORIGINAL does not overlap the logo compartment"
    );
  }
  /* The logo and the company text are the two things most likely to collide, and
     the collision that matters is horizontal: the seller block is left-aligned,
     so its ink starts at its x and runs rightwards. If the logo's right edge is
     clear of that x, no seller line can reach it — which is a stronger statement
     than testing the rendered glyph boxes, because it holds for the longest line
     too rather than for whatever happened to be longest on this fixture. */
  const logoBox = { x: p.x, y: p.yTop, w: p.w, h: p.h };
  check(
    p.x + p.w <= firstLine.x,
    "the logo's right edge stops short of where the company text begins",
    `logo right=${(p.x + p.w).toFixed(2)} text x=${firstLine.x}`
  );
  check(
    seller.every((t) => !overlaps(logoBox, inkBox(t))),
    "no seller line's ink overlaps the logo"
  );
  check(
    !overlaps(logoBox, { ...compartment, x: compartment.x + compartment.w, w: 0 }),
    "the logo does not spill out of the compartment's right edge",
    `logo right=${(p.x + p.w).toFixed(2)} compartment right=${(compartment.x + compartment.w).toFixed(2)}`
  );
  const gapToText = firstLine.x - (compartment.x + compartment.w);
  check(gapToText > 0, "there is clear space between the logo and the company text", `${gapToText.toFixed(2)}pt`);
  check(
    seller.every((t) => !overlaps(inkBox(t), compartment)),
    "no seller line intrudes into the logo compartment"
  );

  /* --- everything below the header moves as one block -------------------- */
  const growth = ruleMarked - rulePlain;
  check(growth > 0, "the bordered header is taller than the plain one", `${growth}pt`);

  // The body's own strings, compared as multisets of (text, y) pairs. Index-by-
  // index is meaningless here: the seller block re-wraps into an extra line, so
  // every subsequent index shifts.
  const below = (pdf: string, rule: number) =>
    textPlacements(pdf)
      .filter((t) => t.y > rule + 0.01 && t.y <= CONTENT_BOTTOM)
      .map((t) => `${t.text}\u0000${t.y.toFixed(3)}`);
  const shifted = (pdf: string, rule: number, by: number) =>
    textPlacements(pdf)
      .filter((t) => t.y > rule + 0.01 && t.y <= CONTENT_BOTTOM)
      .map((t) => `${t.text}\u0000${(t.y - by).toFixed(3)}`);
  const sortCount = (xs: string[]) => xs.sort();
  const a = sortCount(shifted(marked, ruleMarked, growth));
  const b = sortCount(below(plain, rulePlain));
  check(
    a.length === b.length && a.every((v, i) => v === b[i]),
    "the whole body is the same strings, shifted down by exactly the header growth",
    `${a.length} strings, growth ${growth}pt`
  );

  /* Text alone is not enough: the item table's rules, the GST table's outline and
     the totals box are strokes, and a body that kept its words but redrew its
     rules would still be a changed invoice. So the graphics are compared the same
     way — every stroked rectangle and line below the header, shifted back by the
     growth, must be the identical set. Read out of the raw content stream so the
     comparison sees the operators the writer actually emitted. */
  /* Rounded to the writer's own 3-decimal precision before comparing. Subtracting
     the growth from a coordinate introduces representation error of its own —
     479.2 comes back as 479.20000000000005 — and comparing those raw would fail on
     arithmetic noise rather than on a difference anyone could see printed. */
  const graphics = (pdf: string, rule: number, by: number): string[] => {
    const stream = contentStream(pdf);
    const boxes = [...strokedRects(stream), ...strokedLines(stream)].filter(
      (b) => b.y > rule + 0.01
    );
    return boxes.map((b) => `${b.x.toFixed(3)} ${(b.y - by).toFixed(3)} ${b.w.toFixed(3)} ${b.h.toFixed(3)}`).sort();
  };
  const ga = graphics(marked, ruleMarked, growth);
  const gb = graphics(plain, rulePlain, 0);
  check(ga.length > 0, "the body draws strokes of its own", `${ga.length} rectangles and lines`);
  check(
    ga.length === gb.length && ga.every((v, i) => v === gb[i]),
    "every rule and box below the header is the same, shifted by the growth",
    ga.length === gb.length ? "" : `${ga.length} vs ${gb.length}`
  );

  // The footer is the one thing that must NOT move: it is anchored to the page,
  // not to the flow, and a footer that slid down the sheet would change on every
  // invoice that happened to carry a logo.
  const footer = (pdf: string) =>
    sortCount(textPlacements(pdf).filter((t) => t.y > CONTENT_BOTTOM).map((t) => `${t.text}\u0000${t.y.toFixed(3)}`));
  const fa = footer(marked);
  const fb = footer(plain);
  check(fa.length > 0, "the footer is drawn", `${fa.length} strings`);
  check(
    fa.length === fb.length && fa.every((v, i) => v === fb[i]),
    "the footer does not move at all",
    fb.length === fa.length ? "" : `${fa.length} vs ${fb.length}`
  );
}

console.log("\nthe header is bounded, and no invoice is reflowed onto a second page");
if (logoOpaque) {
  // Growth must be non-negative: a logo may take room, never give it back.
  const plainRule = headerRuleY(latin1(renderBillDocument([sparse], COPY_LABEL.original)));
  const markedRule = headerRuleY(latin1(renderBillDocument([sparse], COPY_LABEL.original, logoOpaque)));
  const moved = markedRule - plainRule;
  check(moved >= 0, "the header is never shortened to fit a logo", `moved ${moved.toFixed(2)}pt`);
  check(moved <= 60, "growth is capped", `moved ${moved.toFixed(2)}pt`);

  // A seller with nothing but a name gets a compartment a logo can actually be
  // seen in, not one squeezed into the 20pt the plain header leaves.
  const sparseMarked = latin1(renderBillDocument([sparse], COPY_LABEL.original, logoOpaque));
  const sparseLh = letterhead(sparseMarked);
  check(sparseLh.compartment !== null, "a name-only seller still gets a compartment");
  if (sparseLh.compartment) {
    check(
      sparseLh.compartment.h >= 30,
      "and the compartment is big enough to hold a legible mark",
      `${sparseLh.compartment.h.toFixed(2)}pt tall`
    );
  }
  const sparsePlaced = imagePlacements(sparseMarked);
  check(sparsePlaced.length === 1, "and the logo is still drawn in it", `found ${sparsePlaced.length}`);
  if (sparsePlaced.length === 1 && sparseLh.compartment) {
    const sp = sparsePlaced[0];
    check(
      sp.x > sparseLh.compartment.x - 0.01 &&
        sp.x + sp.w < sparseLh.compartment.x + sparseLh.compartment.w + 0.01,
      "and it is still contained by it"
    );
  }

  /* The bound that actually matters is pagination. Growth translates everything
     below the rule, so the only damage it can do is push a block off the page —
     and whether it does depends on how full each individual invoice is, not on
     the seller block alone. So it is checked against every copy of every bill in
     both fixture workbooks, each against its own no-logo page count. A logo is
     allowed on an invoice that was already two pages — three of the twenty in
     `BILL 301 TO.xlsx` are — but it may not turn a one-page invoice into two. */
  const pageCount = (bytes: Uint8Array): number =>
    (latin1(bytes).match(/\/Type \/Page[^s]/g) ?? []).length;
  const regressed: string[] = [];
  let checked = 0;
  for (const file of ["SAMPLE.xlsx", "BILL 301 TO.xlsx"]) {
    const wb = await readXlsx(readFileSync(resolve(REPO, file)));
    for (const bill of parseBills(wb.sheets).bills) {
      for (const copy of COPY_ORDER) {
        const bc = bill[copy];
        if (!bc) continue;
        checked++;
        const without = pageCount(renderBillDocument([bc], COPY_LABEL[copy]));
        const withLogo = pageCount(renderBillDocument([bc], COPY_LABEL[copy], logoOpaque));
        if (withLogo > without) {
          regressed.push(`${file}/${bill.sheetName}/${COPY_LABEL[copy]} ${without}->${withLogo}`);
        }
      }
    }
  }
  check(checked > 0, "every fixture copy was checked", `${checked} documents`);
  check(
    regressed.length === 0,
    "no invoice is pushed onto a second page by its logo",
    regressed.length ? regressed.join("; ") : `${checked} copies, no regression`
  );
}

/* A logo arrives as whatever file the customer uploaded. The compartment is a
   fixed box, so the fit has to be correct for every shape it might be handed —
   not just for one particular logo. Each case below asserts the two properties
   that together mean "not distorted": the drawn box has the same aspect ratio as
   the source pixels, and it is contained by the compartment with clear space on
   every side. */
console.log("\nevery logo shape fits its compartment without distortion");
{
  const cases: [string, number, number][] = [
    ["SAASTHA letterhead (411x276, the shape the box was drawn for)", 411, 276],
    ["square (600x600)", 600, 600],
    ["tall portrait (200x900)", 200, 900],
    ["very wide banner (1600x200)", 1600, 200],
    ["tiny (24x24)", 24, 24],
  ];
  for (const [label, w, h] of cases) {
    const decoded = await decodePdfImage(syntheticJpeg(w, h));
    if (!decoded) {
      check(false, `${label}: decodes`);
      continue;
    }
    const pdf = latin1(renderBillDocument([ordinary], COPY_LABEL.original, decoded));
    const { compartment } = letterhead(pdf);
    const placed = imagePlacements(pdf);
    check(compartment !== null, `${label}: compartment present`);
    check(placed.length === 1, `${label}: drawn once`, `found ${placed.length}`);
    if (!compartment || placed.length !== 1) continue;
    const p = placed[0];

    const want = w / h;
    const got = p.w / p.h;
    check(
      Math.abs(got - want) / want < 1e-3,
      `${label}: aspect ratio preserved`,
      `${w}x${h} -> ${p.w.toFixed(2)}x${p.h.toFixed(2)} (${want.toFixed(4)} vs ${got.toFixed(4)})`
    );
    const inside =
      p.x >= compartment.x - 0.01 &&
      p.yTop >= compartment.y - 0.01 &&
      p.x + p.w <= compartment.x + compartment.w + 0.01 &&
      p.yTop + p.h <= compartment.y + compartment.h + 0.01;
    check(inside, `${label}: contained by the compartment with clearance`);
    check(
      p.h >= 12,
      `${label}: not shrunk below legibility`,
      `${p.h.toFixed(2)}pt tall`
    );
    // Containment is what proves the mark touched no edge: had it overflowed it
    // would have been clipped, and had it been squeezed it would not have kept
    // its ratio. Both are asserted above.
    check(
      p.h <= compartment.h && p.w <= compartment.w,
      `${label}: never larger than the compartment in either axis`
    );
  }

  // A transparent PNG must survive the same journey, soft mask and all.
  const alphaWide = await decodePdfImage(await syntheticPng(900, 300, "ramp"));
  if (alphaWide) {
    const pdf = latin1(renderBillDocument([ordinary], COPY_LABEL.original, alphaWide));
    const { compartment } = letterhead(pdf);
    const placed = imagePlacements(pdf);
    check(pdf.includes("/SMask"), "a transparent PNG keeps its soft mask");
    check(compartment !== null && placed.length === 1, "a transparent PNG is placed once");
    if (compartment && placed.length === 1) {
      const p = placed[0];
      const want = 900 / 300;
      check(Math.abs(p.w / p.h - want) / want < 1e-3, "a transparent PNG keeps its ratio too");
      check(
        p.x >= compartment.x - 0.01 && p.x + p.w <= compartment.x + compartment.w + 0.01,
        "a transparent PNG is contained by the compartment"
      );
    }
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

  /* The seller block is re-wrapped when a logo is present, because its column is
     narrower — the compartment takes the left of the letterhead and the text
     wraps to what is left. So the drawn strings are NOT identical between the two
     documents, and pretending otherwise would be a test that can only pass if the
     logo were removed. What has to hold is that the words are all still there, in
     the same order, with none dropped, duplicated or reordered by the narrower
     column. Whitespace is removed because it is exactly what re-wrapping moves. */
  const words = (pdf: string, rule: number): string =>
    textPlacements(pdf)
      .filter((t) => t.y <= rule + 0.01)
      .map((t) => t.text)
      .join("")
      .replace(/\s+/g, "");
  const a = words(latin1(renderBillDocument([ordinary], COPY_LABEL.original)), headerRuleY(latin1(renderBillDocument([ordinary], COPY_LABEL.original))));
  const b = words(latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoAlpha)), headerRuleY(latin1(renderBillDocument([ordinary], COPY_LABEL.original, logoAlpha))));
  check(a.length > 0, "the header draws words", `${a.length} characters`);
  check(
    a === b,
    "the letterhead says exactly the same words with and without a logo",
    a === b ? "" : `${a.length} vs ${b.length} characters`
  );
  check(
    ordinary.sellerName.replace(/\s+/g, "") !== "" &&
      b.includes(ordinary.sellerName.replace(/\s+/g, "")),
    "including the seller's name, spelled the same"
  );
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

console.log("\n7b. the migration's statements run in an order Postgres accepts");
/* This one earned its place the hard way. `bills_logo_id_idx` was created while
   it sat with the other indexes, above the ALTER that adds `bills.logo_id`, so
   applying the migration failed outright with "column logo_id does not exist".
   Nothing here could have caught it — the SQL is not executed by this suite, and
   the file is not valid to run until the migration it tests has been applied.
   So what is checked is the only thing checkable offline: that the order in the
   file is one Postgres will accept. */
{
  const at = (needle: string): number => mig.indexOf(needle);
  const createLogos = at("CREATE TABLE IF NOT EXISTS public.invoice_logos");
  const addLogo = at("ADD COLUMN IF NOT EXISTS logo_id uuid");
  const addRendered = at("ADD COLUMN IF NOT EXISTS logo_rendered_logo_id");
  const nameIdx = at("CREATE INDEX IF NOT EXISTS invoice_logos_name_idx");
  const billsIdx = at("CREATE INDEX IF NOT EXISTS bills_logo_id_idx");

  check(
    createLogos !== -1 && addLogo !== -1 && nameIdx !== -1 && billsIdx !== -1,
    "every statement this ordering depends on is present",
    `table=${createLogos} logo=${addLogo} rendered=${addRendered} name_idx=${nameIdx} bills_idx=${billsIdx}`,
  );

  /* The regression itself: an index on a column that does not exist yet. */
  check(
    addLogo !== -1 && billsIdx !== -1 && addLogo < billsIdx,
    "bills_logo_id_idx is created after bills.logo_id exists",
    `ADD COLUMN at ${addLogo}, index at ${billsIdx}`,
  );
  check(
    createLogos !== -1 && nameIdx !== -1 && createLogos < nameIdx,
    "invoice_logos_name_idx is created after its table exists",
  );
  check(
    addLogo !== -1 && addRendered !== -1 && addLogo < addRendered,
    "both ALTERs precede every index",
  );
  check(
    nameIdx !== -1 && billsIdx !== -1 && nameIdx < billsIdx,
    "both indexes come after the ALTERs, as the migration states",
  );

  /* `set_bill_logo`'s own doc comment says nothing about ordering, but the
     functions read both new columns, so they must come after both ALTERs too. */
  const firstFn = at("CREATE OR REPLACE FUNCTION public.get_invoice_logo_usage");
  check(
    addRendered !== -1 && firstFn !== -1 && addRendered < firstFn,
    "no function is defined before the columns it reads exist",
  );

  /* And nothing may have crept in that would need the column earlier. */
  const earlyIdx = mig.slice(0, addLogo);
  check(
    !/ON\s+(public\.)?bills\s*\(/i.test(earlyIdx),
    "nothing indexes bills on a logo column before the ALTER adds it",
  );
}

console.log("\n8. the upload fit, and the embed that resolves the logo<->bills relation");
/* Two live UI failures, and one of them was a latent trap rather than a typo.

   THE EMBED. `fetchInvoiceLogos` asked for `bills!bills_logo_id_idx(count)` — an
   INDEX name as the relationship hint. PostgREST will accept an index name there,
   but only an index it can read as a relationship, and `bills_logo_id_idx` is
   PARTIAL (`WHERE logo_id IS NOT NULL`). So no relationship exists to be found and
   the request fails with "Could not find a relationship between 'invoice_logos'
   and 'bills' in the schema cache" — a message that reads like stale metadata and
   is not. `NOTIFY pgrst, 'reload schema'` cannot fix it. The hint has to be the
   constraint name, `bills_logo_id_fkey`, which is what the other query in the same
   file already uses successfully.

   THE FIT. `fitLogoWithinLimits` is exercised directly below, because the
   geometry is the part that silently produces an unprintable logo if it is wrong. */
{
  const adminSvc = readRepo("Metalworker_admin/src/services/invoiceLogos.ts");
  const desktopSvc = readRepo("Metalworker_desktop/src/services/invoiceLogos.ts");
  const types = readRepo("Metalworker_admin/src/types/invoiceLogo.ts");

  for (const [label, svc] of [
    ["Metalworker_admin", adminSvc],
    ["Metalworker_desktop", desktopSvc],
  ] as const) {
    check(
      /bills!bills_logo_id_fkey\(count\)/.test(svc),
      `${label} embeds the count through the foreign key, not the index`,
    );
    check(
      !/bills!bills_logo_id_idx\(/.test(svc),
      `${label} no longer names the partial index as a relationship hint`,
    );
    check(
      /!bills_logo_id_fkey\(/.test(svc),
      `${label} keeps the working bills-side embed intact`,
    );
  }

  /* The real function, not a description of it. */
  check(typeof fitLogoWithinLimits === "function", "fitLogoWithinLimits is importable");

  const within = (w: number, h: number) => w <= 3000 && h <= 3000 && w * h <= 4_000_000;

  // The reported case, verbatim.
  const sq = fitLogoWithinLimits(16667, 16667);
  check(sq.resized, "a 16667 x 16667 logo is resized");
  check(within(sq.width, sq.height), `16667 x 16667 fits inside both limits`, `${sq.width} x ${sq.height}`);
  check(
    sq.width === sq.height,
    "a square stays square — the aspect ratio is preserved exactly",
    `${sq.width} x ${sq.height}`,
  );
  // 3000 x 3000 would be 9,000,000 pixels and be refused by pdfImage.ts:385. The
  // whole point of taking the smaller scale.
  check(
    !(sq.width === 3000 && sq.height === 3000),
    "the fit does not stop at the 3000px edge and blow the pixel cap",
  );

  // Aspect ratio is preserved, not stretched, for awkward shapes.
  for (const [w, h] of [
    [16667, 5000],
    [5000, 16667],
    [4001, 2500],
    [3001, 1],
  ] as const) {
    const fit = fitLogoWithinLimits(w, h);
    const before = w / h;
    const after = fit.width / fit.height;
    check(
      fit.resized && within(fit.width, fit.height),
      `${w} x ${h} is resized inside both limits`,
      `${fit.width} x ${fit.height}`,
    );
    check(
      Math.abs(before - after) / before < 0.002,
      `${w} x ${h} keeps its aspect ratio (not stretched)`,
      `relative error ${(Math.abs(before - after) / before).toExponential(2)}`,
    );
  }

  /* Aspect ratio CANNOT be preserved past MAX_EDGE:1, and the edge limit has to
     win because it is the one the renderer enforces. A 12000 x 3 logo is 4000:1;
     at 3000px wide its height would be 0.75px, so it floors to 1 and the ratio
     is distorted. Asserted explicitly rather than left out, because "preserves
     aspect ratio" is otherwise read as unconditional and is not. */
  const thin = fitLogoWithinLimits(12000, 3);
  check(thin.width === 3000, "a 4000:1 logo still obeys the edge limit", `${thin.width} x ${thin.height}`);
  check(thin.height === 1, "its height floors to 1 rather than 0", `${thin.height}`);
  check(
    INVOICE_LOGO_MAX_EDGE / 12000 < 1 / 3,
    "and that case is genuinely unrepresentable, not a rounding bug",
    `3000/12000 = ${(INVOICE_LOGO_MAX_EDGE / 12000).toFixed(4)} < 1/3`,
  );

  // Never upscales.
  for (const [w, h] of [
    [800, 600],
    [1, 1],
    [3000, 1000],
    [1999, 1999],
  ] as const) {
    const fit = fitLogoWithinLimits(w, h);
    check(
      !fit.resized && fit.width === w && fit.height === h,
      `${w} x ${h} is passed through untouched`,
      `${fit.width} x ${fit.height}`,
    );
  }

  // Boundary inputs: rounding must not push a pixel back over the cap.
  for (const [w, h] of [
    [2001, 2000],
    [2000, 2001],
    [2828, 2828],
    [3000, 1333],
    [1, 4_000_000],
  ] as const) {
    const fit = fitLogoWithinLimits(w, h);
    check(
      within(fit.width, fit.height),
      `${w} x ${h} cannot land back over a limit after flooring`,
      `${fit.width} x ${fit.height} = ${fit.width * fit.height} px`,
    );
  }

  /* The stored dimensions must describe the file, which is what the renderer and
     every layout read. */
  check(
    /pixel_width: storedWidth[\s\S]{0,40}pixel_height: storedHeight/.test(adminSvc),
    "the admin row records the normalized size, not the original",
  );
  check(
    /pixel_width: storedWidth[\s\S]{0,40}pixel_height: storedHeight/.test(desktopSvc),
    "the desktop row records the normalized size, not the original",
  );

  /* A logo already inside the limits must not be re-encoded: that would cost
     quality and, for a PNG, is a second chance to lose the alpha channel. */
  check(
    /if \(!fit\.resized\) return null;/.test(adminSvc) && /if \(!fit\.resized\) return null;/.test(desktopSvc),
    "an in-limit image skips the resize entirely in both apps",
  );
  check(
    /picked\.file : |: picked\.file/.test(desktopSvc) || /normalised\.blob : picked\.file/.test(desktopSvc),
    "the desktop uploads the original File when no resize is needed",
  );
  check(
    /normalised\.bytes : await readLogoBytes\(picked\)/.test(adminSvc),
    "the admin uploads the original bytes when no resize is needed",
  );

  /* Transparency: the canvas must not be filled before drawing. */
  for (const [label, svc] of [
    ["Metalworker_admin", adminSvc],
    ["Metalworker_desktop", desktopSvc],
  ] as const) {
    const hasFill = /fillRect|fillStyle\s*=/.test(svc);
    check(!hasFill, `${label} never fills the canvas, so PNG alpha survives`);
  }
  check(
    /picked\.contentType === "image\/png" \? SaveFormat\.PNG : SaveFormat\.JPEG/.test(adminSvc),
    "the native re-encode keeps a PNG as a PNG",
  );
  check(/canvas\.width = fit\.width/.test(adminSvc) && /canvas\.width = fit\.width/.test(desktopSvc),
    "the canvas is only ever the small fitted size, never the source size");

  /* The limits the fit obeys must be the renderer's, not a local guess. */
  const decoder = readRepo(
    "Metalworker_admin/supabase/functions/process-bill-upload/_shared/pdfImage.ts",
  );
  check(/const MAX_EDGE = 3000;/.test(decoder), "the renderer still caps an edge at 3000");
  check(/const MAX_PIXELS = 4_000_000;/.test(decoder), "the renderer still caps at 4,000,000 pixels");
  check(
    /export const INVOICE_LOGO_MAX_EDGE = 3000;/.test(types) &&
      /export const INVOICE_LOGO_MAX_PIXELS = 4_000_000;/.test(types),
    "the client caps match the renderer's, so a fit cannot produce an unprintable logo",
  );

  /* The UI must say what happened rather than fail silently. */
  for (const [label, file] of [
    ["Metalworker_admin", "Metalworker_admin/src/app/invoice-logos.tsx"],
    ["Metalworker_desktop", "Metalworker_desktop/src/pages/InvoiceLogos.tsx"],
  ] as const) {
    const screen = readRepo(file);
    check(
      /Resizing to/.test(screen) || /addInvoiceLogo\([^)]*setAddingStatus/.test(screen),
      `${label} surfaces the resize while it happens`,
    );
  }
  check(
    /Resizing to \$\{fit\.width\} x \$\{fit\.height\}/.test(adminSvc),
    "the admin message names the source and target sizes",
  );
  check(
    /Resizing to \$\{fit\.width\} x \$\{fit\.height\}/.test(desktopSvc),
    "the desktop message names the source and target sizes",
  );
}

console.log(failures === 0 ? "\ntest-logo: all checks passed" : `\ntest-logo: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);