// A small pdf content-stream interpreter, for MEASURING a page's geometry in device space.
//
// WHY THIS EXISTS
// A design tool's export does not draw the page directly. It hands the whole page to a
// chain of Form XObjects on a large artboard, scaled down by a single `cm`. Reading any
// one stream therefore reports coordinates in the ARTBOARD's units - about ten times the
// page's - and nothing lines up with a renderer that draws straight onto A4. Composing the
// CTM down the `Do` chain is the only way to compare the two honestly.
//
// WHAT IT READS
//   q / Q / cm       graphics state and CTM composition
//   Do               Form XObject, with its /Matrix folded into the CTM
//   BT ET Tf Tm Td TD T* TL Tc Tw Tz Ts, Tj TJ ' "
//   m l re h S f n   path geometry, emitted as device-space segments
//
// OPERANDS ARE STACKED, NOT GUESSED
// An earlier version read operands out of a "pending" list that only recorded NUMBERS,
// so every string operand was dropped and every string was silently skipped - the page
// came back with no text at all and no error. So the tokenizer hands back whole operands,
// `[...]` and `<<...>>` included, and each operator takes what it declared it takes.
//
// VERIFICATION ONLY. Nothing the app ships imports this.
import { raw, streamObjects, objectDict } from "./pdf-read.ts";

/* ── matrices ───────────────────────────────────────────────────────────────
   [a b c d e f] with x' = a·x + c·y + e, y' = b·x + d·y + f. Row-vector convention, so
   applying n after m is m × n. */
export type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

const apply = (m: M, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** Horizontal scale in force. */
const xScale = (m: M): number => Math.hypot(m[0], m[1]);
/** How much one unit becomes: sqrt|det|. */
const uniform = (m: M): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/* ── tokenizer ────────────────────────────────────────────────────────────
   Yields one OPERAND or OPERATOR at a time. Three things have to stay whole or the
   stream is misread: `(...)` with nested and escaped parentheses, `[...]` arrays, and
   `<<...>>` dictionaries. */
const OPERATORS = new Set([
  "q", "Q", "cm", "BT", "ET", "Tf", "TL", "Tm", "Td", "TD", "T*", "Tc", "Tw", "Tz", "Ts", "Tr",
  "Tj", "TJ", "'", '"', "Do", "BI", "ID", "EI",
  "m", "l", "c", "v", "y", "h", "re",
  "S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n",
  "W", "W*", "g", "G", "rg", "RG", "k", "K", "cs", "CS", "sc", "SC", "scn", "SCN",
  "w", "J", "j", "M", "d", "ri", "i", "MP", "DP", "BMC", "BDC", "EMC", "BX", "EX",
]);

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<<": ">>" };
const CLOSE = new Set([")", "]", "}", ">>"]);

export function* tokens(src: string): Generator<string> {
  let i = 0;
  const isSpace = (c: string): boolean => " \n\r\t\f\0".includes(c);

  while (i < src.length) {
    const c = src[i];

    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === "%") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }

    // A bracket-delimited group, including any `(` strings inside a `[...]` array.
    if (OPEN[c]) {
      const closer = OPEN[c];
      let j = i + closer.length; // just past the opening token
      let depth = 1;
      while (j < src.length && depth > 0) {
        const d = src[j];
        if (d === "\\") {
          j += 2; // an escaped byte cannot close anything
          continue;
        }
        if (closer === ")") {
          /* A literal string. Parens INSIDE it must be balanced (PDF 32000-1 7.3.4.2), and
             they still have to be counted: `(For M/s (Pvt) Ltd)` ends at its LAST paren,
             not the one closing `(Pvt)`. Treating the first `)` as the end truncates the
             string and throws away the rest of the operands on the line. */
          if (d === "(") {
            depth++;
            j++;
            continue;
          }
          if (d === ")") {
            depth--;
            j++;
            if (depth === 0) break;
            continue;
          }
          j++;
          continue;
        }
        if (d === "(") {
          // A literal string nested inside an array or dict: copy it whole, brackets
          // and all, so its parens cannot be mistaken for the group's own delimiters.
          let k = j + 1;
          let parens = 1;
          while (k < src.length && parens > 0) {
            if (src[k] === "\\") k++;
            else if (src[k] === "(") parens++;
            else if (src[k] === ")") parens--;
            k++;
          }
          j = k;
          continue;
        }
        if (d === "<" && src[j + 1] === "<") {
          depth++;
          j += 2;
          continue;
        }
        if (d === ">" && src[j + 1] === ">") {
          depth--;
          j += 2;
          continue;
        }
        if (d === closer[0] && (closer.length === 1 || src[j + 1] === closer[1])) {
          depth--;
          j += closer.length;
          if (depth === 0) break;
          continue;
        }
        j++;
      }
      yield src.slice(i, j);
      i = j;
      continue;
    }

    if (CLOSE.has(c)) {
      i++;
      continue;
    }

    let j = i;
    while (j < src.length && !isSpace(src[j]) && !OPEN[src[j]] && !CLOSE.has(src[j])) j++;
    if (j === i) j++;
    yield src.slice(i, j);
    i = j;
  }
}

