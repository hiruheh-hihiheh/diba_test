import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO = resolve(HERE, "../../../..");

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const migration = readFileSync(resolve(REPO, "Metalworker_admin/supabase/migrations/0019_reverse_charge_gst_text.sql"), "utf8");
const billDoc = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/billDocument.ts"), "utf8");
const parseBill = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/parseBill.ts"), "utf8");
const renderBill = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/renderBill.ts"), "utf8");
const billEdit = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/billEdit.ts"), "utf8");
const billCreator = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/process-bill-upload/_shared/billCreator.ts"), "utf8");
const desktopTypes = readFileSync(resolve(REPO, "Metalworker_desktop/src/types/bill.ts"), "utf8");
const desktopEdit = readFileSync(resolve(REPO, "Metalworker_desktop/src/components/bills/BillEditModal.tsx"), "utf8");

check(/ALTER COLUMN reverse_charge_gst TYPE text/i.test(migration), "migration converts column to text");
check(/USING \(CASE WHEN reverse_charge_gst IS NULL THEN NULL ELSE reverse_charge_gst::text END\)/i.test(migration), "migration preserves existing values");
check(/reverseChargeGst: text\(record\.reverse_charge_gst\)/.test(billDoc), "billDocument uses text mapping");
check(/reverseChargeGst: number \| string \| null/.test(parseBill), "BillCopy allows string");
check(/function reverseChargeValue/.test(renderBill), "renderBill has reverseChargeValue helper");
check(/value: reverseChargeValue\(bill\.reverseChargeGst\)/.test(renderBill), "render uses helper");
check(/if \(s === "Yes" \|\| s === "No"\) return s;/.test(renderBill), "Yes/No rendered as text");
check(/case "reverse_charge_gst":/.test(billEdit), "billEdit handles field");
check(/rc === "Yes" \|\| rc === "No"/.test(billEdit), "billEdit preserves Yes/No");
check(/set\("reverse_charge_gst", textOrNull\(r\.reverse_charge_gst\)\)/.test(billCreator), "creator uses textOrNull");
check(/reverse_charge_gst: string \| null/.test(desktopTypes), "desktop type is string");
check(/<option value="Yes">Yes<\/option>/.test(desktopEdit), "desktop editor has Yes option");
check(/<option value="No">No<\/option>/.test(desktopEdit), "desktop editor has No option");

console.log(failures === 0 ? "\nREVERSE CHARGE CHECKS: all passed." : `\nREVERSE CHARGE CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
