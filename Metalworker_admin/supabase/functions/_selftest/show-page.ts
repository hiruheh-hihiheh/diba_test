// Print a page's measured geometry: every text run in device space, then every rule.
// Verification only.
import { resolve } from "node:path";

import { measurePage } from "./pdf-geometry.ts";

const path = resolve(process.argv[2]);
const pageObj = Number(process.argv[3] ?? 7);
const only = process.argv[4];

const m = measurePage(path, pageObj);
const PH = m.box[3];
const top = (y: number): number => PH - y; // distance from the page's top edge

console.log(`FILE     ${process.argv[2]}`);
console.log(`MediaBox ${m.box.join(" ")}   (${m.box[2].toFixed(2)} x ${m.box[3].toFixed(2)} pt)`);
console.log(`streams  ${m.visited} reached, ${m.unresolved.length} unresolved ${m.unresolved.slice(0, 8).join(" ")}`);
console.log(`texts    ${m.texts.length} runs, segments ${m.segs.length}\n`);

const filter = (s: string): boolean => !only || s.toLowerCase().includes(only.toLowerCase());

console.log("--- TEXT (y = distance from page top, PDF units) ---");
for (const t of m.texts) {
  if (!filter(t.text)) continue;
  const right = t.width === null ? "     ?" : (t.x + t.width).toFixed(1).padStart(7);
  console.log(
    `  y=${top(t.y).toFixed(1).padStart(6)}  x=${t.x.toFixed(1).padStart(6)} -> ${right.padStart(7)}` +
      `  sz=${t.size.toFixed(2).padStart(5)}  ${JSON.stringify(t.text.slice(0, 58))}`
  );
}

console.log("\n--- RULES (horizontal unless noted) ---");
const lines = m.segs
  .map((s) => ({ ...s, horizontal: Math.abs(s.y2 - s.y1) < 0.6 }))
  .filter((s) => s.horizontal)
  .sort((a, b) => top(b.y1) - top(a.y1) || Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
const seen = new Set<string>();
for (const s of lines) {
  const lo = Math.min(s.x1, s.x2);
  const hi = Math.max(s.x1, s.x2);
  const key = `${top(s.y1).toFixed(1)}:${lo.toFixed(0)}:${hi.toFixed(0)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  y=${top(s.y1).toFixed(1).padStart(6)}  x ${lo.toFixed(1).padStart(6)} -> ${hi.toFixed(1).padStart(6)}   len ${(hi - lo).toFixed(1)}`);
}
const other = m.segs.filter((s) => Math.abs(s.y2 - s.y1) >= 0.6);
console.log(`\n--- NON-HORIZONTAL SEGMENTS: ${other.length} ---`);
for (const s of other.slice(0, 30)) {
  console.log(`  (${s.x1.toFixed(1)},${s.y1.toFixed(1)}) -> (${s.x2.toFixed(1)},${s.y2.toFixed(1)})`);
}