/** Unescape a pdf literal string. */
const literal = (t: string): string =>
  t
    .replace(/^\(+/, "")
    .replace(/\)+$/, "")
    .replace(/\\([nrtbf()\\])/g, (_, ch) =>
      ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch === "b" ? "\b" : ch === "f" ? "\f" : ch
    )
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));

/* ── fonts ─────────────────────────────────────────────────────────────────
   Widths are read only to report a run's EXTENT, which is what distinguishes a
   right-aligned column from a left-aligned one. A font with no usable widths yields
   null and the run is reported without an extent - never a guessed one.

   TWO CODE WIDTHS EXIST
   A simple font addresses one byte per glyph and gives /FirstChar + /Widths. A composite
   (Type0, which is what this template's subsetted Helvetica LT Pro uses) addresses two
   bytes per glyph and gives its widths in the DESCENDANT's /W array, keyed by glyph id,
   with /DW as the fallback. Reading a composite as one-byte gave garbage: the codes came
   out as `25 * 1 $ /` instead of text, because each glyph's second byte was being
   treated as a character of its own. */
type Font = {
  widths?: Map<number, number>;
  codeBytes: 1 | 2;
  defaultWidth?: number;
  toUnicode?: Map<number, string>;
};

const hexToText = (hex: string): string => {
  let out = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const code = parseInt(hex.substr(i, 4), 16);
    if (!Number.isNaN(code)) out += String.fromCharCode(code);
  }
  return out;
};

function parseCMap(src: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(p[1], 16), hexToText(p[2]));
    }
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      const base = parseInt(p[3], 16);
      if (hi - lo > 65535) continue;
      for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + (c - lo)));
    }
  }
  return map;
}

