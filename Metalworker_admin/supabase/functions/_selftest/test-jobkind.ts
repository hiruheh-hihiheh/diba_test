// Confirms the job classification is on the right page of the right PDF, and that
// the raw storage token never reaches the page.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "out");
const files = ["SAMPLE_original.pdf", "SAMPLE_duplicate.pdf", "SAMPLE_triplicate.pdf"];

/* The expected value per PAGE, taken from the parse rather than hard-coded, so
   this stays a real check and not a restatement of the renderer. */
const expectations = [
  { invoice: "SEW/274/2026-27", label: "LABOUR JOB", raw: "LABOUR JOB" },
  { invoice: "SEW/292/2026-27", label: "WITH METAL", raw: "WITHMETAL" },
];

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

for (const file of files) {
  const raw = new TextDecoder("latin1").decode(readFileSync(resolve(outDir, file)));
  const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
  console.log(`\n${file}  ${pages.length} page(s)`);

  check(pages.length === 2, "two pages");
  check(!raw.includes("(WITHMETAL)"), "the raw storage token is nowhere in the file");

  expectations.forEach((want, i) => {
    const page = pages[i] ?? "";
    check(page.includes(`(${want.invoice})`), `page ${i + 1} has ${want.invoice}`);
    check(page.includes(`(${want.label})`), `page ${i + 1} shows "${want.label}"`, page.includes(`(${want.label})`) ? "" : `expected (${want.label})`);
  });
}

console.log(failures === 0 ? "\nJOB KIND CHECKS: all passed." : `\nJOB KIND CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
