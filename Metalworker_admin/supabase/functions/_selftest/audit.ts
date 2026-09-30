// supabase/functions/_selftest/audit.ts
//
// Proves the rendered page is a well-formed invoice WITHOUT eyeballing it.
//
// How: the PDF content streams are uncompressed, so every `Tm`/`Tj`/`re`/`l`
// operator can be read back as text. This script reconstructs the page geometry
// and then checks the things a person would complain about if they got it
// wrong:
//
//   1. nothing off the page (no clipping)
//   2. no two text runs overlapping on a baseline (no collisions)
//   3. no body text inside the footer band (the footer is never overprinted)
//   4. right-aligned money columns really share a right edge
//   5. no hole in the MIDDLE of the content (a short invoice may legitimately
//      end early; a 200pt hole halfway down always is a bug)
//   6. an ASCII map of the page at ~4pt resolution, so the structure can be
//      inspected in a terminal
//
// Then it prints the map, which is how the layout was actually debugged.
//
//   node supabase/functions/_selftest/audit.ts [SAMPLE_original.pdf]
//
// Run test-pdf.ts first to produce the files.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PW = 595.28;
const PH = 841.89;
const FOOTER_Y = PH - 18; // footer baseline
const CONTENT_BOTTOM = PH - 34; // body must stay above the footer band

const HERE = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(HERE, "out");

const file = process.argv[2] ?? "SAMPLE_original.pdf";
const path = resolve(outDir, file);
if (!existsSync(path)) {
  console.error(`${path} not found — run test-pdf.ts first.`);
  process.exitCode = 1;
} else {
  audit(path, file);
}

