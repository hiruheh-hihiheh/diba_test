import { useState, useEffect, useRef } from "react";
import { X, Loader2, UploadCloud, FileText, Image as ImageIcon, Trash2, CheckCircle, ExternalLink } from "lucide-react";
import type { Job } from "../../types/job";
import type { JobDrawing } from "../../types/jobDrawing";
import { fetchJobDrawings, createJobDrawing, deleteJobDrawing, setPrimaryDrawing } from "../../services/jobDrawings";
import { uploadPhoto } from "../../services/cloudinary";
import { getJobTypeLabel } from "../../types/job";

interface Props {
  open: boolean;
  onClose: () => void;
  job: Job | null;
}

export default function JobDrawingModal({ open, onClose, job }: Props) {
  const [drawings, setDrawings] = useState<JobDrawing[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (job && open) {
      loadDrawings();
    }
  }, [job, open]);

  async function loadDrawings() {
    if (!job) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJobDrawings(job.id);
      setDrawings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drawings.");
    } finally {
      setLoading(false);
    }
  }

  if (!open || !job) return null;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !job) return;

    setError(null);
    setUploading(true);
    try {
      // Upload to Cloudinary
      const res = await uploadPhoto(file);
      
      // Determine if it should be primary
      const isPrimary = drawings.length === 0;

      // Save to database
      const dbRes = await createJobDrawing({
        job_id: job.id,
        file_url: res.secureUrl,
        public_id: res.publicId,
        file_name: file.name,
        file_type: file.type,
        version: 1,
        is_primary: isPrimary,
        received_date: new Date().toISOString().split("T")[0]
      });

      if (!dbRes.ok) {
        throw new Error(dbRes.error || "Failed to save drawing record.");
      }

      await loadDrawings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleDelete(drawingId: string) {
    if (!confirm("Are you sure you want to delete this drawing?")) return;

    setError(null);
    try {
      const res = await deleteJobDrawing(drawingId);
      if (!res.ok) throw new Error(res.error || "Failed to delete drawing.");
      
      alert("Drawing deleted from database. (Cloudinary cleanup deferred).");
      await loadDrawings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  async function handleMakePrimary(drawingId: string) {
    if (!job) return;
    setError(null);
    try {
      const res = await setPrimaryDrawing(job.id, drawingId);
      if (!res.ok) throw new Error(res.error || "Failed to set primary.");
      await loadDrawings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set primary.");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-scale-in">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold text-text">Drawings for {job.job_no || "Job"}</h3>
            <p className="text-sm text-text-muted">Job Type: <span className="font-semibold text-text">{getJobTypeLabel(job.job_type)}</span> | DRG Status: <span className="font-semibold text-text">{job.drawing_status || "—"}</span></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="px-4 py-3 rounded-xl bg-danger-muted border border-danger/20 text-danger text-sm mb-6">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <h4 className="text-sm font-bold text-text uppercase tracking-wider">
              {drawings.length} Drawing{drawings.length === 1 ? "" : "s"}
            </h4>
            
            <div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept="image/png, image/jpeg, image/webp, application/pdf" 
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || loading}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-primary/20 cursor-pointer"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                {uploading ? "Uploading..." : "Upload Drawing"}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Loader2 size={32} className="animate-spin mb-4" />
              <p>Loading drawings...</p>
            </div>
          ) : drawings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-border rounded-2xl bg-bg/50">
              <ImageIcon size={48} className="text-text-muted mb-4 opacity-50" />
              <h3 className="text-lg font-bold text-text mb-2">No drawing uploaded</h3>
              <p className="text-sm text-text-muted max-w-sm">Upload the first drawing for this job. Common formats like PNG, JPG, and PDF are supported.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {drawings.map((d, index) => {
                const isImage = d.file_type?.startsWith("image/") || d.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
                
                return (
                  <div key={d.id} className={`flex flex-col bg-bg border ${d.is_primary ? 'border-primary shadow-md shadow-primary/10' : 'border-border'} rounded-xl overflow-hidden transition-all hover:border-text-muted group`}>
                    
                    {/* Preview Area */}
                    <div className="aspect-video bg-surface-hover flex items-center justify-center relative border-b border-border overflow-hidden">
                      {isImage ? (
                        <img src={d.file_url} alt={d.file_name || "Drawing"} className="w-full h-full object-cover" />
                      ) : (
                        <FileText size={48} className="text-text-muted" />
                      )}
                      
                      {d.is_primary && (
                        <div className="absolute top-2 left-2 px-2.5 py-1 bg-primary text-white text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1 shadow-md">
                          <CheckCircle size={12} />
                          Primary
                        </div>
                      )}

                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
                        <button 
                          onClick={() => window.open(d.file_url, "_blank")}
                          className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-white/40 transition-colors cursor-pointer"
                          title="Open / Preview"
                        >
                          <ExternalLink size={18} />
                        </button>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="p-4 flex flex-col flex-1">
                      <p className="font-semibold text-text text-sm truncate mb-1" title={d.file_name || "Unnamed Drawing"}>
                        {d.file_name || `Drawing ${index + 1}`}
                      </p>
                      <div className="flex items-center justify-between text-xs text-text-muted mb-4">
                        <span>Ver: {d.version || 1}</span>
                        <span>{d.received_date || "No date"}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                        {!d.is_primary ? (
                          <button 
                            onClick={() => handleMakePrimary(d.id)}
                            className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors cursor-pointer"
                          >
                            Set Primary
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-text-muted">Primary</span>
                        )}
                        
                        <button 
                          onClick={() => handleDelete(d.id)}
                          className="text-danger opacity-70 hover:opacity-100 transition-opacity cursor-pointer p-1"
                          title="Delete drawing"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