/** The descendant font's `/W [ ... ]`, in its three-part and two-part spellings. */
function parseW(src: string): Map<number, number> {
  const map = new Map<number, number>();
  const at = src.indexOf("/W[");
  if (at < 0) return map;
  const open = src.indexOf("[", at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return map;
  const items = src
    .slice(open + 1, close)
    .replace(/(\d)\s*\[/g, "$1 [")
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < items.length; i++) {
    if (items[i] === "[") {
      const start = Number(items[i - 1]);
      const run: number[] = [];
      i++;
      while (i < items.length && items[i] !== "]") {
        const w = Number(items[i]);
        if (!Number.isNaN(w)) run.push(w);
        i++;
      }
      run.forEach((w, k) => map.set(start + k, w));
      continue;
    }
    // `cFirst cLast w` - one width for every glyph in the range.
    const first = Number(items[i]);
    const last = Number(items[i + 1]);
    const w = Number(items[i + 2]);
    if (!Number.isNaN(first) && !Number.isNaN(last) && !Number.isNaN(w) && last >= first) {
      const span = Math.min(last - first, 65535);
      for (let k = 0; k <= span; k++) map.set(first + k, w);
    }
    i += 2;
  }
  return map;
}

function readFont(
  src: string,
  num: number,
  streams: Map<number, { data: string }>
): Font {
  const dict = objectDict(src, num);
  const composite = /\/Subtype\s*\/Type0/.test(dict);
  const font: Font = { codeBytes: composite ? 2 : 1 };

  const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(dict);
  if (tu) {
    const stream = streams.get(Number(tu[1]));
    if (stream) font.toUnicode = parseCMap(stream.data);
  }

  if (composite) {
    const descRef = Number(/\/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R/.exec(dict)?.[1] ?? NaN);
    const desc = Number.isFinite(descRef) ? objectDict(src, descRef) : "";
    font.defaultWidth = Number(/\/DW\s+([\d.]+)/.exec(desc)?.[1] ?? 1000);
    const w = parseW(desc);
    if (w.size) font.widths = w;
    return font;
  }

  const first = Number(/\/FirstChar\s+(\d+)/.exec(dict)?.[1] ?? NaN);
  const widths = /\/Widths\s*\[([^\]]*)\]/.exec(dict);
  if (widths && Number.isFinite(first)) {
    font.widths = new Map();
    widths[1].trim().split(/\s+/).forEach((w, i) => font.widths!.set(first + i, Number(w)));
  }
  return font;
}

/** Split a shown string into glyph codes, honouring the font's code width. */
function codesOf(text: string, font: Font): number[] {
  const out: number[] = [];
  if (font.codeBytes === 2) {
    for (let i = 0; i + 1 < text.length; i += 2) {
      out.push((text.charCodeAt(i) << 8) | text.charCodeAt(i + 1));
    }
  } else {
    for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
  }
  return out;
}

export type Res = { fonts: Map<string, number>; xobjects: Map<string, number> };

/* ── resources ──────────────────────────────────────────────────────────────
   A Form XObject may carry its own /Resources or inherit the caller's, so they are
   resolved per invocation rather than read once from the page. */

/* A resource NAME arrives from the stream with its leading slash (`/R224`) but is keyed
   in the resource map without one. Looking up the slashed form finds nothing, so every
   font and every XObject silently missed - the page measured as blank with no error. */
