// src/services/companyBills.ts
import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import type { CompanyBillFolder, CompanyBillDocument } from "../types/companyBill";
import { storagePathFor, validateCompanyBillFile } from "./companyBillFiles";

const FOLDERS = "company_bill_folders";
const DOCS = "company_bill_documents";
const BUCKET = "company-bills";



/* ── Folders ─────────────────────────────────────────────────────────── */

export async function fetchCompanyBillFolders(): Promise<CompanyBillFolder[]> {
  const { data: folderRows, error } = await supabase
    .from(FOLDERS)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const folders = (folderRows ?? []) as CompanyBillFolder[];
  if (folders.length === 0) return folders;

  const { data: docRows, error: docError } = await supabase
    .from(DOCS)
    .select("folder_id");
  if (docError) throw new Error(docError.message);

  const counts = new Map<string, number>();
  for (const r of (docRows ?? []) as { folder_id: string | null }[]) {
    if (r.folder_id) counts.set(r.folder_id, (counts.get(r.folder_id) ?? 0) + 1);
  }
  for (const f of folders) f.billCount = counts.get(f.id) ?? 0;
  return folders;
}

export async function createCompanyBillFolder(name: string): Promise<{ ok: boolean; data?: CompanyBillFolder; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the folder a name." };
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from(FOLDERS)
    .insert({ name: trimmed, created_by: userData.user?.id ?? null })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  const folder = data as CompanyBillFolder;
  void logAudit({ action: "company_bill_folder.created", targetType: "company_bill_folder", targetId: folder.id, detail: { name: trimmed } });
  return { ok: true, data: { ...folder, billCount: 0 } };
}

export async function renameCompanyBillFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the folder a name." };
  const { error } = await supabase.from(FOLDERS).update({ name: trimmed, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "company_bill_folder.renamed", targetType: "company_bill_folder", targetId: id, detail: { to: trimmed } });
  return { ok: true };
}

export async function emptyCompanyBillFolder(id: string): Promise<{ ok: boolean; moved?: number; error?: string }> {
  const { data, error } = await supabase
    .from(DOCS)
    .update({ folder_id: null, updated_at: new Date().toISOString() })
    .eq("folder_id", id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  const moved = (data ?? []).length;
  void logAudit({ action: "company_bill_folder.emptied", targetType: "company_bill_folder", targetId: id, detail: { moved } });
  return { ok: true, moved };
}

export async function deleteCompanyBillFolder(id: string): Promise<{ ok: boolean; error?: string; documents?: number }> {
  // Count documents first.
  const { count, error: countError } = await supabase
    .from(DOCS)
    .select("id", { count: "exact", head: true })
    .eq("folder_id", id);
  if (countError) return { ok: false, error: countError.message };
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Folder is not empty.", documents: count ?? 0 };
  }
  const { error } = await supabase.from(FOLDERS).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "company_bill_folder.deleted", targetType: "company_bill_folder", targetId: id });
  return { ok: true };
}

/* ── Documents ────────────────────────────────────────────────────────── */

export interface DocQuery {
  folderId?: string | null; // undefined = all; null = unfiled
  unfiled?: boolean;
  search?: string;
  sort?: "newest" | "oldest" | "bill_date" | "name";
  page?: number;
  pageSize?: number;
}

export async function fetchCompanyBillDocuments(q: DocQuery = {}): Promise<{ rows: CompanyBillDocument[]; total: number }> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from(DOCS).select("*", { count: "exact" });

  if (q.unfiled) {
    query = query.is("folder_id", null);
  } else if (q.folderId !== undefined && q.folderId !== null) {
    query = query.eq("folder_id", q.folderId);
  }

  const needle = (q.search ?? "").trim();
  if (needle) {
    const safe = needle.replace(/[,()%*]/g, " ").trim();
    query = query.or(
      [
        `display_name.ilike.%${safe}%`,
        `original_filename.ilike.%${safe}%`,
        `supplier_name.ilike.%${safe}%`,
        `bill_number.ilike.%${safe}%`,
      ].join(",")
    );
  }

  switch (q.sort) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "bill_date":
      query = query.order("bill_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
      break;
    case "name":
      query = query.order("display_name", { ascending: true });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as CompanyBillDocument[], total: count ?? 0 };
}

export async function fetchCompanyBillDocument(id: string): Promise<CompanyBillDocument | null> {
  const { data, error } = await supabase.from(DOCS).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CompanyBillDocument) ?? null;
}

export async function updateCompanyBillDocument(id: string, patch: Partial<CompanyBillDocument>): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(DOCS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "company_bill_document.updated", targetType: "company_bill_document", targetId: id, detail: { fields: Object.keys(patch) } });
  return { ok: true };
}

export async function moveCompanyBillDocument(id: string, folderId: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(DOCS)
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "company_bill_document.moved", targetType: "company_bill_document", targetId: id, detail: { folder_id: folderId } });
  return { ok: true };
}

export async function deleteCompanyBillDocument(id: string): Promise<{ ok: boolean; error?: string; storageWarning?: string }> {
  const doc = await fetchCompanyBillDocument(id);
  if (!doc) return { ok: false, error: "Document not found." };

  const { error } = await supabase.from(DOCS).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Clean up storage object; report if it fails but row is already gone.
  let storageWarning: string | undefined;
  try {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    if (removeError) storageWarning = removeError.message;
  } catch (e) {
    storageWarning = e instanceof Error ? e.message : "Storage cleanup failed.";
  }
  void logAudit({ action: "company_bill_document.deleted", targetType: "company_bill_document", targetId: id });
  return { ok: true, storageWarning };
}

