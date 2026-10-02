// supabase/functions/process-bill-upload/_shared/pdfImage.ts
//
// Turns an uploaded logo into the byte payload a PDF image XObject needs.
//
// WHY THIS EXISTS
// `pdf.ts` is a hand-rolled PDF 1.4 writer (see the note at the top of that file):
// it can draw text, rules and boxes and nothing else. An invoice logo has to be a
// real image object inside the PDF — a browser overlay would not survive a print,
// a download, or a "save as" — so the writer needs a fourth primitive, and that
// primitive needs an image decoder to feed it.
//
// THE TWO PATHS A PDF GIVES US
//   * DCTDecode IS JPEG. The compressed JPEG bytes are copied into the file
//     untouched, so a JPEG logo costs no decode work and no re-compression loss.
//     This is the fast path and it is what a logo should normally be.
//   * FlateDecode IS zlib deflate. A PNG must therefore be decoded into raw
//     component samples, then re-compressed, because PDF has no PNG filter.
//
// TRANSPARENCY
// PDF 1.4 has no alpha channel in the main image. Transparency is a SECOND image
// XObject in 8-bit greyscale, referenced by /SMask, holding one alpha sample per
// pixel. So a transparent logo becomes two XObjects, not one, and both are written
// by `pdf.ts`.
//
// NOTHING IS ADDED AS A DEPENDENCY
// Inflate and deflate are the platform's `DecompressionStream`/`CompressionStream`
// with the `deflate` format, which is zlib (RFC 1950) — exactly what both PNG's
// IDAT and PDF's FlateDecode expect. PNG unfiltering is the rest, and it is the
// small, well-specified part below.

/* ──────────────────────────────────────────────
   Public shape
   ────────────────────────────────────────────── */

/** A decoded image, ready to be written as one or two PDF XObjects. */
export interface PdfImage {
  /** Intrinsic pixel width. Used to preserve the aspect ratio when placed. */
  width: number;
  /** Intrinsic pixel height. */
  height: number;
  /**
   * How `data` is compressed. Both are `/FlateDecode` except the JPEG path,
   * which is `/DCTDecode` and stores the original file bytes.
   */
  filter: "FlateDecode" | "DCTDecode";
  /**
   * Declared colour space of `data`. Always DeviceRGB for a decoded PNG, and
   * read from the frame header for a JPEG, because a greyscale JPEG written as
   * DeviceRGB would be stretched by any viewer that trusts the dictionary.
   */
  colorSpace: "DeviceRGB" | "DeviceGray";
  /** Compressed component samples. */
  data: Uint8Array;
  /**
   * Alpha, when the source had any: 8-bit greyscale samples, one per pixel,
   * already compressed with FlateDecode. Null for an opaque image.
   */
  smask: { data: Uint8Array } | null;
}

/**
 * Refuse anything that would make a single PDF unreasonable.
 *
 * The invoice page is 595pt wide and the logo slot is ~110pt, so a logo larger
 * than a few hundred pixels on its long edge gains nothing visible while making
 * every one of the three PDFs three times heavier. The caller is expected to ask
 * for a sensible size; this is the backstop, not the policy.
 */
const MAX_EDGE = 3000;
const MAX_PIXELS = 4_000_000;

/* ──────────────────────────────────────────────
   zlib, via the platform streams
   ────────────────────────────────────────────── */

/**
 * Run `bytes` through one compression stream and collect the result.
 *
 * The stream is typed as accepting `BufferSource` rather than `Uint8Array`,
 * because that is what the platform declares for `CompressionStream` and
 * `DecompressionStream`, and the narrower `TransformStream<Uint8Array, …>` is not
 * assignable to it — `BufferSource` is a union that includes `ArrayBuffer`, and
 * `ArrayBuffer` does not satisfy `Uint8Array`. Widening here is a declaration
 * about the platform's own types, not a weakening of what this module passes: the
 * body below only ever enqueues a `Uint8Array`, which is a valid `BufferSource`.
 */
async function pipeThrough(
  bytes: Uint8Array,
  stream: GenericTransformStream
): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Uint8Array(await new Response(input.pipeThrough(stream)).arrayBuffer());
}

/** Inflate zlib bytes (PNG IDAT, or anything FlateDecode-shaped). */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new DecompressionStream("deflate"));
}

/** Deflate raw bytes into the zlib form PDF's FlateDecode expects. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new CompressionStream("deflate"));
}

/* ──────────────────────────────────────────────
   JPEG — DCTDecode, no decode required
   ────────────────────────────────────────────── */

