import * as XLSX from "xlsx";
import type { ParsedExcelRow, ParserResult, ImportPreviewSummary } from "../types/jobImport";

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, ""); // strip all punctuation and spaces
}

// Expected normalized headers
const EXPECTED_HEADERS = [
  "srno",
  "labourlwithmaterialbo",
  "jobgivendate",
  "postatus",
  "tooldisc",
  "tooldescription",
  "toolpart",
  "quantity",
  "expectedcompdate",
  "expectedcompletiondate",
  "currentmcingstatus",
  "status",
  "statusiporcomp",
  "drgstatus",
  "modelstatus"
];

function scoreHeaders(headers: string[]): number {
  let score = 0;
  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (EXPECTED_HEADERS.includes(norm)) {
      score++;
    }
  }
  return score;
}

export function parseDate(value: any): string | null {
  if (!value) return null;
  // If it's a JS Date
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  // If it's a serial Excel date (number)
  if (typeof value === "number") {
    // Excel dates are days since 1900.
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().split("T")[0];
  }
  // If it's a string looking like a date
  const str = String(value).trim();
  const dateRegex = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
  const match = str.match(dateRegex);
  if (match) {
    const [_, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
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

  // Create a normalized lookup for the raw row
  const rowNorm: Record<string, any> = {};
  for (const [key, val] of Object.entries(raw)) {
    rowNorm[normalizeHeader(key)] = val;
  }

  // 1. Job No
  if (rowNorm["srno"] !== undefined) normalized.job_no = String(rowNorm["srno"]).trim();

  // 2. Job Type
  const rawType = rowNorm["labourlwithmaterialbo"] ?? rowNorm["jobtype"];
  if (rawType !== undefined) {
    const t = String(rawType).toUpperCase().trim();
    if (t === "L" || t === "LABOUR") {
      normalized.job_type = "labour";
    } else if (t === "BO" || t === "WITH MATERIAL" || t === "WITH MATERIAL (BO)") {
      normalized.job_type = "with_material";
    } else {
      warnings.push(`Unknown job type value: "${rawType}"`);
    }
  } else {
    warnings.push("Missing Job Type column");
  }

  // 3. Dates
  if (rowNorm["jobgivendate"] !== undefined) {
    const d = parseDate(rowNorm["jobgivendate"]);
    if (d) {
      normalized.job_given_date = d;
    } else {
      normalized.job_given_date = String(rowNorm["jobgivendate"]).trim(); // fallback string
      warnings.push("Job Given Date might not be a valid date format.");
    }
  }

  const expDateRaw = rowNorm["expectedcompdate"] ?? rowNorm["expectedcompletiondate"];
  if (expDateRaw !== undefined) {
    const parsedD = parseDate(expDateRaw);
    if (parsedD) {
      normalized.expected_completion_date = parsedD;
    } else {
      // It's descriptive text
      normalized.expected_completion_note = String(expDateRaw).trim();
    }
  }

  // 4. Strings
  if (rowNorm["postatus"] !== undefined) normalized.po_status = String(rowNorm["postatus"]).trim();
  if (rowNorm["tooldisc"] !== undefined || rowNorm["tooldescription"] !== undefined) {
    normalized.tool_description = String(rowNorm["tooldisc"] ?? rowNorm["tooldescription"]).trim();
  }
  if (rowNorm["toolpart"] !== undefined) normalized.tool_part = String(rowNorm["toolpart"]).trim();
  
  if (rowNorm["quantity"] !== undefined) {
    normalized.quantity = String(rowNorm["quantity"]).trim();
  }

  const mcingStatus = rowNorm["currentmcingstatus"] ?? rowNorm["machiningstatus"];
  if (mcingStatus !== undefined) normalized.current_machining_status = String(mcingStatus).trim();

  const status = rowNorm["statusiporcomp"] ?? rowNorm["status"];
  if (status !== undefined) normalized.status = String(status).trim();

  if (rowNorm["drgstatus"] !== undefined) normalized.drawing_status = String(rowNorm["drgstatus"]).trim();
  if (rowNorm["modelstatus"] !== undefined) normalized.model_status = String(rowNorm["modelstatus"]).trim();

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
        const workbook = XLSX.read(data, { type: "binary", cellDates: true });
        
        // Find best sheet
        let bestSheet = null;
        let bestScore = -1;
        let ignoredSheets: string[] = [];

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          
          if (json.length > 0) {
            // Find the header row (assume first non-empty row)
            let headerRow: any[] = [];
            for (const row of json) {
              if (row.length > 0) {
                headerRow = row;
                break;
              }
            }
            const score = scoreHeaders(headerRow.map(String));
            if (score > bestScore && score > 2) {
              bestScore = score;
              if (bestSheet) ignoredSheets.push(bestSheet);
              bestSheet = sheetName;
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
        const rawRows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];
        
        const parsedRows: ParsedExcelRow[] = [];
        
        // Track duplicates by job_no
        const seenJobNos = new Set<string>();

        rawRows.forEach((raw, i) => {
          const parsed = parseRow(raw, i + 2); // +2 because 1-indexed and header row
          
          if (parsed.normalized.job_no) {
            if (seenJobNos.has(parsed.normalized.job_no)) {
              parsed.warnings.push(`Possible duplicate row for Job No: ${parsed.normalized.job_no}`);
            } else {
              seenJobNos.add(parsed.normalized.job_no);
            }
          }

          if (Object.keys(raw).length > 0) {
            parsedRows.push(parsed);
          }
        });

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
