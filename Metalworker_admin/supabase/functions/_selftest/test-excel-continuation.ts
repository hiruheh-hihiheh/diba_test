import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "../../../../Metalworker_desktop/node_modules/xlsx/xlsx.js";
import { readFileSync } from "node:fs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO = resolve(HERE, "../../../..");
const PARSER = pathToFileURL(resolve(REPO, "Metalworker_desktop/src/services/jobImportParser.ts")).href;
const mod: any = await import(PARSER);

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const buf = readFileSync(resolve(REPO, "..", "Hawkins-Jobs Status.xlsx"));
const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
const ws = wb.Sheets["WORK_IN_STATUS"];
const json = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true }) as unknown[][];
const headerRowIndex = 1;
const headers = json[headerRowIndex].map(String);
const hasJobTypeColumn = headers.some((h: string) => {
  const norm = mod.normalizeHeader(h);
  return norm === "labourlwithmaterialbo" || norm === "jobtype";
});

// merge parent map
const mergeParent = new Map<number, number>();
const merges = (ws["!merges"] as any[]) ?? [];
for (const m of merges) {
  if (m.e.r <= m.s.r || m.s.c > 4) continue;
  for (let r = m.s.r + 1; r <= m.e.r; r++) if (!mergeParent.has(r)) mergeParent.set(r, m.s.r);
}

const parsedRows: any[] = [];
for (let i = headerRowIndex + 1; i < json.length; i++) {
  const rowArr = json[i];
  if (!rowArr || rowArr.length === 0 || rowArr.every((c: any) => c === null || c === undefined || String(c).trim() === "")) continue;
  const raw: Record<string, unknown> = {};
  for (let col = 0; col < headers.length; col++) if (headers[col]) raw[headers[col]] = rowArr[col];

  const parentRowIdx = mergeParent.get(i);
  const isContinuation = parentRowIdx !== undefined;
  let parentJobNo: string | null = null;
  let parentJobType: "labour" | "with_material" | null = null;
  if (isContinuation && parentRowIdx !== undefined) {
    const parentArr = json[parentRowIdx];
    const parentRaw: Record<string, unknown> = {};
    if (parentArr) for (let col = 0; col < headers.length; col++) if (headers[col]) parentRaw[headers[col]] = parentArr[col];
    const parentParsed = mod.parseRow(parentRaw, parentRowIdx + 1, { hasJobTypeColumn });
    parentJobNo = parentParsed.normalized.job_no;
    parentJobType = parentParsed.normalized.job_type;
  }
  const parsed = mod.parseRow(raw, i + 1, { isContinuation, parentJobNo, parentJobType, hasJobTypeColumn });
  parsedRows.push(parsed);
}

const cont = parsedRows.filter((r: any) => r.rowKind === "continuation");
check(cont.length === 5, "five continuation rows", String(cont.length));
check(parsedRows.filter((r: any) => r.rowKind === "needs_review").length >= 1, "row 4037 needs review");

const cont806 = parsedRows.filter((r: any) => r.parentJobKey === "806 D-with_material");
check(cont806.length === 2, "806 D has two continuation rows", String(cont806.length));
check(cont806.every((r: any) => r.normalized.job_type === "with_material"), "806 D continuations keep type");
check(cont806.every((r: any) => r.normalized.job_no === "806 D"), "806 D continuations inherit job no");

const cont940 = parsedRows.filter((r: any) => r.parentJobKey === "940-with_material");
check(cont940.length === 2, "940 has two continuation rows", String(cont940.length));

const cont1060 = parsedRows.filter((r: any) => r.parentJobKey === "1060-with_material");
check(cont1060.length === 1, "1060 has one continuation row", String(cont1060.length));

const stray = parsedRows.find((r: any) => r.rowNumber === 4037);
check(!!stray && stray.rowKind === "needs_review", "row 4037 needs review", stray?.rowKind);
check((stray?.errors ?? []).includes("Missing Job No"), "row 4037 reports missing job no");

const c806 = cont806.map((r: any) => (r.normalized.tool_part || r.normalized.tool_description || "").trim());
check(c806.includes("DIE MTRL BOHLER K110"), "806 D component 1");
check(c806.includes("PRESSURE PLATE MTRL BOHLER K110"), "806 D component 2");

const parent806 = parsedRows.find((r: any) => r.normalized.job_no === "806 D" && r.rowKind === "job");
check(!!parent806, "806 D parent is a job");

console.log(failures === 0 ? "\nEXCEL CONTINUATION CHECKS: all passed." : `\nEXCEL CONTINUATION CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
