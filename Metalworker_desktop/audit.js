import * as fs from 'fs';
import * as XLSX from 'xlsx';

// Copying logic directly so we don't have to worry about DOM FileReader in the original TS
function normalizeHeader(header) {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, ""); // strip all punctuation and spaces
}

const HEADER_ALIASES = {
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

const NORMALIZED_TO_CANONICAL = {};
for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const alias of aliases) {
    NORMALIZED_TO_CANONICAL[alias] = canonical;
  }
}

function scoreHeaders(headers) {
  const seenCanonical = new Set();
  for (const h of headers) {
    const norm = normalizeHeader(h);
    const canonical = NORMALIZED_TO_CANONICAL[norm];
    if (canonical) {
      seenCanonical.add(canonical);
    }
  }
  return seenCanonical.size;
}

function isValidCalendarDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseDate(value) {
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
    try {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
    } catch (e) {
      // ignore
    }
    return null;
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

function parseRow(raw, rowIndex) {
  const normalized = {
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
  const warnings = [];
  const errors = [];

  const rowCanonical = {};
  for (const [key, val] of Object.entries(raw)) {
    const norm = normalizeHeader(key);
    const canonical = NORMALIZED_TO_CANONICAL[norm];
    if (canonical) {
      rowCanonical[canonical] = val;
    }
  }

  if (rowCanonical.job_no !== undefined) normalized.job_no = String(rowCanonical.job_no).trim();

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

async function runAudit() {
  const fileData = fs.readFileSync("E:\\\\dibesh all in one\\\\Hawkins-Jobs Status.xlsx", "binary");
  const workbook = XLSX.read(fileData, { type: "binary", cellDates: false });
  
  let bestSheet = null;
  let bestScore = -1;
  let ignoredSheets = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    if (json.length > 0) {
      // EXISTING LOGIC (from Desktop parser)
      let headerRow = [];
      for (const row of json) {
        if (row.length > 0) {
          headerRow = row;
          break; // <-- This is what the production parser does!
        }
      }
      const score = scoreHeaders(headerRow.map(String));
      
      if (score > bestScore && score >= 4) {
        if (bestSheet) ignoredSheets.push(bestSheet);
        bestScore = score;
        bestSheet = sheetName;
      } else {
        ignoredSheets.push(sheetName);
      }
    } else {
      ignoredSheets.push(sheetName);
    }
  }

  // To actually generate the requested report, we will parse WORK_IN_STATUS directly
  // since the existing logic returns bestSheet = null (because row 0 is the title, not headers).
  const actualSheet = "WORK_IN_STATUS";
  const sheet = workbook.Sheets[actualSheet];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { range: 1 }); // range: 1 skips the title row
  
  const parsedRows = [];
  const seenJobNos = new Set();

  rawRows.forEach((raw, i) => {
    const parsed = parseRow(raw, i + 2);
    
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

  // Calculate statistics
  let validRows = 0, warningRows = 0, errorRows = 0, labourRows = 0, withMaterialRows = 0, unknownTypeRows = 0;
  let emptyRows = 0;
  let missingJobNo = 0;
  
  const uniqueJobs = new Set();
  const uniqueJobAndTypes = new Set();
  let duplicateJobNoCount = 0;
  let duplicateJobAndTypeCount = 0;

  const unknownTypes = new Set();
  const quantityExamples = new Set();
  const statusValues = new Set();
  const warningReasons = {};
  const errorReasons = {};

  let sampleLabour = [];
  let sampleMaterial = [];
  let sampleWarning = [];
  let sampleDuplicate = [];
  let sampleDescriptiveDate = [];
  let sampleUnusualQuantity = [];
  let sampleUnknownType = [];

  for (const r of parsedRows) {
    if (r.errors.length > 0) {
      errorRows++;
      if (r.errors.includes("Empty or invalid row")) emptyRows++;
      if (r.errors.includes("Missing Job No")) missingJobNo++;
      
      r.errors.forEach(e => warningReasons[e] = (warningReasons[e] || 0) + 1);
    } else {
      if (r.warnings.length > 0) {
        warningRows++;
        r.warnings.forEach(w => warningReasons[w] = (warningReasons[w] || 0) + 1);
      } else {
        validRows++;
      }

      if (r.normalized.job_no) {
        if (uniqueJobs.has(r.normalized.job_no)) {
            duplicateJobNoCount++;
            if (sampleDuplicate.length < 5) sampleDuplicate.push(r);
        } else {
            uniqueJobs.add(r.normalized.job_no);
        }

        const jobTypeKey = `${r.normalized.job_no}-${r.normalized.job_type}`;
        if (uniqueJobAndTypes.has(jobTypeKey)) {
            duplicateJobAndTypeCount++;
        } else {
            uniqueJobAndTypes.add(jobTypeKey);
        }
      }

      if (r.normalized.job_type === "labour") {
        labourRows++;
        if (sampleLabour.length < 5) sampleLabour.push(r);
      } else if (r.normalized.job_type === "with_material") {
        withMaterialRows++;
        if (sampleMaterial.length < 5) sampleMaterial.push(r);
      } else {
        unknownTypeRows++;
        unknownTypes.add(r.raw["job_type"] || r.raw["JobType"] || r.raw["Labour/With Material"] || r.raw["LABOUR/WITH MATERIAL(BO)"] || JSON.stringify(r.raw));
        if (sampleUnknownType.length < 5) sampleUnknownType.push(r);
      }

      if (r.normalized.quantity) {
        quantityExamples.add(r.normalized.quantity);
        if (String(r.normalized.quantity).includes("+") && sampleUnusualQuantity.length < 5) {
            sampleUnusualQuantity.push(r);
        }
      }
      if (r.normalized.expected_completion_note) {
          if (sampleDescriptiveDate.length < 5) sampleDescriptiveDate.push(r);
      }
      
      if (r.warnings.length > 0 && sampleWarning.length < 5) sampleWarning.push(r);

      // Collect statuses
      ["po_status", "current_machining_status", "status", "drawing_status", "model_status"].forEach(k => {
          if (r.normalized[k]) statusValues.add(`${k}: ${r.normalized[k]}`);
      });
    }
  }

  console.log("==================================================");
  console.log("LOCAL EXCEL WORKBOOK AUDIT REPORT");
  console.log("==================================================");
  console.log(`Workbook: Hawkins-Jobs Status.xlsx`);
  console.log(`Selected Sheet: ${bestSheet}`);
  console.log(`Ignored Sheets: ${ignoredSheets.join(", ")}`);
  console.log("==================================================");
  console.log("ROW COUNTS");
  console.log(`Total parsed rows: ${parsedRows.length}`);
  console.log(`Actual data rows: ${parsedRows.length - emptyRows}`);
  console.log(`Completely empty rows ignored: ${emptyRows}`);
  console.log("==================================================");
  console.log("JOB TYPE AUDIT");
  console.log(`Labour: ${labourRows}`);
  console.log(`With Material: ${withMaterialRows}`);
  console.log(`Unknown: ${unknownTypeRows}`);
  if (unknownTypeRows > 0) {
      console.log(`Unknown values found: ${Array.from(unknownTypes).join(", ")}`);
  }
  console.log("==================================================");
  console.log("JOB NUMBER AUDIT");
  console.log(`Rows with valid job number: ${uniqueJobs.size + duplicateJobNoCount}`);
  console.log(`Rows with missing job number: ${missingJobNo}`);
  console.log(`Duplicate job numbers (internal to workbook): ${duplicateJobNoCount}`);
  console.log(`Duplicate job_no + job_type combinations: ${duplicateJobAndTypeCount}`);
  console.log("==================================================");
  console.log("WARNING / ERROR AUDIT");
  console.log(`Rows without warnings/errors: ${validRows}`);
  console.log(`Rows with warnings: ${warningRows}`);
  console.log(`Rows with errors: ${errorRows}`);
  console.log("Reasons:");
  for (const [reason, count] of Object.entries(warningReasons)) {
      console.log(`- ${reason}: ${count} rows`);
  }
  console.log("==================================================");
  console.log("STATUS VALUES FOUND");
  Array.from(statusValues).slice(0, 30).forEach(s => console.log(s));
  console.log("==================================================");
  console.log("QUANTITY EXAMPLES FOUND");
  Array.from(quantityExamples).slice(0, 15).forEach(s => console.log(s));
  console.log("==================================================");
  
  const printSample = (label, arr) => {
      console.log(`\n--- ${label} ---`);
      arr.forEach(r => {
          console.log(`Excel row: ${r.rowNumber}`);
          console.log(`Would become:`);
          console.log(JSON.stringify(r.normalized, null, 2));
      });
  };

  printSample("5 Labour rows", sampleLabour.slice(0, 5));
  printSample("5 With Material rows", sampleMaterial.slice(0, 5));
  printSample("Warning rows", sampleWarning.slice(0, 5));
  printSample("Duplicate rows", sampleDuplicate.slice(0, 5));
  printSample("Rows with descriptive Expected Comp Date text", sampleDescriptiveDate.slice(0, 5));
  printSample("Rows with unusual quantities", sampleUnusualQuantity.slice(0, 5));
  if (sampleUnknownType.length > 0) printSample("Unknown job-type rows", sampleUnknownType.slice(0, 5));

}

runAudit().catch(console.error);
