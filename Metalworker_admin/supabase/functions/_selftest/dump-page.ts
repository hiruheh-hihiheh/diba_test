// Dump one page's text runs with coordinates, in drawing order.
// Used to inspect a specific page when the ASCII map is ambiguous.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "out");
const file = process.argv[2] ?? "BILL 301 TO_original.pdf";
const want = Number(process.argv[3] ?? 6);

const PH = 841.89;
const raw = new TextDecoder("latin1").decode(readFileSync(resolve(outDir, file)));
const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
console.log(`${file}: ${pages.length} pages; showing page ${want}`);

const s = pages[want - 1] ?? "";
let font = "F1";
let size = 9;
let x = 0;
let y = 0;
const runs = [];
const re = /\/F([12])\s+([\d.]+)\s+Tf|1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|\((.*?)\)\s*Tj/g;
let t;
while ((t = re.exec(s)) !== null) {
  if (t[1]) { font = `F${t[1]}`; size = Number(t[2]); }
  else if (t[3] !== undefined) { x = Number(t[3]); y = Number(t[4]); }
  else if (t[5] !== undefined) runs.push({ y: PH - y, x, size, font, text: t[5] });
}
console.log(`  ${runs.length} runs`);
for (const r of runs) {
  console.log(`  y=${r.y.toFixed(1).padStart(6)} x=${r.x.toFixed(1).padStart(6)} sz=${r.size} ${r.font}  ${JSON.stringify(r.text.slice(0, 60))}`);
}
