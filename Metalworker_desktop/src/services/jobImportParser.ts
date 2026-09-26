import * as XLSX from "xlsx";
import type { ParsedExcelRow, ParserResult, ImportPreviewSummary } from "../types/jobImport";

export function normalizeHeader(header: string): string {
  if (typeof header !== "string") return "";
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, ""); // strip all punctuation and spaces
}

const HEADER_ALIASES: Record<string, string[]> = {
  job_no: ["srno"],
  job_type: ["labourlwithmaterialbo", "jobtype"],
  job_given_date: ["jobgivendate"],
  po_status: ["postatus", "postatuspendingornumber"],
  tool_description: ["tooldisc", "tooldescription"],
  tool_part: ["toolpart"],
  quantity: ["quantity"],
  expected_completion_date: ["expectedcompdate", "expectedcompletiondate"],
  current_machining_status: ["currentmcingstatus", "machiningstatus"],
  status: ["statusiporcomp", "status"],
  drawing_status: ["drgstatus"],
  model_status: ["modelstatus"]
};

// Create a reverse lookup: normalized -> canonical
const NORMALIZED_TO_CANONICAL: Record<string, string> = {};
for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) {
    NORMALIZED_TO_CANONICAL[alias] = canonical;
  }
}

function scoreHeaders(headers: string[]): number {
  const seenCanonical = new Set<string>();
  for (const h of headers) {
    const norm = normalizeHeader(h);
    const canonical = NORMALIZED_TO_CANONICAL[norm];
    if (canonical) {
      seenCanonical.add(canonical);
    }
  }
  return seenCanonical.size;
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseDate(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  
  if (typeof value === "number") {
    const days = Math.floor(value);
    const date = new Date(Date.UTC(1899, 11, 30 + days));
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(date.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return null;
  }
  
  const str = String(value).trim();
  
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (num > 10000 && num < 100000) {
      const days = Math.floor(num);
      const date = new Date(Date.UTC(1899, 11, 30 + days));
      if (!isNaN(date.getTime())) {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, "0");
        const d = String(date.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
  }
  
  const yyyyMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (yyyyMatch) {
    const [_, yStr, mStr, dStr] = yyyyMatch;
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if (isValidCalendarDate(y, m, d)) {
      return `${yStr}-${mStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
    }
  }

  const ddMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (ddMatch) {
    const [_, dStr, mStr, yStr] = ddMatch;
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if (isValidCalendarDate(y, m, d)) {
      return `${yStr}-${mStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
    }
  }
  
  return null;
}

export function parseRow(raw: Record<string, any>, rowIndex: number): ParsedExcelRow {
  const normalized: ParsedExcelRow["normalized"] = {
    job_type: null,
    job_no: null,
    job_given_date: null,
    po_status: null,
    tool_description: null,
    tool_part: null,
    quantity: null,
    expected_completion_date: null,
    expected_completion_note: null,
    current_machining_status: null,
    status: null,
    drawing_status: null,
    drawing_status_note: null,
    model_status: null,
  };
  const warnings: string[] = [];
  const errors: string[] = [];

  // Create a canonical lookup for the raw row
  const rowCanonical: Record<string, any> = {};
  for (const [key, val] of Object.entries(raw)) {
    const norm = normalizeHeader(key);
    const canonical = NORMALIZED_TO_CANONICAL[norm];
    if (canonical) {
      rowCanonical[canonical] = val;
    }
  }

  // 1. Job No
  if (rowCanonical.job_no !== undefined) normalized.job_no = String(rowCanonical.job_no).trim();

  // 2. Job Type
  const rawType = rowCanonical.job_type;
  if (rawType !== undefined) {
    const t = String(rawType).toUpperCase().trim();
    if (t === "L" || t === "LABOUR") {
      normalized.job_type = "labour";
    } else if (t === "BO" || t === "M" || t === "WITH MATERIAL" || t === "WITH MATERIAL (BO)") {
      normalized.job_type = "with_material";
    } else {
      warnings.push(`Unknown job type value: "${rawType}"`);
    }
  } else {
    warnings.push("Missing Job Type column");
  }

  // 3. Dates
  const rawGivenDate = rowCanonical.job_given_date;
  if (rawGivenDate !== undefined && rawGivenDate !== null && String(rawGivenDate).trim() !== "") {
    const d = parseDate(rawGivenDate);
    if (d) {
      normalized.job_given_date = d;
    } else {
      normalized.job_given_date = null;
      warnings.push("Job Given Date is not a valid date and will require review.");
    }
  }

  const rawExpDate = rowCanonical.expected_completion_date;
  if (rawExpDate !== undefined && rawExpDate !== null && String(rawExpDate).trim() !== "") {
    const parsedD = parseDate(rawExpDate);
    if (parsedD) {
      normalized.expected_completion_date = parsedD;
    } else {
      normalized.expected_completion_note = String(rawExpDate).trim();
    }
  }

  // 4. Strings
  if (rowCanonical.po_status !== undefined) normalized.po_status = String(rowCanonical.po_status).trim();
  if (rowCanonical.tool_description !== undefined) normalized.tool_description = String(rowCanonical.tool_description).trim();
  if (rowCanonical.tool_part !== undefined) normalized.tool_part = String(rowCanonical.tool_part).trim();
  
  if (rowCanonical.quantity !== undefined) {
    normalized.quantity = String(rowCanonical.quantity).trim();
  }

  if (rowCanonical.current_machining_status !== undefined) normalized.current_machining_status = String(rowCanonical.current_machining_status).trim();
  if (rowCanonical.status !== undefined) normalized.status = String(rowCanonical.status).trim();
  if (rowCanonical.drawing_status !== undefined) normalized.drawing_status = String(rowCanonical.drawing_status).trim();
  if (rowCanonical.model_status !== undefined) normalized.model_status = String(rowCanonical.model_status).trim();

  // Validate
  let hasData = false;
  for (const v of Object.values(normalized)) {
    if (v !== null && v !== "") hasData = true;
  }
  
  if (!hasData) {
    errors.push("Empty or invalid row");
  } else if (!normalized.job_no) {
    errors.push("Missing Job No");
  }

  return {
    rowNumber: rowIndex,
    raw,
    normalized,
    warnings,
    errors
  };
}

export async function parseExcelFile(file: File): Promise<ParserResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary", cellDates: false });
        
        let bestSheet = null;
        let bestScore = -1;
        let ignoredSheets: string[] = [];
        const sheetHeaderRowIndices: Record<string, number> = {};

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true }) as any[][];
          
          let bestHeaderScore = -1;
          let bestHeaderRowIndex = -1;
          
          if (json.length > 0) {
            for (let r = 0; r < Math.min(json.length, 15); r++) {
              const row = json[r];
              if (row && row.length > 0) {
                const score = scoreHeaders(row.map(String));
                if (score > bestHeaderScore) {
                  bestHeaderScore = score;
                  bestHeaderRowIndex = r;
                }
              }
            }

            if (bestHeaderScore > bestScore && bestHeaderScore >= 4) {
              if (bestSheet) ignoredSheets.push(bestSheet);
              bestScore = bestHeaderScore;
              bestSheet = sheetName;
              sheetHeaderRowIndices[sheetName] = bestHeaderRowIndex;
            } else {
              ignoredSheets.push(sheetName);
            }
          } else {
            ignoredSheets.push(sheetName);
          }
        }

        if (!bestSheet) {
          return resolve({
            selectedSheet: null,
            ignoredSheets,
            rows: [],
            summary: buildSummary([]),
            error: "Could not identify a valid operational sheet. Make sure headers like 'Sr No', 'Labour (L)', and 'Quantity' exist."
          });
        }

        const sheet = workbook.Sheets[bestSheet];
        const jsonWithEmpty = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true }) as any[][];
        
        const headerRowIndex = sheetHeaderRowIndices[bestSheet];
        const headers = jsonWithEmpty[headerRowIndex].map(String);
        
        const parsedRows: ParsedExcelRow[] = [];
        const seenJobNos = new Set<string>();

        for (let i = headerRowIndex + 1; i < jsonWithEmpty.length; i++) {
          const rowArr = jsonWithEmpty[i];
          if (!rowArr || rowArr.length === 0 || rowArr.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) {
            continue;
          }

          const raw: Record<string, any> = {};
          for (let col = 0; col < headers.length; col++) {
            if (headers[col]) {
              raw[headers[col]] = rowArr[col];
            }
          }

          const parsed = parseRow(raw, i + 1);
          
          if (parsed.normalized.job_no) {
            const jobKey = `${parsed.normalized.job_no}-${parsed.normalized.job_type}`;
            if (seenJobNos.has(jobKey)) {
              parsed.warnings.push(`Possible duplicate row for Job No: ${parsed.normalized.job_no} (${parsed.normalized.job_type})`);
            } else {
              seenJobNos.add(jobKey);
            }
          }

          if (Object.keys(raw).length > 0) {
            parsedRows.push(parsed);
          }
        }

        resolve({
          selectedSheet: bestSheet,
          ignoredSheets,
          rows: parsedRows,
          summary: buildSummary(parsedRows),
          error: null
        });

      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsBinaryString(file);
  });
}

function buildSummary(rows: ParsedExcelRow[]): ImportPreviewSummary {
  const summary: ImportPreviewSummary = {
    totalRows: rows.length,
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    labourRows: 0,
    withMaterialRows: 0,
    unknownJobTypeRows: 0
  };

  for (const r of rows) {
    if (r.errors.length > 0) summary.errorRows++;
    else if (r.warnings.length > 0) summary.warningRows++;
    else summary.validRows++;

    if (r.normalized.job_type === "labour") summary.labourRows++;
    else if (r.normalized.job_type === "with_material") summary.withMaterialRows++;
    else summary.unknownJobTypeRows++;
  }

  return summary;
}
