import fs from 'fs';
import { parseExcelFile } from './src/services/jobImportParser';

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
        // file.bits[0] is the raw buffer
        this.onload({ target: { result: file.bits[0].toString('binary') } });
      }
    }, 0);
  }
};

async function test() {
  const buffer = fs.readFileSync('E:\\\\dibesh all in one\\\\Hawkins-Jobs Status.xlsx');
  const file = new File([buffer], 'Hawkins-Jobs Status.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  try {
    const result = await parseExcelFile(file);
    
    console.log("Selected sheet:", result.selectedSheet);
    console.log("Ignored sheets:", result.ignoredSheets.join(", "));
    console.log("Total parsed rows:", result.rows.length);
    console.log("Labour count:", result.summary.labourRows);
    console.log("With Material count:", result.summary.withMaterialRows);
    console.log("Unknown job type count:", result.summary.unknownJobTypeRows);
    
    // Duplicate count and other stats
    let duplicates = 0;
    let warnings = 0;
    let errors = 0;
    const labourRows = [];
    const materialRows = [];
    const dateConversions = [];
    
    for (const r of result.rows) {
      if (r.errors.length > 0) errors++;
      if (r.warnings.length > 0) {
        warnings++;
        if (r.warnings.some(w => w.includes("duplicate"))) {
          duplicates++;
        }
      }
      
      if (r.normalized.job_type === "labour" && labourRows.length < 3) labourRows.push(r.normalized);
      if (r.normalized.job_type === "with_material" && materialRows.length < 3) materialRows.push(r.normalized);
      
      if (r.normalized.job_given_date) {
         dateConversions.push({ raw: r.raw["Job Given Date"] || r.raw["job_given_date"] || r.raw["Jobgivendate"], normalized: r.normalized.job_given_date });
      }
    }
    
    console.log("Duplicate count:", duplicates);
    console.log("Warning count:", warnings);
    console.log("Error count:", errors);
    
    console.log("\\nRepresentative Labour Rows:");
    console.log(JSON.stringify(labourRows, null, 2));
    
    console.log("\\nRepresentative With Material Rows:");
    console.log(JSON.stringify(materialRows, null, 2));
    
    console.log("\\nDate Conversions (Sample):");
    console.log(JSON.stringify(dateConversions.slice(0, 5), null, 2));

  } catch (err) {
    console.error("Parse failed:", err);
  }
}

test();