function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/**
 * Pull `width`/`height` out of a JPEG's SOFn frame header.
 *
 * The marker walk is the only way to get the real dimensions, and they matter
 * even though the pixels are never decoded: they are what preserves the logo's
 * aspect ratio when it is placed. Everything between SOI and the frame header is
 * skipped by length, except the standalone markers that carry no payload.
 *
 * Returns null for a JPEG that cannot be read, which sends the caller down the
 * "no usable image" path rather than emitting a broken XObject.
 */
function jpegSize(b: Uint8Array): { width: number; height: number; components: number } | null {
  let at = 2;
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = b[at + 1];
    // Padding fill bytes: any number of 0xFF may precede the real marker.
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Standalone markers, no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // Start of scan: the frame header would have been before this.
    if (marker === 0xda) return null;

    const length = (b[at + 2] << 8) | b[at + 3];
    // SOF0..SOF15, skipping the non-frame markers in that range
    // (DHT=C4, JPG=C8, DAC=CC) which never carry a size.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // SOFn is: [2] length, [1] precision, [2] height, [2] width,
      //         [1] component count, then the components themselves.
      if (at + 9 >= b.length) return null;
      const height = (b[at + 5] << 8) | b[at + 6];
      const width = (b[at + 7] << 8) | b[at + 8];
      const components = b[at + 9];
      if (width <= 0 || height <= 0) return null;
      return { width, height, components };
    }
    at += 2 + length;
  }
  return null;
}

async function decodeJpeg(b: Uint8Array): Promise<PdfImage | null> {
  const size = jpegSize(b);
  if (!size) return null;
  // One component is greyscale and three is colour. A four-component JPEG is
  // CMYK, which this writer cannot describe correctly and no logo needs, so it
  // is refused rather than silently rendered as a broken colour space.
  if (size.components !== 1 && size.components !== 3) return null;
  // The bytes ARE the DCT stream. Copy rather than alias: the caller keeps this
  // array alive across three renders, and the decoder reuses nothing.
  return {
    width: size.width,
    height: size.height,
    filter: "DCTDecode",
    colorSpace: size.components === 1 ? "DeviceGray" : "DeviceRGB",
    data: b.slice(),
    smask: null,
  };
}

/* ──────────────────────────────────────────────
   PNG — decoded to raw samples
   ────────────────────────────────────────────── */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return PNG_SIGNATURE.every((v, i) => b[i] === v);
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

interface Png {
  header: PngHeader;
  /** Concatenated IDAT, still zlib-compressed. */
  idat: Uint8Array;
  palette: Uint8Array | null;
  /** tRNS: 6 bytes for truecolour, 1 byte for greyscale, a palette length for indexed. */
  transparency: Uint8Array | null;
}

function readPng(b: Uint8Array): Png | null {
  // Signature (8) + length (4) + "IHDR" (4) + 13 bytes of header.
  if (b.length < 8 + 4 + 4 + 13) return null;
  if (!(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null; // "IHDR"

  const header: PngHeader = {
    width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19],
    height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23],
    bitDepth: b[24],
    colorType: b[25],
    interlace: b[27],
  };
  // Compression method (b[26]) and filter method (b[28]) are both 0 by definition.
  if (b[26] !== 0 || b[28] !== 0) return null;

  let at = 8;
  const idatParts: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;

  while (at + 8 <= b.length) {
    const length = (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    const dataAt = at + 8;
    if (dataAt + length > b.length) break;

    if (type === "IDAT") {
      idatParts.push(b.subarray(dataAt, dataAt + length));
    } else if (type === "PLTE") {
      palette = b.slice(dataAt, dataAt + length);
    } else if (type === "tRNS") {
      transparency = b.slice(dataAt, dataAt + length);
    } else if (type === "IEND") {
      break;
    }
    // Chunks are padded to a 4-byte boundary.
    at = dataAt + length + 4;
  }

  if (idatParts.length === 0) return null;
  let total = 0;
  for (const part of idatParts) total += part.length;
  const idat = new Uint8Array(total);
  let cursor = 0;
  for (const part of idatParts) {
    idat.set(part, cursor);
    cursor += part.length;
  }

  return { header, idat, palette, transparency };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Undo the per-scanline PNG filters, returning raw samples.
 *
 * PNG never stores pixels directly: each scanline is stored as a difference
 * from the line above (or the pixel to the left, or a combination). A PDF
 * FlateDecode stream has no such notion, so this pass is mandatory. It is
 * deliberately in-place over one buffer to keep a 3000x3000 logo from
 * allocating twice.
 */
function unfilter(raw: Uint8Array, header: PngHeader, bytesPerPixel: number, bytesPerRow: number): Uint8Array {
  const out = new Uint8Array(header.height * bytesPerRow);
  let src = 0;

  for (let y = 0; y < header.height; y++) {
    const filterType = raw[src++];
    const rowStart = y * bytesPerRow;
    const prevStart = rowStart - bytesPerRow;

    for (let x = 0; x < bytesPerRow; x++) {
      const value = raw[src + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;

      let result: number;
      switch (filterType) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`PNG row ${y} uses unknown filter ${filterType}`);
      }
      out[rowStart + x] = result & 0xff;
    }
    src += bytesPerRow;
  }
  return out;
}

/** Samples per complete pixel, which is what the filters operate on. */
function channelsFor(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // truecolour
    case 3:
      return 1; // indexed: one index per pixel
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // truecolour + alpha
    default:
      throw new Error(`Unsupported PNG colour type ${colorType}`);
  }
}

