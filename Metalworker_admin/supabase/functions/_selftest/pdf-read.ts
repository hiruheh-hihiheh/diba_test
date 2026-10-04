// Shared helpers for reading a pdf's structure for VERIFICATION ONLY. Nothing in the app
// imports this.
//
// WHY A LOCAL INFLATE
// `_shared/pdfImage.ts` decodes RAW deflate, which is what a bare /Flate image stream
// carries. A /FlateDecode CONTENT stream carries the 2-byte zlib wrapper instead, so the
// raw decoder throws on it - and the failure is silent in the worst way: the reader falls
// back to treating the compressed bytes as if they were instructions and reports a blank
// page. Both forms are tried here, zlib first, so a stream is decoded whichever
// convention its producer used.
import { readFileSync } from "node:fs";
import { inflateSync, inflateRawSync } from "node:zlib";

const latin1 = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);

/** latin1 TEXT (not UTF-8) to bytes. Pdf stream bytes are byte-oriented, and TextEncoder
 *  would expand every byte above 0x7F into two - corrupting the data being inflated. */
export const latin1Bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "latin1"));

/** Decode a stream body, or return null if it is not deflate at all. */
export function tryInflate(bytes: Uint8Array): string | null {
  const buf = Buffer.from(bytes);
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      return latin1(fn(buf));
    } catch {
      /* try the other convention */
    }
  }
  return null;
}

/** The whole file as latin1, which is how pdf syntax is written. */
export const raw = (path: string): string => latin1(readFileSync(path));

/** Every object offset in the file: `[num, gen, indexJustAfter "obj"]`. */
function* objectHeaders(src: string): Generator<[number, number, number]> {
  for (const m of src.matchAll(/(?:^|[^0-9])(\d+)\s+(\d+)\s+obj\b/g)) {
    yield [Number(m[1]), Number(m[2]), m.index + m[0].length];
  }
}

/**
 * Is there a `stream` keyword between `from` and `limit`?
 * It must be followed by an EOL, or it is a name like `/Stream` rather than the keyword.
 */
function streamKeywordBefore(src: string, from: number, limit: number): number {
  let at = from;
  while (at < limit) {
    const i = src.indexOf("stream", at);
    if (i < 0 || i >= limit) return -1;
    const before = i === 0 || " \t\r\n\f\0".includes(src[i - 1]);
    const after = src.slice(i + 6, i + 8);
    if (before && /^\r?\n/.test(after)) return i;
    at = i + 6;
  }
  return -1;
}

/** `[num, dict, decodedData]` for every indirect object that carries a stream. */
export function streamObjects(src: string): { num: number; dict: string; data: string }[] {
  const out: { num: number; dict: string; data: string }[] = [];

  for (const [num, , bodyStart] of objectHeaders(src)) {
    /* The dict ends at whichever comes first, `stream` or `endobj`. Comparing the two
       offsets is what stops a stream-less object from absorbing the next object's stream
       - and it has no length limit, which matters because a Form XObject's /Resources
       here lists enough names to run well past any fixed window. A bounded window read
       this dict as truncated, so the one XObject the page actually draws through went
       missing and the page measured as blank. */
    const streamAt = streamKeywordBefore(src, bodyStart, src.length);
    const endObjAt = src.indexOf("endobj", bodyStart);
    if (streamAt < 0) continue;
    if (endObjAt >= 0 && endObjAt < streamAt) continue;

    const dict = src.slice(bodyStart, streamAt);
    const start = streamAt + 6;
    const afterKeyword = /^(\r\n|\n|\r)/.exec(src.slice(start, start + 2));
    const dataStart = start + (afterKeyword?.[0].length ?? 1);

    /* The dict's own /Length is authoritative. Measuring to the `endstream` keyword
       instead picks up the EOL that precedes it, so the slice runs 2 bytes long and the
       deflate decoder rejects the result. /Length may itself be an indirect reference. */
    const direct = Number(/\/Length\s+(\d+)/.exec(dict)?.[1] ?? NaN);
    const indirectNum = Number(/\/Length\s+(\d+)\s+\d+\s+R/.exec(dict)?.[1] ?? NaN);
    const resolved = Number.isFinite(direct)
      ? direct
      : Number.isFinite(indirectNum)
        ? Number(/\/Length\s+(\d+)/.exec(objectDict(src, indirectNum))?.[1] ?? NaN)
        : NaN;

    const endStream = src.indexOf("endstream", dataStart);
    const stop = Number.isFinite(resolved) && resolved > 0 ? dataStart + resolved : endStream;
    if (endStream >= 0 && stop > endStream) continue;

    const chunk = src.slice(dataStart, Math.max(dataStart, stop));
    out.push({ num, dict, data: tryInflate(latin1Bytes(chunk)) ?? chunk });
  }
  return out;
}

/** The dict text of an object, up to its `stream` keyword or its `endobj`. */
export function objectDict(src: string, num: number): string {
  for (const [n, , bodyStart] of objectHeaders(src)) {
    if (n !== num) continue;
    const streamAt = streamKeywordBefore(src, bodyStart, src.length);
    const endObjAt = src.indexOf("endobj", bodyStart);
    let stop = endObjAt;
    if (streamAt >= 0 && (stop < 0 || streamAt < stop)) stop = streamAt;
    if (stop < 0) stop = src.length;
    return src.slice(bodyStart, stop).replace(/\s+/g, " ").trim();
  }
  return "";
}