import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import type { DrawingUploadFolder, DrawingUploadDocument } from "../types/drawingUpload";
import type { CompanyBillDocument } from "../types/companyBill";
import { storagePathFor, validateCompanyBillFile as validateFile } from "./companyBillFiles";

// Re-export helpers under drawing names for convenience.
export {
  storagePathFor,
  validateFile as validateDrawingUploadFile,
};


const FOLDERS = "drawing_upload_folders";
const DOCS = "drawing_upload_documents";
const BUCKET = "drawing-uploads";

export async function fetchDrawingUploadFolders(): Promise<DrawingUploadFolder[]> {
  const { data: folderRows, error } = await supabase.from(FOLDERS).select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const folders = (folderRows ?? []) as DrawingUploadFolder[];
  if (folders.length === 0) return folders;
  const { data: docRows, error: docError } = await supabase.from(DOCS).select("folder_id");
  if (docError) throw new Error(docError.message);
  const counts = new Map<string, number>();
  for (const r of (docRows ?? []) as { folder_id: string | null }[]) {
    if (r.folder_id) counts.set(r.folder_id, (counts.get(r.folder_id) ?? 0) + 1);
  }
  for (const f of folders) f.documentCount = counts.get(f.id) ?? 0;
  return folders;
}

export async function createDrawingUploadFolder(name: string): Promise<{ ok: boolean; data?: DrawingUploadFolder; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the folder a name." };
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase.from(FOLDERS).insert({ name: trimmed, created_by: userData.user?.id ?? null }).select().single();
  if (error) return { ok: false, error: error.message };
  const folder = data as DrawingUploadFolder;
  void logAudit({ action: "drawing_upload_folder.created", targetType: "drawing_upload_folder", targetId: folder.id, detail: { name: trimmed } });
  return { ok: true, data: { ...folder, documentCount: 0 } };
}

export async function renameDrawingUploadFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the folder a name." };
  const { error } = await supabase.from(FOLDERS).update({ name: trimmed, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "drawing_upload_folder.renamed", targetType: "drawing_upload_folder", targetId: id, detail: { to: trimmed } });
  return { ok: true };
}

export async function emptyDrawingUploadFolder(id: string): Promise<{ ok: boolean; moved?: number; error?: string }> {
  const { data, error } = await supabase.from(DOCS).update({ folder_id: null, updated_at: new Date().toISOString() }).eq("folder_id", id).select("id");
  if (error) return { ok: false, error: error.message };
  const moved = (data ?? []).length;
  void logAudit({ action: "drawing_upload_folder.emptied", targetType: "drawing_upload_folder", targetId: id, detail: { moved } });
  return { ok: true, moved };
}

export async function deleteDrawingUploadFolder(id: string): Promise<{ ok: boolean; error?: string; documents?: number }> {
  const { count, error: countError } = await supabase.from(DOCS).select("id", { count: "exact", head: true }).eq("folder_id", id);
  if (countError) return { ok: false, error: countError.message };
  if ((count ?? 0) > 0) return { ok: false, error: "Folder is not empty.", documents: count ?? 0 };
  const { error } = await supabase.from(FOLDERS).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "drawing_upload_folder.deleted", targetType: "drawing_upload_folder", targetId: id });
  return { ok: true };
}

export interface DocQuery { folderId?: string | null; unfiled?: boolean; search?: string; sort?: "newest" | "oldest" | "name"; page?: number; pageSize?: number; }

export async function fetchDrawingUploadDocuments(q: DocQuery = {}): Promise<{ rows: DrawingUploadDocument[]; total: number }> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let query = supabase.from(DOCS).select("*", { count: "exact" });
  if (q.unfiled) query = query.is("folder_id", null);
  else if (q.folderId !== undefined && q.folderId !== null) query = query.eq("folder_id", q.folderId);
  const needle = (q.search ?? "").trim();
  if (needle) {
    const safe = needle.replace(/[,()%*]/g, " ").trim();
    query = query.or([`display_name.ilike.%${safe}%`, `original_filename.ilike.%${safe}%`, `drawing_number.ilike.%${safe}%`, `notes.ilike.%${safe}%`].join(","));
  }
  if (q.sort === "oldest") query = query.order("created_at", { ascending: true });
  else if (q.sort === "name") query = query.order("display_name", { ascending: true });
  else query = query.order("created_at", { ascending: false });
  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as DrawingUploadDocument[], total: count ?? 0 };
}

export async function updateDrawingUploadDocument(id: string, patch: Partial<DrawingUploadDocument>): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(DOCS).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "drawing_upload_document.updated", targetType: "drawing_upload_document", targetId: id });
  return { ok: true };
}

