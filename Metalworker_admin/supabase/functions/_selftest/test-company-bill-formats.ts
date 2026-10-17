import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO = resolve(HERE, "../../../..");
const MOD = pathToFileURL(resolve(REPO, "Metalworker_desktop/src/services/companyBillFiles.ts")).href;

const m: any = await import(MOD);

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// Format recognition
const exts = ["pdf","jpg","jpeg","png","webp","gif","bmp","tif","tiff","doc","docx","rtf","txt","odt","xls","xlsx","csv","ods","ppt","pptx","odp"];
for (const e of exts) {
  const f = new File(["x"], `a.${e}`, { type: "" });
  const v = m.validateCompanyBillFile(f);
  check(v.ok === true, `${e} accepted`, v.ok ? v.mime : v.error);
}

// Dangerous rejected
for (const e of ["exe","bat","cmd","ps1","sh"]) {
  const f = new File(["x"], `a.${e}`, { type: "application/octet-stream" });
  const v = m.validateCompanyBillFile(f);
  check(v.ok === false, `${e} rejected`);
}

// Extension preservation / format label
check(m.getFormatLabel("Supplier_Invoice_October.pdf") === "PDF", "PDF label");
check(m.getFormatLabel("Steel_Purchase_Bill.docx") === "DOCX", "DOCX label");
check(m.getFormatLabel("Material_Expenses.xlsx") === "XLSX", "XLSX label");
check(m.getFormatLabel("Payment_Receipt.jpg") === "JPG", "JPG label");
check(m.getFormatLabel("Company_Expenses.csv") === "CSV", "CSV label");

// safeFilename preserves extension
check(m.safeFilename("a b/c.docx") === "a_b_c.docx", "safeFilename keeps ext");

// planCompanyBillZip uses original_filename
const docs = [{ id: "1", original_filename: "Steel_Purchase_Bill.docx", display_name: "Custom Label", storage_path: "1/x", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byte_size: 10, folder_id: null, supplier_name: null, bill_number: null, bill_date: null, amount: null, notes: null, uploaded_by: null, created_at: "", updated_at: "" }];
const plan = m.planCompanyBillZip(docs);
check(plan.entries[0].filename === "Steel_Purchase_Bill.docx", "zip uses original filename", plan.entries[0].filename);

// previewKind
check(m.previewKind("application/pdf", "a.pdf") === "pdf", "pdf preview");
check(m.previewKind("image/png", "a.png") === "image", "image preview");
check(m.previewKind("text/csv", "a.csv") === "text", "csv preview");
check(m.previewKind("application/vnd.ms-excel", "a.xlsx") === "none", "xlsx no preview");

// normaliseMime for csv with wrong mime
const csvFile = new File(["a,b"], "data.csv", { type: "text/plain" });
check(m.normaliseMime(csvFile) === "text/csv", "csv mime normalised");

console.log(failures === 0 ? "\nCOMPANY BILL FORMAT CHECKS: all passed." : `\nCOMPANY BILL FORMAT CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