const resKey = (operand: string | undefined): string => (operand ?? "").replace(/^\//, "");

export type TextRun = {
  x: number;
  y: number;
  size: number;
  width: number | null;
  text: string;
  font: string;
};
export type Seg = { x1: number; y1: number; x2: number; y2: number };

export type Measured = {
  texts: TextRun[];
  segs: Seg[];
  box: [number, number, number, number];
  /** Every /Contents and /XObject the walk actually reached - proof it was not blank. */
  visited: number;
  /** Objects it skipped because it could not resolve them. */
  unresolved: string[];
};

export function measurePage(path: string, pageObjNum = 0): Measured {
  const src = raw(path);
  const objects = streamObjects(src);
  const streams = new Map(objects.map((o) => [o.num, o]));

  /* Object numbers are NOT stable between files, so the page is found by its own dict
     rather than assumed. `/Type /Page` followed by a non-`s` excludes `/Pages`, or the
     root would be read as the page. */
  if (!pageObjNum) {
    for (const o of objects) {
      if (/\/Type\s*\/Page[^s]/.test(o.dict) && /\/Contents/.test(o.dict)) {
        pageObjNum = o.num;
        break;
      }
    }
    if (!pageObjNum) {
      for (const m of src.matchAll(/(\d+)\s+\d+\s+obj([\s\S]{0,600}?)(?:stream|endobj)/g)) {
        if (/\/Type\s*\/Page[^s]/.test(m[2])) {
          pageObjNum = Number(m[1]);
          break;
        }
      }
    }
  }

  const pageDict = objectDict(src, pageObjNum);
  const mb = /MediaBox\s*\[([^\]]*)\]/.exec(pageDict)?.[1]?.trim().split(/\s+/).map(Number);
  const box: [number, number, number, number] =
    mb && mb.length === 4 ? (mb as [number, number, number, number]) : [0, 0, 595.28, 841.89];

  /* Keyed by object NUMBER. This map has to be populated lazily and it has to exist:
     an earlier version recorded which object a `Tf` selected but never loaded it, so
     every lookup missed, every run silently fell back to a one-byte font with no
     /ToUnicode, and the page's text came out as raw glyph codes. */
  const fonts = new Map<number, Font>();
  const fontOf = (num: number): Font => {
    let f = fonts.get(num);
    if (!f) {
      f = readFont(src, num, streams);
      fonts.set(num, f);
    }
    return f;
  };

  const texts: TextRun[] = [];
  const segs: Seg[] = [];
  const visited = new Set<number>();
  const unresolved = new Set<string>();

  /* Text state is INHERITED by a form XObject but a form's changes do not leak back out,
     so it is copied in by value on the way down. */
  type TextState = {
    fontNum: number;
    fontSize: number;
    leading: number;
    charSp: number;
    wordSp: number;
    horizScale: number;
  };

  const run = (
    content: string,
    base: M,
    res: Res,
    depth: number,
    inherited: TextState = {
      fontNum: 0,
      fontSize: 0,
      leading: 0,
      charSp: 0,
      wordSp: 0,
      horizScale: 1,
    }
  ): void => {
    if (depth > 16) return;
    const stack: M[] = [];
    let ctm: M = base;
    let { fontNum, fontSize, leading, charSp, wordSp, horizScale } = inherited;
    let font: Font | null = fontNum ? fontOf(fontNum) : null;
    let tm: M = IDENTITY;
    let tlm: M = IDENTITY;
    let path: [number, number][] = [];
    let cur: [number, number] = [0, 0];

    /* Advance width of a shown string, in text-space units. */
    const widthOf = (codes: number[], font: Font): number => {
      let total = 0;
      for (const code of codes) {
        const w = font.widths?.get(code) ?? font.defaultWidth;
        if (w === undefined) return NaN;
        total += w;
      }
      const spaces = codes.filter((c) => c === 32).length;
      return (total / 1000) * fontSize + charSp * codes.length + wordSp * spaces;
    };

    const show = (text: string): void => {
      if (!text) return;
      const full = mul(tm, ctm);
      const [x, y] = apply(full, 0, 0);
      const f = font ?? { codeBytes: 1 as const };
      const codes = codesOf(text, f);
      if (!codes.length) return;
      const adv = widthOf(codes, f);
      /* Decode through /ToUnicode when the font supplies it. Without it a composite font
         has no text at all - the codes are glyph ids, and only the CMap says which letter
         each one means. */
      let shown = text;
      if (f.toUnicode) {
        shown = codes.map((c) => f.toUnicode!.get(c) ?? "").join("");
      }
      texts.push({
        x,
        y,
        size: fontSize * horizScale * uniform(full),
        width: Number.isNaN(adv) ? null : adv * xScale(full),
        text: shown,
        font: `/F${fontNum}`,
      });
    };

    const flushPath = (): void => {
      for (let i = 1; i < path.length; i++) {
        const [ax, ay] = apply(ctm, path[i - 1][0], path[i - 1][1]);
        const [bx, by] = apply(ctm, path[i][0], path[i][1]);
        if (ax !== bx || ay !== by) segs.push({ x1: ax, y1: ay, x2: bx, y2: by });
      }
      path = [];
    };

    let operands: string[] = [];

    for (const tok of tokens(content)) {
      if (!OPERATORS.has(tok)) {
        operands.push(tok);
        if (operands.length > 64) operands.shift();
        continue;
      }

      const nums = operands.filter((o) => !o.startsWith("/") && !o.startsWith("(") && !o.startsWith("<")).map(Number);
      const names = operands.filter((o) => o.startsWith("/"));
      const n = (i: number): number => nums[i] ?? 0;

      switch (tok) {
        case "q":
          stack.push(ctm);
          break;
        case "Q":
          ctm = stack.pop() ?? ctm;
          break;
        case "cm":
          ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], ctm);
          break;
        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          break;
        case "Tf": {
          const num = res.fonts.get(resKey(names[0])) ?? 0;
          fontNum = num;
          font = fontOf(num);
          fontSize = n(0);
          break;
        }
        case "TL":
          leading = n(0);
          break;
        case "Tc":
          charSp = n(0);
          break;
        case "Tw":
          wordSp = n(0);
          break;
        case "Tz":
          horizScale = n(0) / 100;
          break;
        case "Tm":
          tm = [n(0), n(1), n(2), n(3), n(4), n(5)];
          tlm = tm;
          break;
        case "Td":
          tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
          tm = tlm;
          break;
        case "TD":
          leading = -n(1);
          tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm);
          tm = tlm;
          break;
        case "T*":
          tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
          tm = tlm;
          break;
        case "Tj": {
          const s = operands.find((o) => o.startsWith("("));
          if (s) show(literal(s));
          break;
        }
        case "TJ": {
          /* The kerning numbers between the pieces are NOT replayed, so a run's reported
             WIDTH can be a little generous on a line that was kerned. Position and size
             are exact - only the right-hand edge of a kerned run is approximate, and the
             alignment question this is being used for is answered by the left edges. */
          const arr = operands.find((o) => o.startsWith("["));
          if (!arr) break;
          let piece = "";
          for (const m of arr.slice(1, -1).matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
            piece += literal(`(${m[1]})`);
          }
          show(piece);
          break;
        }
        case "'": {
          tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
          tm = tlm;
          const s = operands.find((o) => o.startsWith("("));
          if (s) show(literal(s));
          break;
        }
        case '"': {
          wordSp = n(0);
          charSp = n(1);
          tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
          tm = tlm;
          const s = operands.find((o) => o.startsWith("("));
          if (s) show(literal(s));
          break;
        }
        case "Do": {
          const target = res.xobjects.get(resKey(names[0]));
          const obj = target === undefined ? undefined : streams.get(target);
          if (!obj) {
            unresolved.add(resKey(names[0]) || "?");
            break;
          }
          visited.add(target);
          flushPath();
          /* A form draws in the coordinate space its /Matrix maps INTO the CTM that was
             in force at the `Do` - it does not replace it. Passing only the form's own
             /Matrix threw away the page's `0.1` scale, so every coordinate came back in
             artboard units (x up to 5957 on a 595pt page) and nothing could be compared
             against our renderer. */
          const mtx = /\/Matrix\s*\[([^\]]*)\]/.exec(obj.dict)?.[1]?.trim().split(/\s+/).map(Number);
          const base = mtx && mtx.length === 6 ? mul(mtx as M, ctm) : ctm;
          run(obj.data, base, inherit(res, obj.dict), depth + 1, {
            fontNum,
            fontSize,
            leading,
            charSp,
            wordSp,
            horizScale,
          });
          break;
        }
        case "m":
        case "l":
          cur = [n(0), n(1)];
          path.push(cur);
          break;
        case "re": {
          const [rx, ry, rw, rh] = [n(0), n(1), n(2), n(3)];
          for (const p of [
            [rx, ry],
            [rx + rw, ry],
            [rx + rw, ry + rh],
            [rx, ry + rh],
            [rx, ry],
          ]) {
            path.push(p as [number, number]);
          }
          break;
        }
        case "h":
          path.push(cur);
          break;
        case "S":
        case "s":
        case "f":
        case "F":
        case "f*":
        case "B":
        case "B*":
        case "b":
        case "b*":
        case "n":
          flushPath();
          break;
        default:
          break;
      }
      operands = [];
    }
    flushPath();
  };

  /* ── resource resolution ──────────────────────────────────────────────── */

  /** The body of a `<<...>>` at `at`, matched by BRACE COUNT. */
  function balancedAt(text: string, at: number): string {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      const c = text[i];
      if (c === "<" && text[i + 1] === "<") {
        depth++;
        i++;
      } else if (c === ">" && text[i + 1] === ">") {
        depth--;
        i++;
        if (depth === 0) return text.slice(at, i + 1);
      }
    }
    return "";
  }

  /* A sub-dictionary is written EITHER inline (`/XObject << /N1 1 0 R >>`) or as an
     indirect reference (`/XObject 10 0 R`). An earlier version only handled the inline
     form, so on a page that used indirect refs - which is what this template does for
     BOTH /Font and /XObject - every resource came back empty, the single /XObject the
     page draws through could not be resolved, and the page measured as blank with no
     error at all. Both spellings are resolved here. */
  function subDict(s: string, holder: string, key: string): string | null {
    const at = new RegExp(`/${key}\\b`).exec(holder);
    if (!at) return null;
    const tail = holder.slice(at.index + at[0].length);
    const lead = tail.replace(/^\s+/, "");
    if (lead.startsWith("<<")) return balancedAt(tail, tail.indexOf("<<"));
    const ref = /^(\d+)\s+\d+\s+R/.exec(lead);
    if (!ref) return null;
    const d = objectDict(s, Number(ref[1]));
    const inner = d.indexOf("<<");
    return inner >= 0 ? balancedAt(d, inner) : null;
  }

  function readResources(s: string, dict: string): Res | null {
    const body = subDict(s, dict, "Resources");
    if (body === null) return null;
    const res: Res = { fonts: new Map(), xobjects: new Map() };
    for (const [key, target] of [
      ["Font", res.fonts],
      ["XObject", res.xobjects],
    ] as const) {
      const section = subDict(s, body, key);
      if (!section) continue;
      for (const m of section.matchAll(/\/([^\s/[\]()<>]+)\s+(\d+)\s+\d+\s+R/g)) {
        target.set(m[1], Number(m[2]));
      }
    }
    return res;
  }

  /* A Form XObject's /Resources REPLACES nothing it does not mention: it inherits the
     caller's entries and overrides only the names it declares. Treating a present but
     sparse /Resources as the whole set is what silently emptied the font map here, since
     the form's dict declared only /Properties and inherited its fonts from the page. */
  function inherit(parent: Res, dict: string): Res {
    const child = readResources(src, dict);
    if (!child) return parent;
    return {
      fonts: child.fonts.size ? new Map([...parent.fonts, ...child.fonts]) : parent.fonts,
      xobjects: child.xobjects.size
        ? new Map([...parent.xobjects, ...child.xobjects])
        : parent.xobjects,
    };
  }

  const contents = /\/Contents\s*(?:\[([^\]]*)\]|(\d+)\s+\d+\s+R)/.exec(pageDict);
  const roots = contents?.[1]
    ? [...contents[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]))
    : contents?.[2]
      ? [Number(contents[2])]
      : [];

  const pageRes = readResources(src, pageDict) ?? { fonts: new Map(), xobjects: new Map() };
  for (const num of roots) {
    const o = streams.get(num);
    if (!o) {
      unresolved.add(`contents:${num}`);
      continue;
    }
    visited.add(num);
    run(o.data, IDENTITY, pageRes, 0);
  }

  texts.sort((a, b) => b.y - a.y || a.x - b.x);
  return { texts, segs, box, visited: visited.size, unresolved: [...unresolved] };
}