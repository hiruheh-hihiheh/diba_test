// src/pages/GroupDrawings.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PenTool, Plus, Search, Edit3, Trash2, Loader2, RefreshCw, X,
  AlertTriangle, Image, Upload, Trash,
} from "lucide-react";
import {
  fetchDrawingGroups, createDrawingGroup, updateDrawingGroup, deleteDrawingGroup,
  fetchDrawingGroupPhotos, addDrawingGroupPhoto, removeDrawingGroupPhoto,
} from "../services/drawingGroups";
import { uploadPhoto } from "../services/cloudinary";
import type { DrawingGroup, DrawingGroupPhoto, DrawingGroupInput } from "../types/drawingGroup";

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

export default function GroupDrawingsPage() {
  const [groups, setGroups] = useState<DrawingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DrawingGroup | null>(null);
  const [formName, setFormName] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [showPhotosModal, setShowPhotosModal] = useState(false);
  const [photosGroup, setPhotosGroup] = useState<DrawingGroup | null>(null);
  const [photos, setPhotos] = useState<DrawingGroupPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { const list = await fetchDrawingGroups(); setGroups(list); } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  async function handleRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.group_date.includes(q));
  }, [groups, search]);

  function openAdd() { setEditingGroup(null); setFormName(""); setFormDate(new Date().toISOString().split("T")[0]); setFormMessage(null); setShowFormModal(true); }
  function openEdit(group: DrawingGroup) { setEditingGroup(group); setFormName(group.name); setFormDate(group.group_date); setFormMessage(null); setShowFormModal(true); }

  async function openPhotos(group: DrawingGroup) {
    setPhotosGroup(group); setPhotos([]); setPhotosLoading(true); setPhotoFile(null); setShowPhotosModal(true);
    try { const list = await fetchDrawingGroupPhotos(group.id); setPhotos(list); } catch { } finally { setPhotosLoading(false); }
  }

  async function handleSave() {
    setFormMessage(null);
    if (!formName.trim()) { setFormMessage({ type: "error", text: "Name is required." }); return; }
    if (!formDate) { setFormMessage({ type: "error", text: "Date is required." }); return; }
    setFormLoading(true);
    try {
      const input: DrawingGroupInput = { name: formName.trim(), group_date: formDate };
      if (editingGroup) {
        const res = await updateDrawingGroup(editingGroup.id, input);
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
        setFormMessage({ type: "success", text: "Updated." });
      } else {
        const res = await createDrawingGroup(input);
        if (!res.ok) { setFormMessage({ type: "error", text: res.error || "Failed." }); return; }
        setFormMessage({ type: "success", text: "Created." });
      }
      await load();
      setTimeout(() => setShowFormModal(false), 800);
    } catch (err) { setFormMessage({ type: "error", text: err instanceof Error ? err.message : "Failed." }); }
    finally { setFormLoading(false); }
  }

  async function handleDelete(group: DrawingGroup) {
    if (!window.confirm(`Delete "${group.name}"? This will also delete all drawings.`)) return;
    try { const res = await deleteDrawingGroup(group.id); if (res.ok) await load(); else window.alert(res.error || "Failed."); }
    catch (err) { window.alert(err instanceof Error ? err.message : "Failed."); }
  }

  async function handleUploadPhoto() {
    if (!photoFile || !photosGroup) return;
    try {
      setUploading(true);
      const result = await uploadPhoto(photoFile);
      const res = await addDrawingGroupPhoto(photosGroup.id, result.secureUrl, result.publicId);
      if (res.ok && res.data) { setPhotos((prev) => [...prev, res.data!]); setPhotoFile(null); }
      else window.alert(res.error || "Failed.");
    } catch (err) { window.alert(err instanceof Error ? err.message : "Upload failed."); }
    finally { setUploading(false); }
  }

  async function handleRemovePhoto(photoId: string) {
    if (!window.confirm("Remove this drawing?")) return;
    try { const res = await removeDrawingGroupPhoto(photoId); if (res.ok) setPhotos((prev) => prev.filter((p) => p.id !== photoId)); else window.alert(res.error || "Failed."); }
    catch (err) { window.alert(err instanceof Error ? err.message : "Failed."); }
  }

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="text-primary animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-success-muted flex items-center justify-center"><PenTool size={20} className="text-success" /></div>
          <div><h1 className="text-xl font-bold text-text">Group Drawings</h1><p className="text-sm text-text-muted">{filtered.length} group{filtered.length !== 1 ? "s" : ""}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all shadow-lg shadow-primary/20 cursor-pointer"><Plus size={16} />Add Group</button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drawing groups..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-border">
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Name</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Date</th>
            <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Created</th>
            <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-5 py-3">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-12 text-center"><AlertTriangle size={32} className="mx-auto text-text-muted/30 mb-2" /><p className="text-sm text-text-muted">{search ? "No groups match." : "No drawing groups yet."}</p></td></tr>
            ) : filtered.map((group) => (
              <tr key={group.id} className="hover:bg-surface-hover/50 transition-colors">
                <td className="px-5 py-4"><p className="text-sm font-semibold text-text">{group.name}</p></td>
                <td className="px-5 py-4"><p className="text-sm text-text-muted">{group.group_date}</p></td>
                <td className="px-5 py-4 hidden lg:table-cell"><p className="text-sm text-text-muted">{new Date(group.created_at).toLocaleDateString()}</p></td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openPhotos(group)} className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all cursor-pointer" title="Drawings"><Image size={16} /></button>
                    <button onClick={() => openEdit(group)} className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary-muted transition-all cursor-pointer" title="Edit"><Edit3 size={16} /></button>
                    <button onClick={() => handleDelete(group)} className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger-muted transition-all cursor-pointer" title="Delete"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showFormModal} onClose={() => setShowFormModal(false)} title={editingGroup ? "Edit Drawing Group" : "Add Drawing Group"}>
        <div className="space-y-4">
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Name</label>
            <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Group name" className={inputCls} /></div>
          <div><label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Date</label>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className={inputCls} /></div>
          {formMessage && <div className={`px-4 py-3 rounded-xl text-sm animate-scale-in ${formMessage.type === "error" ? "bg-danger-muted border border-danger/20 text-danger" : "bg-success-muted border border-success/20 text-success"}`}>{formMessage.text}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowFormModal(false)} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">Cancel</button>
            <button onClick={handleSave} disabled={formLoading} className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2">
              {formLoading && <Loader2 size={14} className="animate-spin" />}{editingGroup ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showPhotosModal} onClose={() => setShowPhotosModal(false)} title={`Drawings — ${photosGroup?.name ?? ""}`}>
        <div className="space-y-4">
          {photosLoading ? <div className="flex justify-center py-8"><Loader2 size={24} className="text-primary animate-spin" /></div>
          : photos.length === 0 ? <div className="text-center py-8"><Image size={32} className="mx-auto text-text-muted/30 mb-2" /><p className="text-sm text-text-muted">No drawings yet.</p></div>
          : (
            <div className="grid grid-cols-3 gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group">
                  <img src={photo.photo_url} alt="" className="w-full h-32 rounded-xl object-cover border border-border" />
                  <button onClick={() => handleRemovePhoto(photo.id)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-danger/90 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-lg">
                    <Trash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} className="text-sm text-text-muted flex-1" />
            <button onClick={handleUploadPhoto} disabled={!photoFile || uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
