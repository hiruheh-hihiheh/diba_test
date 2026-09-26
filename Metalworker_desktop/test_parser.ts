import fs from 'fs';
import * as XLSX from 'xlsx';
import { parseExcelFile, parseDate, normalizeHeader } from './src/services/jobImportParser';

// Mock File and FileReader for Node environment
global.File = class File {
  constructor(bits, name, options) {
    this.bits = bits;
    this.name = name;
  }
};

global.FileReader = class FileReader {
  readAsBinaryString(file) {
    setTimeout(() => {
      if (this.onload) {
        this.onload({ target: { result: file.bits[0].toString('binary') } });
      }
    }, 0);
  }
};

async function runValidation() {
  const filePath = 'E:\\\\dibesh all in one\\\\Hawkins-Jobs Status.xlsx';
  const buffer = fs.readFileSync(filePath);
  
  // Basic Sheet Inspection
  const fileData = buffer.toString('binary');
  const workbook = XLSX.read(fileData, { type: 'binary', cellDates: false });
  console.log("=== WORKBOOK INSPECTION ===");
  console.log("Sheet names:", workbook.SheetNames);
  
  const sheet = workbook.Sheets['WORK_IN_STATUS'];
  console.log("WORK_IN_STATUS !ref:", sheet['!ref']);
  
  const jsonWithEmpty = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true });
  console.log("Rows returned by sheet_to_json:", jsonWithEmpty.length);
  
  let emptyRows = 0;
  let nonEmptyRows = 0;
  let lastNonEmptyRow = 0;
  for (let i = 0; i < jsonWithEmpty.length; i++) {
    const r = jsonWithEmpty[i];
    if (!r || r.length === 0 || r.every(c => c === null || c === undefined || String(c).trim() === '')) {
      emptyRows++;
    } else {
      nonEmptyRows++;
      lastNonEmptyRow = i + 1;
    }
  }
  
  console.log("Completely blank rows:", emptyRows);
  console.log("Total non-empty physical rows:", nonEmptyRows);
  console.log("Last non-empty physical row:", lastNonEmptyRow);
  
  // Date parsing verification
  console.log("\n=== DATE PARSING VERIFICATION ===");
  const testDates = [
    45203,
    45300,
    "45203",
    "45300",
    "01.02.2024",
    "23.02.2024",
    "23/02/2024",
    "23-02-2024",
    "31.02.2024",
    "32.01.2024"
  ];
  for (const d of testDates) {
    console.log(`parseDate(${JSON.stringify(d)}) ->`, parseDate(d));
  }

  // Parse Excel File (Production Parser)
  console.log("\n=== PRODUCTION PARSER RESULTS ===");
  const file = new File([buffer], 'Hawkins-Jobs Status.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  try {
    const result = await parseExcelFile(file);
    
    // Reverse engineer the header that was picked
    let headerRowIndex = 1; // Assuming we picked index 1
    const rawHeader = jsonWithEmpty[headerRowIndex];
    console.log("Detected Header Row Index:", headerRowIndex, "(Excel Row", headerRowIndex + 1 + ")");
    console.log("Detected Header Content:");
    rawHeader.forEach((col, idx) => {
      if (col) {
        console.log(`  Col ${idx}: "${col}" -> Normalized: "${normalizeHeader(String(col))}"`);
      }
    });
    
    console.log("\nParsed rows count:", result.rows.length);
    
    const rowNumbers = result.rows.map(r => r.rowNumber);
    console.log("First 20 parsed row numbers:", rowNumbers.slice(0, 20).join(", "));
    console.log("Last 20 parsed row numbers:", rowNumbers.slice(-20).join(", "));
    
    console.log("\nCounts:");
    console.log("Labour:", result.summary.labourRows);
    console.log("With Material:", result.summary.withMaterialRows);
    console.log("Unknown Job Type:", result.summary.unknownJobTypeRows);
    
    let duplicates = 0;
    for (const r of result.rows) {
      if (r.warnings.some(w => w.includes("duplicate"))) {
        duplicates++;
      }
    }
    console.log("Duplicate job_no + job_type count:", duplicates);
    
    console.log("\n=== UNKNOWN JOB TYPES ===");
    for (const r of result.rows) {
      if (r.normalized.job_type === null) {
        let rawJobType = r.raw["Labour (L) /With Material (BO)"] || r.raw["job_type"] || Object.values(r.raw)[1] || "undefined";
        // Actually we can print raw row
        console.log(`Row ${r.rowNumber} | Job No: ${r.normalized.job_no} | Raw Job Type: ${rawJobType} | Warnings: ${r.warnings.join('; ')}`);
      }
    }

    console.log("\n=== ROWS WITH ERRORS OR WARNINGS ===");
    let errWarnCount = 0;
    for (const r of result.rows) {
      if (r.errors.length > 0 || r.warnings.length > 0) {
        if (errWarnCount < 10) { // Limit to 10 for brevity
          console.log(`Row ${r.rowNumber} | Job: ${r.normalized.job_no}`);
          console.log(`  Errors:`, r.errors);
          console.log(`  Warnings:`, r.warnings);
          console.log(`  Raw Content:`, JSON.stringify(r.raw));
        }
        errWarnCount++;
      }
    }
    console.log(`...and ${Math.max(0, errWarnCount - 10)} more rows with warnings/errors.`);

  } catch (e) {
    console.error(e);
  }
}

runValidation();
