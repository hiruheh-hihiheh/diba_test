import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  FolderPlus,
  Loader2,
  RefreshCw,
  SearchX,
  Trash2,
  UploadCloud,
  FileText,
  Pencil,
  Eye,
  Download,
  FolderOpen,
  X,
  FileArchive,
} from "lucide-react";
import {
  fetchCompanyBillFolders,
  createCompanyBillFolder,
  renameCompanyBillFolder,
  emptyCompanyBillFolder,
  deleteCompanyBillFolder,
  fetchCompanyBillDocuments,
  updateCompanyBillDocument,
  moveCompanyBillDocument,
  deleteCompanyBillDocument,
  replaceCompanyBillFile,
  uploadCompanyBillsBatch,
  getCompanyBillSignedUrl,
  downloadCompanyBillBytes,
  downloadCompanyBillsZip,
} from "../services/companyBills";
import type { CompanyBillFolder, CompanyBillDocument } from "../types/companyBill";
import { isPreviewable, previewKind, getFormatLabel, formatBytes, validateCompanyBillFile } from "../services/companyBillFiles";
import { usePageMeta } from "../hooks/usePageMeta";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { useSelection } from "../hooks/useSelection";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import Pagination from "../components/ui/Pagination";
import SelectAllCheckbox from "../components/ui/SelectAllCheckbox";

const PAGE_SIZE = 25;