export async function moveDrawingUploadDocument(id: string, folderId: string | null): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(DOCS).update({ folder_id: folderId, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDrawingUploadDocument(id: string): Promise<{ ok: boolean; error?: string; storageWarning?: string }> {
  const { data: doc, error: readError } = await supabase.from(DOCS).select("*").eq("id", id).single();
  if (readError || !doc) return { ok: false, error: readError?.message ?? "Document not found." };
  const d = doc as DrawingUploadDocument;
  const { error: dbError } = await supabase.from(DOCS).delete().eq("id", id);
  if (dbError) return { ok: false, error: dbError.message };
  // cleanup storage
  let storageWarning: string | undefined;
  try {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([d.storage_path]);
    if (removeError) {
      storageWarning = removeError.message || "Storage cleanup failed.";
    }
  } catch (e) {
    storageWarning = e instanceof Error ? e.message : "Storage cleanup failed.";
  }
  void logAudit({ action: "drawing_upload_document.deleted", targetType: "drawing_upload_document", targetId: id });
  return { ok: true, storageWarning };
}

export async function replaceDrawingUploadFile(id: string, file: File): Promise<{ ok: boolean; error?: string }> {
  const { data: doc, error: readError } = await supabase.from(DOCS).select("*").eq("id", id).single();
  if (readError || !doc) return { ok: false, error: readError?.message ?? "Document not found." };
  const d = doc as DrawingUploadDocument;
  const v = validateFile(file);
  if (!v.ok) return { ok: false, error: v.error };
  const newPath = storagePathFor(d.id, file.name);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(newPath, file, { upsert: true, contentType: v.mime });
  if (uploadError) return { ok: false, error: uploadError.message };
  const { error: updateError } = await supabase.from(DOCS).update({
    original_filename: file.name,
    storage_path: newPath,
    content_type: v.mime,
    byte_size: file.size,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (updateError) return { ok: false, error: updateError.message };
  if (d.storage_path && d.storage_path !== newPath) {
    try { await supabase.storage.from(BUCKET).remove([d.storage_path]); } catch { /* ignore */ }
  }
  void logAudit({ action: "drawing_upload_document.replaced", targetType: "drawing_upload_document", targetId: id });
  return { ok: true };
}

export async function uploadDrawingUploadsBatch(files: File[], folderId: string | null, concurrency = 3, onProgress?: (done: number, total: number) => void): Promise<{ succeeded: string[]; failed: { filename: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { filename: string; error: string }[] = [];
  let done = 0;
  const total = files.length;
  const { data: userData } = await supabase.auth.getUser();
  const worker = async (file: File) => {
    const v = validateFile(file);
    if (!v.ok) { failed.push({ filename: file.name, error: v.error }); done++; onProgress?.(done, total); return; }
    const id = crypto.randomUUID();
    const path = storagePathFor(id, file.name);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: v.mime });
    if (upErr) { failed.push({ filename: file.name, error: upErr.message }); done++; onProgress?.(done, total); return; }
    const { error: dbErr } = await supabase.from(DOCS).insert({
      id,
      folder_id: folderId,
      display_name: file.name.replace(/\.[^.]+$/, ""),
      original_filename: file.name,
      storage_path: path,
      content_type: v.mime,
      byte_size: file.size,
      uploaded_by: userData.user?.id ?? null,
    });
    if (dbErr) {
      // cleanup storage
      try { await supabase.storage.from(BUCKET).remove([path]); } catch { /* ignore */ }
      failed.push({ filename: file.name, error: dbErr.message });
    } else {
      succeeded.push(file.name);
    }
    done++;
    onProgress?.(done, total);
  };
  // concurrency pool
  const queue = [...files];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const f = queue.shift();
      if (f) await worker(f);
    }
  });
  await Promise.all(runners);
  void logAudit({ action: "drawing_upload_documents.uploaded", targetType: "drawing_upload_document", detail: { count: succeeded.length } });
  return { succeeded, failed };
}

export async function getDrawingUploadSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not create signed URL.");
  return data.signedUrl;
}

export async function downloadDrawingUploadBytes(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Download failed.");
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

export async function downloadDrawingUploadsZip(docs: DrawingUploadDocument[]): Promise<{ ok: boolean; error?: string }> {
  if (docs.length === 0) return { ok: false, error: "No documents selected." };
  try {
    const { buildCompanyBillZip } = await import("./companyBillZip");
    const { planCompanyBillZip } = await import("./companyBillFiles");
    const mapped = docs.map((d) => ({
      id: d.id,
      display_name: d.display_name,
      original_filename: d.original_filename,
      storage_path: d.storage_path,
      content_type: d.content_type,
      byte_size: d.byte_size,
      created_at: d.created_at,
      folder_id: d.folder_id,
      supplier_name: null,
      bill_number: d.drawing_number,
      bill_date: null,
      amount: null,
      notes: d.notes,
      uploaded_by: d.uploaded_by,
      updated_at: d.updated_at,
    })) as CompanyBillDocument[];
    const plan = planCompanyBillZip(mapped);
    // rename archive
    plan.archiveName = plan.archiveName.replace("company_bills", "drawing_uploads");
    const outcome = await buildCompanyBillZip(plan, async (path: string) => downloadDrawingUploadBytes(path));
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