/**
 * Widen a sub-byte sample to a full byte.
 *
 * Only indexed and greyscale PNGs may be 1/2/4 bits per sample, and there the
 * row is packed rather than one-byte-per-sample, so the bit position has to be
 * computed from the pixel index rather than the byte index.
 */
function unpackLowDepth(samples: Uint8Array, header: PngHeader, out: Uint8Array): void {
  const perByte = 8 / header.bitDepth;
  const mask = (1 << header.bitDepth) - 1;
  for (let i = 0; i < header.width * header.height; i++) {
    const byte = samples[Math.floor(i / perByte)];
    const shift = 8 - header.bitDepth * ((i % perByte) + 1);
    out[i] = (byte >> shift) & mask;
  }
}

/** Reduce 16-bit samples to 8 by keeping the high byte. */
function narrow16(samples: Uint8Array): Uint8Array {
  const count = Math.floor(samples.length / 2);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = samples[i * 2];
  return out;
}

async function decodePng(b: Uint8Array): Promise<PdfImage | null> {
  const png = readPng(b);
  if (!png) return null;
  const { header } = png;

  // Adam7 interlacing rearranges the pixels into seven passes with their own
  // filter bytes, which this decoder does not reconstruct. Rejecting it is
  // honest: the caller falls back to a JPEG, which Cloudinary can always make.
  if (header.interlace !== 0) return null;

  const { width, height } = header;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_EDGE || height > MAX_EDGE) return null;
  if (width * height > MAX_PIXELS) return null;

  const channels = channelsFor(header.colorType);
  if (![0, 2, 3, 4, 6].includes(header.colorType)) return null;
  if (![1, 2, 4, 8, 16].includes(header.bitDepth)) return null;
  if (header.colorType === 3 && header.bitDepth === 16) return null;
  if ((header.colorType === 2 || header.colorType === 4 || header.colorType === 6) && header.bitDepth < 8) {
    return null;
  }

  let raw: Uint8Array;
  try {
    raw = await inflate(png.idat);
  } catch {
    return null;
  }

  // Bytes per row depends on the packed bit depth for sub-byte images.
  const bitsPerRow = width * channels * header.bitDepth;
  const bytesPerRow = header.bitDepth >= 8 ? bitsPerRow / 8 : Math.ceil(bitsPerRow / 8);
  const bytesPerPixel = Math.max(1, Math.ceil((channels * header.bitDepth) / 8));

  if (raw.length < height * (bytesPerRow + 1)) return null;

  let samples: Uint8Array;
  try {
    samples = unfilter(raw, header, bytesPerPixel, bytesPerRow);
  } catch {
    return null;
  }

  if (header.bitDepth < 8) {
    const widened = new Uint8Array(width * height * channels);
    unpackLowDepth(samples, header, widened);
    samples = widened;
  } else if (header.bitDepth === 16) {
    samples = narrow16(samples);
  }

  const pixelCount = width * height;
  const rgb = new Uint8Array(pixelCount * 3);
  let alpha: Uint8Array | null = null;

  switch (header.colorType) {
    case 0: {
      // Greyscale: replicate the one channel. A tRNS here names a single grey
      // level to treat as fully transparent.
      let trnsGrey: number | null = null;
      if (png.transparency && png.transparency.length >= 2) {
        trnsGrey = (png.transparency[0] << 8) | png.transparency[1];
      }
      for (let i = 0; i < pixelCount; i++) {
        const g = samples[i];
        rgb[i * 3] = g;
        rgb[i * 3 + 1] = g;
        rgb[i * 3 + 2] = g;
      }
      if (trnsGrey !== null) {
        alpha = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) alpha[i] = samples[i] === trnsGrey ? 0 : 255;
      }
      break;
    }
    case 2: {
      // Truecolour. A tRNS here names one RGB triple to treat as transparent,
      // so the alpha plane has to be built by comparison rather than copied.
      let key: [number, number, number] | null = null;
      if (png.transparency && png.transparency.length >= 6) {
        key = [png.transparency[0], png.transparency[1], png.transparency[2]];
      }
      for (let i = 0; i < pixelCount; i++) {
        rgb[i * 3] = samples[i * 3];
        rgb[i * 3 + 1] = samples[i * 3 + 1];
        rgb[i * 3 + 2] = samples[i * 3 + 2];
      }
      if (key) {
        alpha = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
          const same =
            samples[i * 3] === key[0] && samples[i * 3 + 1] === key[1] && samples[i * 3 + 2] === key[2];
          alpha[i] = same ? 0 : 255;
        }
      }
      break;
    }
    case 3: {
      // Indexed: PLTE gives the palette, tRNS gives the alpha of the leading
      // entries, and everything past tRNS is fully opaque.
      if (!png.palette || png.palette.length < 3) return null;
      const entries = Math.floor(png.palette.length / 3);
      const trnsLen = png.transparency ? png.transparency.length : 0;
      for (let i = 0; i < pixelCount; i++) {
        const idx = samples[i];
        if (idx >= entries) return null; // index outside PLTE: malformed
        rgb[i * 3] = png.palette[idx * 3];
        rgb[i * 3 + 1] = png.palette[idx * 3 + 1];
        rgb[i * 3 + 2] = png.palette[idx * 3 + 2];
      }
      if (trnsLen > 0) {
        alpha = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
          alpha[i] = samples[i] < trnsLen ? png.transparency![samples[i]] : 255;
        }
      }
      break;
    }
    case 4: {
      // Greyscale + alpha: the alpha channel is already a soft mask.
      alpha = new Uint8Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        const g = samples[i * 2];
        rgb[i * 3] = g;
        rgb[i * 3 + 1] = g;
        rgb[i * 3 + 2] = g;
        alpha[i] = samples[i * 2 + 1];
      }
      break;
    }
    case 6: {
      // Truecolour + alpha: drop the alpha from the colour plane.
      alpha = new Uint8Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        rgb[i * 3] = samples[i * 4];
        rgb[i * 3 + 1] = samples[i * 4 + 1];
        rgb[i * 3 + 2] = samples[i * 4 + 2];
        alpha[i] = samples[i * 4 + 3];
      }
      break;
    }
  }

  // A soft mask that is entirely opaque costs an extra object in every PDF for
  // no visual difference, so treat "no transparency" as "no soft mask".
  if (alpha) {
    let transparent = false;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] !== 255) {
        transparent = true;
        break;
      }
    }
    if (!transparent) alpha = null;
  }

  return {
    width,
    height,
    filter: "FlateDecode",
    colorSpace: "DeviceRGB",
    data: await deflate(rgb),
    smask: alpha ? { data: await deflate(alpha) } : null,
  };
}

/* ──────────────────────────────────────────────
   Entry point
   ────────────────────────────────────────────── */

/**
 * Decode a logo file into something `pdf.ts` can write.
 *
 * Returns null rather than throwing: a logo that cannot be embedded must degrade
 * to "this invoice prints exactly as it does today", which is a state the rest
 * of the pipeline already knows how to produce. An exception here would instead
 * fail the save of a bill whose data is perfectly valid.
 */
export async function decodePdfImage(bytes: Uint8Array): Promise<PdfImage | null> {
  if (bytes.length < 8) return null;
  if (isJpeg(bytes)) return decodeJpeg(bytes);
  if (isPng(bytes)) return decodePng(bytes);
  // GIF, WebP, BMP, HEIC and friends are deliberately not handled. The upload
  // path normalises to PNG or JPEG before anything reaches this function, so an
  // unrecognised signature means the pipeline upstream did not do its job.
  return null;
}