export default function CompanyBillsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const selection = useSelection();

  const [folders, setFolders] = useState<CompanyBillFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState<string | null>(null);


  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [view, setView] = useState<"folders" | "all" | "unfiled">("folders");

  const [docs, setDocs] = useState<CompanyBillDocument[]>([]);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "bill_date" | "name">("newest");
  const [page, setPage] = useState(1);

  const [refreshing, setRefreshing] = useState(false);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [gstDrafts, setGstDrafts] = useState<Record<string, string>>({});
  const [savingField, setSavingField] = useState<{ id: string; field: "amount" | "gst" | "paid" } | null>(null);

  // Modals
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<CompanyBillDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");

  const [editDoc, setEditDoc] = useState<CompanyBillDocument | null>(null);
  const [editForm, setEditForm] = useState<Partial<CompanyBillDocument>>({});

  const [moveDocIds, setMoveDocIds] = useState<string[] | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFolder = useMemo(() => folders.find((f) => f.id === selectedFolderId) ?? null, [folders, selectedFolderId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const a: Record<string, string> = {};
      const g: Record<string, string> = {};
      for (const d of docs) {
        a[d.id] = d.amount == null ? "" : String(d.amount);
        g[d.id] = d.gst_amount == null ? "" : String(d.gst_amount);
      }
      setAmountDrafts(a);
      setGstDrafts(g);
    }, 0);
    return () => clearTimeout(timer);
  }, [docs]);

  usePageMeta(
    { title: "Company Bills", crumbs: [{ label: "Company Bills" }], subtitle: `${folders.length} folders · ${docsTotal || docs.length} documents`, selfTitles: true },
    [folders.length, docs.length, docsTotal]
  );

  const loadFolders = useCallback(async () => {
    try {
      const list = await fetchCompanyBillFolders();
      setFolders(list);
      setFoldersError(null);
    } catch (e) {
      setFoldersError(e instanceof Error ? e.message : "Could not load folders.");
    }
  }, []);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const unfiled = view === "unfiled";
      const folderId = view === "folders" && selectedFolderId ? selectedFolderId : undefined;
      // If view is "all", folderId undefined and unfiled false => all
      const q: { search: string; sort: "newest" | "oldest" | "bill_date" | "name"; page: number; pageSize: number; unfiled?: boolean; folderId?: string } = { search, sort, page, pageSize: PAGE_SIZE };
      if (unfiled) q.unfiled = true;
      else if (folderId) q.folderId = folderId;
      const res = await fetchCompanyBillDocuments(q);
      setDocs(res.rows);
      setDocsTotal(res.total);
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : "Could not load documents.");
    } finally {
      setDocsLoading(false);
    }
  }, [view, selectedFolderId, search, sort, page]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      loadFolders().then(() => { if (!cancelled) setFoldersLoading(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadFolders]);

  useEffect(() => {
    if (view === "folders" && !selectedFolderId) return; // folder grid shown, no docs
    const timer = setTimeout(() => { loadDocs(); }, 0);
    return () => clearTimeout(timer);
  }, [loadDocs, view, selectedFolderId]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadFolders();
    if (view !== "folders" || selectedFolderId) await loadDocs();
    setRefreshing(false);
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const res = await createCompanyBillFolder(name);
      if (!res.ok) { toast.error({ title: "Folder not created", description: res.error }); return; }
      setNewFolderName("");
      setCreateFolderOpen(false);
      toast.success({ title: "Folder created", description: `${name} is ready.` });
      await loadFolders();
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleRenameFolder(id: string) {
    const name = renameFolderName.trim();
    if (!name) return;
    const res = await renameCompanyBillFolder(id, name);
    if (!res.ok) { toast.error({ title: "Rename failed", description: res.error }); return; }
    setRenameFolderId(null);
    toast.success({ title: "Folder renamed" });
    await loadFolders();
  }

  async function handleDeleteFolder(folder: CompanyBillFolder) {
    const count = folder.billCount ?? 0;
    const msg = count > 0
      ? `Delete "${folder.name}"? It contains ${count} document(s). They will be moved to Unfiled first.`
      : `Delete "${folder.name}"? The folder is empty.`;
    const ok = await confirm({ title: "Delete folder", message: msg, confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    if (count > 0) {
      const emptyRes = await emptyCompanyBillFolder(folder.id);
      if (!emptyRes.ok) { toast.error({ title: "Could not empty folder", description: emptyRes.error }); return; }
    }
    const res = await deleteCompanyBillFolder(folder.id);
    if (!res.ok) { toast.error({ title: "Delete failed", description: res.error }); return; }
    toast.success({ title: "Folder deleted" });
    if (selectedFolderId === folder.id) setSelectedFolderId(null);
    await loadFolders();
    if (view !== "folders" || selectedFolderId) await loadDocs();
  }

  async function handleUpload() {
    if (uploadFiles.length === 0 || uploading) return;
    // validate
    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of uploadFiles) {
      const v = validateCompanyBillFile(f);
      if (v.ok) valid.push(f);
      else rejected.push(v.error);
    }
    if (rejected.length > 0) {
      toast.warning({ title: "Some files rejected", description: rejected.join(" ") });
    }
    if (valid.length === 0) return;

    setUploading(true);
    setUploadProgress({ done: 0, total: valid.length });
    try {
      const res = await uploadCompanyBillsBatch(valid, uploadFolderId, 3, (done, total) => setUploadProgress({ done, total }));
      if (res.failed.length > 0) {
        toast.error({ title: `${res.failed.length} file(s) failed`, description: res.failed.map((f) => f.filename).join(", ") });
      }
      if (res.succeeded.length > 0) {
        toast.success({ title: `${res.succeeded.length} uploaded`, description: res.succeeded.join(", ") });
      }
      setUploadFiles([]);
      setUploadOpen(false);
      await loadFolders();
      if (view !== "folders" || selectedFolderId) await loadDocs();
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handlePreview(doc: CompanyBillDocument) {
    const kind = previewKind(doc.content_type, doc.original_filename);
    if (kind === "none") {
      toast.info({ title: "Preview not available", description: "This file format cannot be previewed in the browser. Download it to open with a compatible application." });
      return;
    }
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPreviewText(null);
    // Fetch signed URL for pdf/image preview.
    if (kind === "pdf" || kind === "image") {
      setPreviewLoading(true);
      try {
        const url = await getCompanyBillSignedUrl(doc.storage_path);
        setPreviewUrl(url);
      } catch (e) {
        toast.error({ title: "Preview failed", description: e instanceof Error ? e.message : "Unknown error" });
        setPreviewDoc(null);
      } finally {
        setPreviewLoading(false);
      }
    }
    if (kind === "text") {
      setPreviewLoading(true);
      try {
        const bytes = await downloadCompanyBillBytes(doc.storage_path);
        const text = new TextDecoder().decode(bytes);
        setPreviewText(text.slice(0, 200000));
      } catch (e) {
        toast.error({ title: "Preview failed", description: e instanceof Error ? e.message : "Unknown error" });
        setPreviewDoc(null);
      } finally {
        setPreviewLoading(false);
      }
    }
  }

  async function handleDownload(doc: CompanyBillDocument) {
    try {
      const bytes = await downloadCompanyBillBytes(doc.storage_path);
      const blob = new Blob([bytes as BlobPart], { type: doc.content_type || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.original_filename || doc.display_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error({ title: "Download failed", description: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  async function handleDeleteDoc(doc: CompanyBillDocument) {
    const ok = await confirm({ title: "Delete document", message: `Permanently delete "${doc.display_name}"? This cannot be undone.`, confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    const res = await deleteCompanyBillDocument(doc.id);
    if (!res.ok) { toast.error({ title: "Delete failed", description: res.error }); return; }
    if (res.storageWarning) toast.warning({ title: "Storage cleanup warning", description: res.storageWarning });
    else toast.success({ title: "Document deleted" });
    selection.clear();
    await loadFolders();
    await loadDocs();
  }

  async function handleRemoveFromFolder(doc: CompanyBillDocument) {
    const res = await moveCompanyBillDocument(doc.id, null);
    if (!res.ok) { toast.error({ title: "Failed", description: res.error }); return; }
    toast.success({ title: "Removed from folder", description: "Document is now Unfiled." });
    await loadFolders();
    await loadDocs();
  }

  async function handleMoveDocs() {
    if (!moveDocIds || moveDocIds.length === 0) return;
    const target = moveTargetFolderId;
    let failed = 0;
    for (const id of moveDocIds) {
      const res = await moveCompanyBillDocument(id, target);
      if (!res.ok) failed++;
    }
    if (failed > 0) toast.error({ title: "Some moves failed", description: `${failed} of ${moveDocIds.length} failed.` });
    else toast.success({ title: "Moved", description: `${moveDocIds.length} document(s) moved.` });
    setMoveDocIds(null);
    setMoveTargetFolderId(null);
    selection.clear();
    await loadFolders();
    await loadDocs();
  }

  async function handleReplaceFile(doc: CompanyBillDocument, file: File) {
    const ok = await confirm({ title: "Replace file", message: `Replace the file for "${doc.display_name}" with "${file.name}"?`, confirmLabel: "Replace" });
    if (!ok) return;
    const res = await replaceCompanyBillFile(doc.id, file);
    if (!res.ok) { toast.error({ title: "Replace failed", description: res.error }); return; }
    toast.success({ title: "File replaced" });
    await loadDocs();
  }

  async function handleSaveEdit() {
    if (!editDoc) return;
    const patch: Partial<CompanyBillDocument> = {
      display_name: editForm.display_name ?? editDoc.display_name,
      supplier_name: editForm.supplier_name ?? null,
      bill_number: editForm.bill_number ?? null,
      bill_date: editForm.bill_date ?? null,
      amount: editForm.amount ?? null,
      gst_amount: editForm.gst_amount ?? null,
      is_paid: editForm.is_paid ?? false,
      notes: editForm.notes ?? null,
      folder_id: editForm.folder_id ?? editDoc.folder_id,
    };
    const res = await updateCompanyBillDocument(editDoc.id, patch);
    if (!res.ok) { toast.error({ title: "Save failed", description: res.error }); return; }
    toast.success({ title: "Document updated" });
    setEditDoc(null);
    await loadFolders();
    await loadDocs();
  }

  async function saveAmount(doc: CompanyBillDocument, raw: string) {
    const trimmed = raw.trim();
    const current = doc.amount == null ? "" : String(doc.amount);
    if (trimmed === current) return;
    if (trimmed !== "" && (isNaN(Number(trimmed)) || Number(trimmed) < 0)) {
      toast.error({ title: "Invalid amount", description: "Enter a non-negative number." });
      setAmountDrafts((p) => ({ ...p, [doc.id]: current }));
      return;
    }
    const value = trimmed === "" ? null : Number(trimmed);
    setSavingField({ id: doc.id, field: "amount" });
    const res = await updateCompanyBillDocument(doc.id, { amount: value });
    setSavingField(null);
    if (!res.ok) {
      toast.error({ title: "Save failed", description: res.error });
      setAmountDrafts((p) => ({ ...p, [doc.id]: current }));
    } else {
      await loadDocs();
    }
  }

  async function saveGst(doc: CompanyBillDocument, raw: string) {
    const trimmed = raw.trim();
    const current = doc.gst_amount == null ? "" : String(doc.gst_amount);
    if (trimmed === current) return;
    if (trimmed !== "" && (isNaN(Number(trimmed)) || Number(trimmed) < 0)) {
      toast.error({ title: "Invalid GST", description: "Enter a non-negative number." });
      setGstDrafts((p) => ({ ...p, [doc.id]: current }));
      return;
    }
    const value = trimmed === "" ? null : Number(trimmed);
    setSavingField({ id: doc.id, field: "gst" });
    const res = await updateCompanyBillDocument(doc.id, { gst_amount: value });
    setSavingField(null);
    if (!res.ok) {
      toast.error({ title: "Save failed", description: res.error });
      setGstDrafts((p) => ({ ...p, [doc.id]: current }));
    } else {
      await loadDocs();
    }
  }

  async function savePaid(doc: CompanyBillDocument, value: boolean) {
    if (value === doc.is_paid) return;
    setSavingField({ id: doc.id, field: "paid" });
    const res = await updateCompanyBillDocument(doc.id, { is_paid: value });
    setSavingField(null);
    if (!res.ok) {
      toast.error({ title: "Save failed", description: res.error });
    } else {
      await loadDocs();
    }
  }

  async function handleZipSelected() {
    const selectedIds = [...selection.selected];
    const selectedDocs = docs.filter((d) => selectedIds.includes(d.id));
    // Also include across pages? For simplicity use loaded docs only.
    if (selectedDocs.length === 0) { toast.info({ title: "No documents selected" }); return; }
    const res = await downloadCompanyBillsZip(selectedDocs);
    if (!res.ok) toast.error({ title: "ZIP failed", description: res.error });
    else toast.success({ title: "ZIP downloaded" });
  }

  // Reset page on search/sort/view change


  const showDocs = view !== "folders" || !!selectedFolderId;

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Header — the TopBar owns the page name, so this states what the screen
          holds and where it differs from customer Bills. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-[10px] border border-info/25 bg-info-muted flex items-center justify-center shrink-0">
            <Building2 size={19} className="text-info" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text">
              Uploaded supplier and expense documents
            </p>
            <p className="text-[12.5px] text-text-muted mt-0.5 truncate">
              Kept separate from the customer invoices generated under Bills.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleRefresh} disabled={refreshing} className="btn btn-secondary">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button onClick={() => { setUploadFolderId(selectedFolderId); setUploadOpen(true); }} className="btn btn-primary">
            <UploadCloud size={16} /> Upload documents
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div className="segmented" role="group" aria-label="Company bill view">
        {(["folders", "all", "unfiled"] as const).map((v) => (
          <button
            key={v}
            onClick={() => { setView(v); setSelectedFolderId(null); setPage(1); }}
            aria-pressed={view === v}
            className="seg-item"
          >
            {v === "folders" ? "Folders" : v === "all" ? "All documents" : "Unfiled"}
          </button>
        ))}
      </div>

      {foldersError && <ErrorState message={foldersError} onRetry={loadFolders} title="Could not load folders" />}

      {/* Folder grid */}
      {view === "folders" && !selectedFolderId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <SearchInput value={search} onChange={setSearch} scope="folders" resultCount={folders.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())).length} totalCount={folders.length} placeholder="Search folders…" className="max-w-md" />
            <button onClick={() => setCreateFolderOpen(true)} className="btn btn-secondary">
              <FolderPlus size={15} /> New folder
            </button>
          </div>
          {foldersLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={32} className="text-primary animate-spin" /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
              {folders.filter((f) => !search.trim() || f.name.toLowerCase().includes(search.toLowerCase())).map((folder) => (
                <div key={folder.id} className="bg-surface border border-border rounded-2xl p-5 flex flex-col hover:border-border-hover transition-all">
                  <div className="flex items-start justify-between mb-4">
                    <button onClick={() => { setSelectedFolderId(folder.id); setView("folders"); setPage(1); }} className="w-10 h-10 rounded-[10px] border border-primary/25 bg-primary-muted flex items-center justify-center shrink-0 hover:bg-primary/20 transition-colors cursor-pointer">
                      <FolderOpen size={24} className="text-primary" />
                    </button>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setRenameFolderId(folder.id); setRenameFolderName(folder.name); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer" title="Rename">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDeleteFolder(folder)} className="w-8 h-8 rounded-lg flex items-center justify-center text-danger hover:bg-danger-muted transition-colors cursor-pointer" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-text mb-1.5 truncate" title={folder.name}>{folder.name}</h3>
                    <p className="text-[13px] text-text-muted font-medium">
                      <span className="px-2 py-0.5 rounded-md bg-surface-hover text-text">{folder.billCount ?? 0} document{(folder.billCount ?? 0) === 1 ? "" : "s"}</span>
                    </p>
                  </div>
                  <button onClick={() => { setSelectedFolderId(folder.id); setPage(1); }} className="mt-4 w-full h-9 rounded-lg bg-surface-hover/60 hover:bg-primary hover:text-[var(--theme-primary-text)] text-[12.5px] font-semibold text-text transition-colors flex items-center justify-center gap-2 cursor-pointer">
                    Open folder <FolderOpen size={14} />
                  </button>
                </div>
              ))}
              {folders.length === 0 && !foldersLoading && (
                <div className="col-span-full">
                  <EmptyState icon={<SearchX size={26} />} title="No folders yet" description="Create a folder to organize your company bills." action={<button onClick={() => setCreateFolderOpen(true)} className="btn btn-primary">Create your first folder</button>} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Document list (folder detail / all / unfiled) */}
      {showDocs && (
        <div className="space-y-4">
          {selectedFolder && (
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedFolderId(null)} className="text-sm font-bold text-primary hover:underline cursor-pointer">← All folders</button>
              <h2 className="text-lg font-bold text-text">{selectedFolder.name}</h2>
              <span className="text-sm text-text-muted">{selectedFolder.billCount ?? 0} documents</span>
            </div>
          )}
          <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
            <SearchInput value={search} onChange={(v: string) => { setSearch(v); setPage(1); }} scope="documents" resultCount={docs.length} totalCount={docsTotal} placeholder="Search by name, supplier, bill number…" className="flex-1 lg:max-w-md" />
            <select value={sort} onChange={(e) => { setSort(e.target.value as "newest" | "oldest" | "bill_date" | "name"); setPage(1); }} className="h-9 rounded-[9px] border border-border bg-surface px-2.5 text-[12.5px] text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary">
              <option value="newest">Newest uploads</option>
              <option value="oldest">Oldest uploads</option>
              <option value="bill_date">Bill date</option>
              <option value="name">Name</option>
            </select>
            {selection.count > 0 && (
              <div className="flex items-center gap-2">
                <button onClick={handleZipSelected} className="btn btn-secondary">
                  <FileArchive size={15} /> ZIP ({selection.count})
                </button>
                <button onClick={() => { setMoveDocIds([...selection.selected]); setMoveTargetFolderId(null); }} className="btn btn-primary">
                  Move ({selection.count})
                </button>
              </div>
            )}
          </div>

          <InlineRefreshBar show={refreshing} />

          {docsError && <ErrorState message={docsError} onRetry={loadDocs} title="Could not load documents" />}

          {!docsError && (
            <>
              {docs.length > 0 && (
                <div className="flex items-center gap-3">
                  <SelectAllCheckbox ids={docs.map((d) => d.id)} selection={selection} label="Select all on page" />
                </div>
              )}
              <div className="panel-flat">
                <div className="overflow-auto scrollbar-thin">
                  <table className="data-table w-full min-w-[40rem]">
                    <thead className="sticky-head">
                      <tr className="border-b border-border">
                        <th className="w-9" />
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Document</th>
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Supplier / Bill #</th>
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Bill date</th>
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Amount</th>
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">GST</th>
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Paid / Not Paid</th>
                        <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Size</th>
                        <th className="text-right text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {docs.map((doc) => {
                        const isSelected = selection.isSelected(doc.id);
                        return (
                          <tr key={doc.id} className={`hover:bg-surface-hover/30 transition-colors ${isSelected ? "bg-primary-muted/20" : ""}`}>
                            <td className="px-2 py-3">
                              <input type="checkbox" checked={isSelected} onChange={() => selection.toggle(doc.id)} className="accent-[var(--theme-primary)] cursor-pointer" />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-lg bg-bg border border-border flex items-center justify-center shrink-0">
                                  <FileText size={16} className="text-text-muted" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-text break-words" title={doc.original_filename}>{doc.display_name}</p>
                                  <p className="text-[11px] text-text-muted break-words" title={doc.original_filename}>{doc.original_filename}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="px-1.5 py-0.5 rounded bg-surface-hover text-[10px] font-bold text-text">{getFormatLabel(doc.original_filename, doc.content_type)}</span>
                                    <span className="text-[10px] text-text-muted">{formatBytes(doc.byte_size)}</span>
                                    <span className="text-[10px] text-text-muted">{new Date(doc.created_at).toLocaleDateString()}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p className="text-sm text-text truncate">{doc.supplier_name || "—"}</p>
                              <p className="text-[11px] text-text-muted truncate">{doc.bill_number || ""}</p>
                            </td>
                            <td className="px-4 py-3 text-sm text-text-muted">{doc.bill_date || "—"}</td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={amountDrafts[doc.id] ?? ""}
                                onChange={(e) => setAmountDrafts((p) => ({ ...p, [doc.id]: e.target.value }))}
                                onBlur={(e) => saveAmount(doc, e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setAmountDrafts((p) => ({ ...p, [doc.id]: doc.amount == null ? "" : String(doc.amount) })); (e.target as HTMLInputElement).blur(); } }}
                                disabled={savingField?.id === doc.id && savingField.field === "amount"}
                                className="w-24 px-2 py-1 rounded-lg bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={gstDrafts[doc.id] ?? ""}
                                onChange={(e) => setGstDrafts((p) => ({ ...p, [doc.id]: e.target.value }))}
                                onBlur={(e) => saveGst(doc, e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setGstDrafts((p) => ({ ...p, [doc.id]: doc.gst_amount == null ? "" : String(doc.gst_amount) })); (e.target as HTMLInputElement).blur(); } }}
                                disabled={savingField?.id === doc.id && savingField.field === "gst"}
                                className="w-24 px-2 py-1 rounded-lg bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={doc.is_paid ? "paid" : "notpaid"}
                                onChange={(e) => savePaid(doc, e.target.value === "paid")}
                                disabled={savingField?.id === doc.id && savingField.field === "paid"}
                                className={`px-2 py-1 rounded-lg border text-xs font-bold cursor-pointer ${doc.is_paid ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}`}
                              >
                                <option value="notpaid">Not Paid</option>
                                <option value="paid">Paid</option>
                              </select>
                            </td>
                            <td className="px-4 py-3 text-sm text-text-muted">{formatBytes(doc.byte_size)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                {isPreviewable(doc.content_type, doc.original_filename) && (
                                  <button onClick={() => handlePreview(doc)} title="Preview" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                                    <Eye size={15} />
                                  </button>
                                )}
                                <button onClick={() => handleDownload(doc)} title="Download" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                                  <Download size={15} />
                                </button>
                                <button onClick={() => { setEditDoc(doc); setEditForm({ ...doc }); }} title="Edit" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                                  <Pencil size={15} />
                                </button>
                                <button onClick={() => { setMoveDocIds([doc.id]); setMoveTargetFolderId(doc.folder_id); }} title="Move" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                                  <FolderOpen size={15} />
                                </button>
                                {doc.folder_id && (
                                  <button onClick={() => handleRemoveFromFolder(doc)} title="Remove from folder" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                                    <X size={15} />
                                  </button>
                                )}
                                <button onClick={() => handleDeleteDoc(doc)} title="Delete" className="w-8 h-8 rounded-lg flex items-center justify-center text-danger hover:bg-danger-muted transition-colors cursor-pointer">
                                  <Trash2 size={15} />
                                </button>
                                <label title="Replace file" className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
                                  <Pencil size={13} />
                                  <input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReplaceFile(doc, f); e.target.value = ""; }} />
                                </label>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {docsTotal > PAGE_SIZE && (
                  <div className="px-4 py-3 border-t border-border">
                    <Pagination page={page} pageSize={PAGE_SIZE} setPage={setPage} setPageSize={() => {}} totalItems={docsTotal} totalPages={Math.max(1, Math.ceil(docsTotal / PAGE_SIZE))} itemLabel="documents" />
                  </div>
                )}
              </div>

              {docsLoading && docs.length === 0 && (
                <div className="flex items-center justify-center py-20"><Loader2 size={24} className="text-primary animate-spin" /></div>
              )}
              {!docsLoading && docs.length === 0 && (
                <EmptyState icon={<SearchX size={26} />} title={search.trim() ? "No documents match" : "No documents yet"} description={search.trim() ? "Try a different search." : "Upload company bills to get started."} />
              )}
            </>
          )}
        </div>
      )}

      {/* Upload modal */}
      <Modal open={uploadOpen} onClose={() => !uploading && setUploadOpen(false)} title="Upload Company Bills" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1.5">Folder (optional)</label>
            <select value={uploadFolderId ?? ""} onChange={(e) => setUploadFolderId(e.target.value || null)} className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Unfiled</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.doc,.docx,.rtf,.txt,.odt,.xls,.xlsx,.csv,.ods,.ppt,.pptx,.odp" className="block w-full text-sm text-text file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-primary file:text-white file:font-bold file:cursor-pointer" onChange={(e) => { const fs = Array.from(e.target.files ?? []); setUploadFiles(fs); }} />
            {uploadFiles.length > 0 && (
              <p className="text-xs text-text-muted mt-2">{uploadFiles.length} file(s) selected</p>
            )}
          </div>
          {uploadProgress && (
            <div className="text-sm text-text-muted">Uploading {uploadProgress.done} / {uploadProgress.total}…</div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button onClick={() => { if (!uploading) { setUploadOpen(false); setUploadFiles([]); } }} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">Cancel</button>
            <button onClick={handleUpload} disabled={uploading || uploadFiles.length === 0} className="btn btn-primary">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create folder modal */}
      <Modal open={createFolderOpen} onClose={() => setCreateFolderOpen(false)} title="New Folder" size="sm">
        <div className="space-y-3">
          <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name" className="w-full px-4 py-3 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }} />
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setCreateFolderOpen(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">Cancel</button>
            <button onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()} className="btn btn-primary">{creatingFolder ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </Modal>

      {/* Rename folder modal */}
      <Modal open={!!renameFolderId} onClose={() => setRenameFolderId(null)} title="Rename Folder" size="sm">
        <div className="space-y-3">
          <input value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" onKeyDown={(e) => { if (e.key === "Enter" && renameFolderId) handleRenameFolder(renameFolderId); }} />
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setRenameFolderId(null)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">Cancel</button>
            <button onClick={() => renameFolderId && handleRenameFolder(renameFolderId)} className="btn btn-primary">Save</button>
          </div>
        </div>
      </Modal>

      {/* Edit document modal */}
      <Modal open={!!editDoc} onClose={() => setEditDoc(null)} title="Edit Document" size="md">
        {editDoc && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Display name</label>
              <input value={editForm.display_name ?? ""} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Supplier / company</label>
              <input value={editForm.supplier_name ?? ""} onChange={(e) => setEditForm({ ...editForm, supplier_name: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Bill / invoice number</label>
              <input value={editForm.bill_number ?? ""} onChange={(e) => setEditForm({ ...editForm, bill_number: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Bill date</label>
              <input type="date" value={editForm.bill_date ?? ""} onChange={(e) => setEditForm({ ...editForm, bill_date: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Amount</label>
              <input type="number" value={editForm.amount ?? ""} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value ? Number(e.target.value) : null })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Amount</label>
              <input type="number" step="0.01" min="0" value={editForm.amount ?? ""} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value ? Number(e.target.value) : null })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">GST amount</label>
              <input type="number" step="0.01" min="0" value={editForm.gst_amount ?? ""} onChange={(e) => setEditForm({ ...editForm, gst_amount: e.target.value ? Number(e.target.value) : null })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Payment status</label>
              <select value={editForm.is_paid ? "paid" : "notpaid"} onChange={(e) => setEditForm({ ...editForm, is_paid: e.target.value === "paid" })} className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="notpaid">Not Paid</option>
                <option value="paid">Paid</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Notes</label>
              <textarea value={editForm.notes ?? ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary" rows={3} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Folder</label>
              <select value={editForm.folder_id ?? ""} onChange={(e) => setEditForm({ ...editForm, folder_id: e.target.value || null })} className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Unfiled</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={() => setEditDoc(null)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">Cancel</button>
              <button onClick={handleSaveEdit} className="btn btn-primary">Save</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Preview modal */}
      <Modal open={!!previewDoc} onClose={() => { setPreviewDoc(null); setPreviewUrl(null); setPreviewText(null); }} title={previewDoc ? previewDoc.display_name : "Preview"} size="xl">
        {previewDoc && (
          <div className="space-y-3">
            <p className="text-xs text-text-muted break-words">{previewDoc.original_filename}</p>
            {previewLoading && <div className="flex items-center justify-center py-10"><Loader2 size={24} className="text-primary animate-spin" /></div>}
            {!previewLoading && previewKind(previewDoc.content_type, previewDoc.original_filename) === "pdf" && previewUrl && (
              <iframe src={previewUrl} className="w-full h-[70vh] border border-border rounded-xl" title="PDF preview" />
            )}
            {!previewLoading && previewKind(previewDoc.content_type, previewDoc.original_filename) === "image" && previewUrl && (
              <img alt={previewDoc.original_filename} className="max-w-full max-h-[70vh] mx-auto rounded-xl" src={previewUrl} />
            )}
            {!previewLoading && previewKind(previewDoc.content_type, previewDoc.original_filename) === "text" && previewText !== null && (
              <pre className="whitespace-pre-wrap break-words text-xs text-text bg-bg border border-border rounded-xl p-4 max-h-[70vh] overflow-auto">{previewText}</pre>
            )}
            {!previewLoading && previewKind(previewDoc.content_type, previewDoc.original_filename) === "none" && (
              <p className="text-sm text-text-muted">Preview not available for this format. Download the file to open it.</p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => handleDownload(previewDoc)} className="btn btn-primary">Download</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Move modal */}
      <Modal open={!!moveDocIds} onClose={() => setMoveDocIds(null)} title="Move documents" size="sm">
        <div className="space-y-3">
          <p className="text-sm text-text-muted">Moving {moveDocIds?.length ?? 0} document(s).</p>
          <select value={moveTargetFolderId ?? ""} onChange={(e) => setMoveTargetFolderId(e.target.value || null)} className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">Unfiled</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setMoveDocIds(null)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">Cancel</button>
            <button onClick={handleMoveDocs} className="btn btn-primary">Move</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
