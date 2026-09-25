import type { ParsedExcelRow, ImportPreviewSummary } from "../types/jobImport";

export function normalizeHeader(header: string): string {
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
    // Excel dates are days since 1900.
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (isNaN(date.getTime())) return null;
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  
  const str = String(value).trim();
  
  // YYYY-MM-DD or YYYY/MM/DD
  const yyyyMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (yyyyMatch) {
    const [_, yStr, mStr, dStr] = yyyyMatch;
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if (isValidCalendarDate(y, m, d)) {
      return `${yStr}-${mStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
    }
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const ddMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
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
