// src/services/companyBillFiles.ts
// Pure helpers for Company Bills — no Supabase, no React. Testable under Node.

import type { CompanyBillDocument } from "../types/companyBill";

export const COMPANY_BILL_MAX_BYTES = 50 * 1024 * 1024;

// Dangerous extensions that must never be accepted, regardless of MIME type.
const DANGEROUS_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "ps1", "sh", "msi", "scr", "com", "vbs", "js", "jar",
  "app", "deb", "rpm", "dmg", "pkg", "run", "bin",
]);

// Allowed extension -> canonical MIME type. Easy to extend: add a row here.
export const COMPANY_BILL_EXTENSION_MIME: Record<string, string> = {
  // Images
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  txt: "text/plain",
  odt: "application/vnd.oasis.opendocument.text",
  // Spreadsheets
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  // Presentations
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
};

export const COMPANY_BILL_ALLOWED_EXTENSIONS = Object.keys(COMPANY_BILL_EXTENSION_MIME);

export function getExtension(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function getFormatLabel(filename: string, contentType?: string | null): string {
  const ext = getExtension(filename);
  if (ext) return ext.toUpperCase();
  if (contentType) {
    const slash = contentType.indexOf("/");
    if (slash >= 0) return contentType.slice(slash + 1).toUpperCase().slice(0, 6);
  }
  return "FILE";
}

export function normaliseMime(file: File): string | null {
  const ext = getExtension(file.name);
  if (DANGEROUS_EXTENSIONS.has(ext)) return null;
  if (!COMPANY_BILL_EXTENSION_MIME[ext]) return null;
  const canonical = COMPANY_BILL_EXTENSION_MIME[ext];
  const t = (file.type || "").toLowerCase().trim();
  // Reject explicitly dangerous MIME types even if extension looks fine.
  if (t && (t.includes("executable") || t === "application/x-msdownload" || t === "application/x-sh")) {
    return null;
  }
  // Accept if no MIME provided or matches canonical / generic.
  if (!t || t === "application/octet-stream" || t === canonical) return canonical;
  // Allow common browser variants (e.g. text/plain for csv).
  if (ext === "csv" && (t === "text/plain" || t === "application/csv")) return canonical;
  if (ext === "txt" && t === "text/plain") return canonical;
  // If MIME is present but doesn't match, still trust extension for known types
  // (browsers frequently report wrong/empty MIME). Extension already validated.
  return canonical;
}

export function validateCompanyBillFile(file: File): { ok: true; mime: string } | { ok: false; error: string } {
  if (!file || file.size === 0) return { ok: false, error: "That file is empty." };
  const ext = getExtension(file.name);
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"${file.name}" is a potentially unsafe file type and was rejected.` };
  }
  if (!COMPANY_BILL_EXTENSION_MIME[ext]) {
    return { ok: false, error: `"${file.name}" is not a supported type. Allowed: ${COMPANY_BILL_ALLOWED_EXTENSIONS.join(", ")}.` };
  }
  const mime = normaliseMime(file);
  if (!mime) return { ok: false, error: `"${file.name}" could not be validated.` };
  if (file.size > COMPANY_BILL_MAX_BYTES) {
    return { ok: false, error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 50 MB limit.` };
  }
  return { ok: true, mime };
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "file";
}

export function storagePathFor(docId: string, filename: string): string {
  return `${docId}/${safeFilename(filename)}`;
}

export function isPreviewable(contentType: string | null, filename?: string): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct === "application/pdf" || ct.startsWith("image/")) return true;
  if (ct === "text/plain" || ct === "text/csv") return true;
  const ext = filename ? getExtension(filename) : "";
  if (ext === "txt" || ext === "csv") return true;
  return false;
}

export function previewKind(contentType: string | null, filename?: string): "pdf" | "image" | "text" | "none" {
  const ct = (contentType || "").toLowerCase();
  const ext = filename ? getExtension(filename) : "";
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (ct.startsWith("image/") || ["jpg","jpeg","png","webp","gif","bmp","tif","tiff"].includes(ext)) return "image";
  if (ct === "text/plain" || ct === "text/csv" || ext === "txt" || ext === "csv") return "text";
  return "none";
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
  filename: string;
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
    // Use original filename for archive entry, not display name.
    const base = safeFilename(d.original_filename || d.display_name);
    const stem = base.replace(/\.[^.]+$/, "") || "document";
    const ext = (base.match(/\.[^.]+$/) || [""])[0] || guessExt(d.content_type, d.original_filename);
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

function guessExt(ct: string | null, filename?: string): string {
  if (filename) {
    const m = filename.match(/\.[^.]+$/);
    if (m) return m[0];
  }
  if (!ct) return "";
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "text/plain": ".txt",
    "text/csv": ".csv",
  };
  return map[ct] || "";
}

export const COMPANY_BILL_ALLOWED_EXTENSIONS_LIST = COMPANY_BILL_ALLOWED_EXTENSIONS;
