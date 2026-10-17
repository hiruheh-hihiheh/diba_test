// src/services/companyBillFiles.ts
// Pure helpers for Company Bills — no Supabase, no React. Testable under Node.

import type { CompanyBillDocument } from "../types/companyBill";

export const COMPANY_BILL_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type CompanyBillMime = (typeof COMPANY_BILL_ALLOWED_MIME)[number];

export const COMPANY_BILL_MAX_BYTES = 50 * 1024 * 1024;

export function normaliseMime(file: File): CompanyBillMime | null {
  const t = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (COMPANY_BILL_ALLOWED_MIME.includes(t as CompanyBillMime)) return t as CompanyBillMime;
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.xls$/i.test(name)) return "application/vnd.ms-excel";
  if (/\.xlsx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return null;
}

export function validateCompanyBillFile(file: File): { ok: true; mime: CompanyBillMime } | { ok: false; error: string } {
  if (!file || file.size === 0) return { ok: false, error: "That file is empty." };
  const mime = normaliseMime(file);
  if (!mime) return { ok: false, error: `"${file.name}" is not a supported type (PDF, image, or spreadsheet).` };
  if (file.size > COMPANY_BILL_MAX_BYTES) {
    return { ok: false, error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 50 MB limit.` };
  }
  return { ok: true, mime };
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "file";
}

export function storagePathFor(docId: string, filename: string): string {
  return `${docId}/${safeFilename(filename)}`;
}

export function isPreviewable(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// Pure planning for ZIP of selected company bill documents.
export interface CompanyBillZipEntry {
  docId: string;
  filename: string; // name inside archive
  storagePath: string;
  displayName: string;
}

export interface CompanyBillZipPlan {
  entries: CompanyBillZipEntry[];
  archiveName: string;
}

export function planCompanyBillZip(docs: CompanyBillDocument[], when: Date = new Date()): CompanyBillZipPlan {
  const used = new Set<string>();
  const entries: CompanyBillZipEntry[] = [];
  for (const d of docs) {
    const base = safeFilename(d.display_name || d.original_filename);
    const stem = base.replace(/\.[^.]+$/, "") || "document";
    const ext = (base.match(/\.[^.]+$/) || [""])[0] || guessExt(d.content_type);
    let name = `${stem}${ext}`;
    if (used.has(name.toLowerCase())) {
      let n = 2;
      while (used.has(`${stem}_${n}${ext}`.toLowerCase())) n++;
      name = `${stem}_${n}${ext}`;
    }
    used.add(name.toLowerCase());
    entries.push({ docId: d.id, filename: name, storagePath: d.storage_path, displayName: d.display_name });
  }
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  return { entries, archiveName: `company_bills_${date}.zip` };
}

function guessExt(ct: string | null): string {
  if (!ct) return "";
  if (ct === "application/pdf") return ".pdf";
  if (ct.startsWith("image/jpeg")) return ".jpg";
  if (ct === "image/png") return ".png";
  if (ct === "image/webp") return ".webp";
  if (ct.includes("spreadsheet") || ct === "application/vnd.ms-excel") return ".xlsx";
  return "";
}