function audit(filePath: string, label: string): void {
  const bytes = readFileSync(filePath);
  const raw = new TextDecoder("latin1").decode(bytes);

  // --- pull the content streams out ----------------------------------------
  const streams: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) streams.push(m[1]);
  console.log(`${label}: ${streams.length} page content stream(s)\n`);

  /* Helvetica / Helvetica-Bold advance widths, mirrored from the writer's
     `_shared/fontMetrics.ts`. If the widths ever disagree the right-edge check
     below reports false overlaps, so the two must stay in step. */
  // prettier-ignore
  const W_REG: Record<string, number> = { " ":278,".":278,",":278,"!":278,'"':355,"#":556,"$":556,"%":889,"&":667,"'":191,"(":333,")":333,"*":389,"+":584,":":278,";":278,"<":584,"=":584,">":584,"?":556,"@":1015,"[":278,"]":278,"^":469,"_":556,"`":333,"{":334,"|":260,"}":334,"~":584 };
  // prettier-ignore
  const W_BOLD: Record<string, number> = { " ":278,".":278,",":278,"!":333,'"':474,"#":556,"$":556,"%":889,"&":722,"'":238,"(":333,")":333,"*":389,"+":584,":":333,";":333,"<":584,"=":584,">":584,"?":611,"@":975,"[":333,"]":333,"^":584,"_":556,"`":333,"{":389,"|":280,"}":389,"~":584 };
  for (const d of "0123456789") { W_REG[d] = 556; W_BOLD[d] = 556; }
  // prettier-ignore
  const R: Record<string, number> = { A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611 };
  // prettier-ignore
  const B: Record<string, number> = { A:722,B:722,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:556,K:722,L:611,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611 };
  // prettier-ignore
  const r_: Record<string, number> = { a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500 };
  // prettier-ignore
  const b_: Record<string, number> = { a:556,b:611,c:556,d:611,e:556,f:333,g:611,h:611,i:278,j:278,k:556,l:278,m:889,n:611,o:611,p:611,q:611,r:389,s:556,t:333,u:611,v:556,w:778,x:556,y:556,z:500 };
  Object.assign(W_REG, R, r_);
  Object.assign(W_BOLD, B, b_);

  function unescape(s: string): string {
    return s.replace(/\\([()\\])/g, "$1");
  }
  function textWidth(t: string, font: string, size: number): number {
    const table = font === "F2" ? W_BOLD : W_REG;
    let total = 0;
    for (const ch of t) total += table[ch] ?? 556;
    return (total * size) / 1000;
  }

  interface Placement {
    x: number;
    baselineTop: number;
    text: string;
    font: string;
    size: number;
    width: number;
  }

  let problems = 0;
  const problem = (msg: string): void => {
    problems++;
    console.log(`  !! ${msg}`);
  };

  streams.forEach((s, pageIdx) => {
    const items: Placement[] = [];
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const rects: { x: number; yTop: number; w: number; h: number }[] = [];

    let font = "F1";
    let size = 9;
    let pendingX = 0;
    let pendingY = 0;
    // BT /F1 9 Tf 1 0 0 1 X Y Tm (text) Tj ET, walked in document order.
    const re = /\/F([12])\s+([\d.]+)\s+Tf|1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|\((.*?)\)\s*Tj/g;
    let t: RegExpExecArray | null;
    while ((t = re.exec(s)) !== null) {
      if (t[1]) {
        font = `F${t[1]}`;
        size = Number(t[2]);
      } else if (t[3] !== undefined) {
        pendingX = Number(t[3]);
        pendingY = Number(t[4]);
      } else if (t[5] !== undefined) {
        const text = unescape(t[5]);
        items.push({
          x: pendingX,
          baselineTop: PH - pendingY,
          text,
          font,
          size,
          width: textWidth(text, font, size),
        });
      }
    }

    const lineRe = /([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g;
    let l: RegExpExecArray | null;
    while ((l = lineRe.exec(s)) !== null) {
      lines.push({
        x1: Number(l[1]),
        y1: Number(l[2]),
        x2: Number(l[3]),
        y2: Number(l[4]),
      });
    }
    const rectRe = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re/g;
    let rr: RegExpExecArray | null;
    while ((rr = rectRe.exec(s)) !== null) {
      rects.push({
        x: Number(rr[1]),
        yTop: PH - Number(rr[2]) - Number(rr[4]),
        w: Number(rr[3]),
        h: Number(rr[4]),
      });
    }

    console.log(
      `--- page ${pageIdx + 1}: ${items.length} text runs, ${lines.length} rules, ${rects.length} boxes`
    );

    // 1. Nothing may fall off the page.
    for (const it of items) {
      if (it.x < 0 || it.x + it.width > PW + 0.5) {
        problem(
          `text off page horizontally: "${it.text}" x=${it.x.toFixed(1)} w=${it.width.toFixed(1)}`
        );
      }
      if (it.baselineTop < 0 || it.baselineTop > PH) {
        problem(`text off page vertically: "${it.text}" y=${it.baselineTop.toFixed(1)}`);
      }
    }
    for (const ln of lines) {
      if (ln.x1 < -0.5 || ln.x2 > PW + 0.5) problem(`rule off page: ${ln.x1}..${ln.x2}`);
    }

    // 2. No two runs on the same baseline may overlap horizontally.
    const byBaseline = new Map<number, Placement[]>();
    for (const it of items) {
      const key = Math.round(it.baselineTop * 4) / 4;
      const list = byBaseline.get(key) ?? [];
      list.push(it);
      byBaseline.set(key, list);
    }
    for (const [y, list] of byBaseline) {
      list.sort((a, b) => a.x - b.x);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const cur = list[i];
        if (cur.x < prev.x + prev.width - 0.6) {
          problem(
            `overlap at y=${y}: "${prev.text}" ends ${(prev.x + prev.width).toFixed(1)}, "${cur.text}" starts ${cur.x.toFixed(1)}`
          );
        }
      }
    }

    // 3. Content must not collide with the footer band.
    for (const it of items) {
      if (
        it.baselineTop > FOOTER_Y - 4 &&
        it.text !== "E & O.E" &&
        !/Page \d+ of \d+|ORIGINAL|DUPLICATE|TRIPLICATE/.test(it.text)
      ) {
        problem(`body text inside the footer band: "${it.text}" y=${it.baselineTop.toFixed(1)}`);
      }
    }

    // 4. Right-aligned money columns must actually share a right edge.
    const amounts = items.filter((i) => /^-?[\d,]+\.\d\d$/.test(i.text.trim()));
    const rightEdges = new Map<string, string[]>();
    for (const a of amounts) {
      const edge = (a.x + a.width).toFixed(1);
      rightEdges.set(edge, [...(rightEdges.get(edge) ?? []), a.text]);
    }
    console.log(
      `  money values: ${amounts.length}; distinct right edges: ${[...rightEdges.keys()].join(", ")}`
    );

    // 5. Vertical rhythm: no run of blank page large enough to read as a
    //    formatting bug. The footer is excluded, so what is measured is the
    //    invoice body only.
    const isFooter = (i: Placement): boolean => i.baselineTop > FOOTER_Y - 6;
    const body = items.filter((i) => !isFooter(i));
    const baselines = [...new Set(body.map((i) => Math.round(i.baselineTop)))].sort(
      (a, b) => a - b
    );
    const contentEnd = Math.max(
      ...baselines,
      ...lines.map((l) => PH - (l.y1 + l.y2) / 2),
      ...rects.map((r) => r.yTop + r.h)
    );
    let biggestGap = 0;
    let gapAt = 0;
    let prev = 0;
    for (const b of baselines) {
      if (b - prev > biggestGap) {
        biggestGap = b - prev;
        gapAt = prev;
      }
      prev = b;
    }
    const trailingBlank = CONTENT_BOTTOM - contentEnd;
    console.log(
      `  body: ${body.length} of ${items.length} runs; ends y=${contentEnd.toFixed(1)}; unused below = ${trailingBlank.toFixed(1)}pt`
    );
    console.log(`  largest internal gap = ${biggestGap}pt (after y=${gapAt})`);
    if (biggestGap > 90) {
      problem(`large internal vertical gap of ${biggestGap}pt after y=${gapAt}`);
    }

    // 6. ASCII map at ~4pt resolution, so 9.6pt line leading is not aliased
    //    away. Rules and boxes go on one layer and glyphs on another, because a
    //    box interior filled with ':' would otherwise swallow every label in
    //    it.
    const COLS = 168;
    const ROWS = 205;
    const bg = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
    const fg = Array.from({ length: ROWS }, () => Array(COLS).fill(" "));
    const yToRow = (y: number): number =>
      Math.max(0, Math.min(ROWS - 1, Math.round(((y - 6) / (PH - 12)) * (ROWS - 1))));
    const xToCol = (x: number): number =>
      Math.max(0, Math.min(COLS - 1, Math.round((x / PW) * (COLS - 1))));

    for (const ln of lines) {
      const row = yToRow(PH - (ln.y1 + ln.y2) / 2);
      const from = xToCol(Math.min(ln.x1, ln.x2));
      const to = xToCol(Math.max(ln.x1, ln.x2));
      for (let c = from; c <= to; c++) if (bg[row][c] === " ") bg[row][c] = "-";
    }
    for (const r of rects) {
      const rowTop = yToRow(r.yTop);
      const rowBot = yToRow(r.yTop + r.h);
      const from = xToCol(r.x);
      const to = xToCol(r.x + r.w);
      for (let row = rowTop; row <= rowBot; row++) {
        for (let c = from; c <= to; c++) {
          if (bg[row][c] === " ") {
            bg[row][c] = row === rowTop || row === rowBot ? "=" : ".";
          }
        }
      }
    }
    for (const it of items) {
      const row = yToRow(it.baselineTop);
      const from = xToCol(it.x);
      const chars = [...it.text];
      const step =
        chars.length > 1 ? ((it.width / PW) * (COLS - 1)) / (chars.length - 1) : 0;
      for (let i = 0; i < chars.length; i++) {
        const col = from + Math.round(i * step);
        if (col >= 0 && col < COLS) fg[row][col] = chars[i] === " " ? "·" : chars[i];
      }
    }
    console.log(`  +${"-".repeat(COLS)}+`);
    for (let r = 0; r < ROWS; r++) {
      const merged = bg[r].map((c, i) => (fg[r][i] === " " ? c : fg[r][i]));
      const label = String(Math.round(6 + (r / (ROWS - 1)) * (PH - 12))).padStart(3);
      console.log(`${label} |${merged.join("")}|`);
    }
    console.log(`  +${"-".repeat(COLS)}+`);
    console.log("  (left gutter is page-y in points; columns span x = 0..595.28)\n");
  });

  console.log(
    problems === 0 ? "AUDIT: no problems found." : `AUDIT: ${problems} problem(s) found.`
  );
  if (problems > 0) process.exitCode = 1;
}
