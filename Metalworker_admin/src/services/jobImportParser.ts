import type { ParsedExcelRow, ParserResult, ImportPreviewSummary } from "../types/jobImport";

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, ""); // strip all punctuation and spaces
}

export function parseDate(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().split("T")[0];
  }
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
      normalized.job_given_date = String(rowNorm["jobgivendate"]).trim(); 
      warnings.push("Job Given Date might not be a valid date format.");
    }
  }

  const expDateRaw = rowNorm["expectedcompdate"] ?? rowNorm["expectedcompletiondate"];
  if (expDateRaw !== undefined) {
    const parsedD = parseDate(expDateRaw);
    if (parsedD) {
      normalized.expected_completion_date = parsedD;
    } else {
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