/* ── Upload ───────────────────────────────────────────────────────────── */

export interface UploadMetadata {
  displayName?: string;
  supplierName?: string | null;
  billNumber?: string | null;
  billDate?: string | null;
  amount?: number | null;
  notes?: string | null;
  folderId?: string | null;
}

export async function uploadCompanyBill(
  file: File,
  meta: UploadMetadata = {}
): Promise<{ ok: true; document: CompanyBillDocument } | { ok: false; error: string }> {
  const validation = validateCompanyBillFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };
  const mime = validation.mime;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? null;

  // Insert a row first to obtain the id (storage path is namespaced by id).
  const displayName = (meta.displayName ?? file.name).trim() || file.name;
  const { data: created, error: createError } = await supabase
    .from(DOCS)
    .insert({
      folder_id: meta.folderId ?? null,
      display_name: displayName,
      original_filename: file.name,
      storage_path: "", // placeholder
      content_type: mime,
      byte_size: file.size,
      supplier_name: meta.supplierName ?? null,
      bill_number: meta.billNumber ?? null,
      bill_date: meta.billDate ?? null,
      amount: meta.amount ?? null,
      notes: meta.notes ?? null,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (createError) return { ok: false, error: `Could not create record: ${createError.message}` };

  const doc = created as CompanyBillDocument;
  const path = storagePathFor(doc.id, file.name);

  // Upload file to storage.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: mime, upsert: false });

  if (uploadError) {
    // Clean up orphaned row.
    await supabase.from(DOCS).delete().eq("id", doc.id);
    return { ok: false, error: `Upload failed: ${uploadError.message}` };
  }

  // Update row with real storage path.
  const { data: updated, error: updateError } = await supabase
    .from(DOCS)
    .update({ storage_path: path, updated_at: new Date().toISOString() })
    .eq("id", doc.id)
    .select()
    .single();

  if (updateError) {
    // Clean up orphaned storage object + row.
    await supabase.storage.from(BUCKET).remove([path]);
    await supabase.from(DOCS).delete().eq("id", doc.id);
    return { ok: false, error: `Could not finalize record: ${updateError.message}` };
  }

  void logAudit({ action: "company_bill_document.uploaded", targetType: "company_bill_document", targetId: doc.id, detail: { filename: file.name, size: file.size } });
  return { ok: true, document: updated as CompanyBillDocument };
}

/* ── Replace file ─────────────────────────────────────────────────────── */

export async function replaceCompanyBillFile(
  id: string,
  file: File
): Promise<{ ok: boolean; error?: string }> {
  const validation = validateCompanyBillFile(file);
  if (!validation.ok) return { ok: false, error: validation.error };
  const mime = validation.mime;

  const doc = await fetchCompanyBillDocument(id);
  if (!doc) return { ok: false, error: "Document not found." };

  const newPath = storagePathFor(id, file.name);

  // Upload new file first.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(newPath, file, { contentType: mime, upsert: false });
  if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };

  // Update metadata row.
  const { error: updateError } = await supabase
    .from(DOCS)
    .update({
      storage_path: newPath,
      content_type: mime,
      byte_size: file.size,
      original_filename: file.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) {
    // Clean up new upload; keep old file intact.
    await supabase.storage.from(BUCKET).remove([newPath]);
    return { ok: false, error: `Could not update record: ${updateError.message}` };
  }

  // Delete old storage object (best effort).
  if (doc.storage_path && doc.storage_path !== newPath) {
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  }
  void logAudit({ action: "company_bill_document.file_replaced", targetType: "company_bill_document", targetId: id });
  return { ok: true };
}

/* ── Signed URL / download ────────────────────────────────────────────── */

export async function getCompanyBillSignedUrl(storagePath: string, ttlSeconds = 120): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Could not create signed URL.");
  return data.signedUrl;
}

export async function downloadCompanyBillBytes(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No data returned.");
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

/* ── Batch upload ─────────────────────────────────────────────────────── */

export interface BatchUploadResult {
  succeeded: string[];
  failed: { filename: string; error: string }[];
}

export async function uploadCompanyBillsBatch(
  files: File[],
  folderId: string | null,
  concurrency = 3,
  onProgress?: (done: number, total: number) => void
): Promise<BatchUploadResult> {
  const result: BatchUploadResult = { succeeded: [], failed: [] };
  const total = files.length;
  let done = 0;
  onProgress?.(0, total);

  // Simple bounded concurrency.
  const queue = [...files];
  const workers: Promise<void>[] = [];
  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift()!;
      const res = await uploadCompanyBill(file, { folderId });
      if (res.ok) result.succeeded.push(file.name);
      else result.failed.push({ filename: file.name, error: res.error });
      done++;
      onProgress?.(done, total);
    }
  }
  for (let i = 0; i < Math.min(concurrency, files.length); i++) workers.push(worker());
  await Promise.all(workers);
  return result;
}

/* ── ZIP ──────────────────────────────────────────────────────────────── */

export async function downloadCompanyBillsZip(docs: CompanyBillDocument[]): Promise<{ ok: boolean; error?: string }> {
  if (docs.length === 0) return { ok: false, error: "No documents selected." };
  try {
    const { buildCompanyBillZip } = await import("./companyBillZip");
    const { planCompanyBillZip } = await import("./companyBillFiles");
    const plan = planCompanyBillZip(docs);
    const outcome = await buildCompanyBillZip(plan, async (path: string) => downloadCompanyBillBytes(path));
    // Trigger browser download.
    const blob = new Blob([outcome.bytes as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = plan.archiveName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ZIP download failed." };
  }
}
