import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO = resolve(HERE, "../../../..");
const MIG = resolve(REPO, "Metalworker_admin/supabase/migrations/0017_company_bills.sql");
const DESKTOP = resolve(REPO, "Metalworker_desktop");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const sql = readFileSync(MIG, "utf8");
const sidebar = readFileSync(resolve(DESKTOP, "src/components/layout/Sidebar.tsx"), "utf8");
const app = readFileSync(resolve(DESKTOP, "src/App.tsx"), "utf8");
const page = readFileSync(resolve(DESKTOP, "src/pages/CompanyBills.tsx"), "utf8");
const svc = readFileSync(resolve(DESKTOP, "src/services/companyBills.ts"), "utf8");

console.log("Migration 0017");
check(/CREATE TABLE IF NOT EXISTS public\.company_bill_folders/i.test(sql), "company_bill_folders table created");
check(/CREATE TABLE IF NOT EXISTS public\.company_bill_documents/i.test(sql), "company_bill_documents table created");
check(/folder_id\s+uuid REFERENCES public\.company_bill_folders/i.test(sql), "folder_id FK nullable");
check(/display_name\s+text NOT NULL/i.test(sql), "display_name NOT NULL");
check(/original_filename\s+text NOT NULL/i.test(sql), "original_filename NOT NULL");
check(/storage_path\s+text NOT NULL/i.test(sql), "storage_path NOT NULL");
check(/supplier_name\s+text/i.test(sql), "supplier_name nullable");
check(/bill_number\s+text/i.test(sql), "bill_number nullable");
check(/bill_date\s+date/i.test(sql), "bill_date nullable");
check(/amount\s+numeric\(14, 2\)/i.test(sql), "amount nullable numeric");
check(/notes\s+text/i.test(sql), "notes nullable");
check(/ENABLE ROW LEVEL SECURITY/i.test(sql) && (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length >= 2, "RLS enabled on both tables");
check(/REVOKE ALL ON TABLE public\.company_bill_folders FROM anon/i.test(sql), "anon revoked from folders");
check(/REVOKE ALL ON TABLE public\.company_bill_documents FROM anon/i.test(sql), "anon revoked from documents");
check(/company_bill_folders_no_anon_access/i.test(sql), "anon deny policy on folders");
check(/company_bill_documents_no_anon_access/i.test(sql), "anon deny policy on documents");
check(/company_bill_folders_admin_all/i.test(sql) && /p\.role = 'admin' AND p\.is_active = true/i.test(sql), "admin active gate on folders");
check(/company_bill_documents_admin_all/i.test(sql), "admin active gate on documents");
check(/'company-bills'/i.test(sql), "private company-bills bucket");
check(/public,\s*false/i.test(sql) || /'company-bills',\s*'company-bills',\s*false/i.test(sql), "bucket is private");
check(/company_bills_storage_read/i.test(sql) && /company_bills_storage_write/i.test(sql) && /company_bills_storage_delete/i.test(sql), "storage read/write/delete policies");
check(!/service_role/i.test(sql), "no service role in migration");

console.log("\nDesktop wiring");
check(sidebar.includes('label: "Company Bills"'), "Sidebar has Company Bills item");
check(sidebar.includes('path: "/company-bills"'), "Sidebar route path");
check(app.includes('path="/company-bills"'), "App route registered");
check(app.includes("CompanyBillsPage"), "CompanyBills page imported");

console.log("\nIsolation");
check(!svc.includes('"bills"') && !svc.includes("'bills'"), "service does not reference bills table");
check(!svc.includes('"folder_items"') && !svc.includes("'folder_items'") && !svc.includes('"admin_folders"'), "service does not reference existing folder tables");
check(/company_bill_folders/i.test(svc) && /company_bill_documents/i.test(svc), "service uses dedicated tables");
check(/company-bills/i.test(svc), "service uses dedicated bucket");

console.log("\nPage features");
check(page.includes("Upload Company Bills") || page.includes("Upload"), "upload action present");
check(page.includes("handleDeleteFolder") || page.includes("deleteCompanyBillFolder"), "folder deletion present");
check(page.includes("handlePreview") || page.includes("isPreviewable"), "preview present");
check(page.includes("handleDownload"), "download present");
check(page.includes("handleSaveEdit"), "metadata edit present");
check(page.includes("handleReplaceFile") || page.includes("replaceCompanyBillFile"), "replace present");
check(page.includes("handleMoveDocs"), "move present");

console.log(
  failures === 0
    ? "\nCOMPANY BILLS CHECKS: all passed."
    : `\nCOMPANY BILLS CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
