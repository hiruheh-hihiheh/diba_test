// src/components/jobs/JobDrawingModal.tsx

import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Trash2,
  CheckCircle,
  ExternalLink,
  Star,
  AlertTriangle,
  Images,
} from "lucide-react";
import type { Job } from "../../types/job";
import type { JobDrawing } from "../../types/jobDrawing";
import {
  fetchJobDrawings,
  createJobDrawing,
  deleteJobDrawing,
  setPrimaryDrawing,
} from "../../services/jobDrawings";
import { uploadPhoto } from "../../services/cloudinary";
import { getJobTypeLabel } from "../../types/job";
import Modal from "../ui/Modal";
import EmptyState from "../ui/EmptyState";
import IconButton from "../ui/IconButton";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  job: Job | null;
  /** Called after an upload, delete or primary change so the list can refresh. */
  onChanged?: () => void;
}

const ACCEPT = "image/png, image/jpeg, image/webp, application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

export default function JobDrawingModal({ open, onClose, job, onChanged }: Props) {
  const [drawings, setDrawings] = useState<JobDrawing[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (job && open) loadDrawings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, open]);

  async function loadDrawings() {
    if (!job) return;
    setLoading(true);
    setError(null);
    try {
      setDrawings(await fetchJobDrawings(job.id));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not load drawings: ${err.message}`
          : "The drawings for this job could not be loaded. Try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !job) return;

    setError(null);

    /* Caught locally so an oversized or wrong-format file never leaves the
       browser and fails silently against Cloudinary. */
    if (file.size > MAX_BYTES) {
      setError(
        `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB — please compress it or upload a smaller file.`
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const res = await uploadPhoto(file);
      const isPrimary = drawings.length === 0;

      const dbRes = await createJobDrawing({
        job_id: job.id,
        file_url: res.secureUrl,
        public_id: res.publicId,
        file_name: file.name,
        file_type: file.type,
        version: 1,
        is_primary: isPrimary,
        received_date: new Date().toISOString().split("T")[0],
      });

      if (!dbRes.ok) throw new Error(dbRes.error || "The file uploaded but could not be saved.");

      await loadDrawings();
      onChanged?.();
      toast.success({
        title: "Drawing uploaded",
        description: `“${file.name}” was added${isPrimary ? " and set as primary" : ""}.`,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Upload failed: ${err.message}`
          : "The file could not be uploaded. Check your connection and try again."
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(drawing: JobDrawing) {
    const ok = await confirm({
      title: "Delete this drawing?",
      message: (
        <>
          <strong className="text-text">{drawing.file_name || "This drawing"}</strong> will be
          removed from job {drawing.job_id ? "" : ""}
          {drawings.length === 1 ? " (it is the only one)" : ""}. The job record itself is not
          affected.
        </>
      ),
      confirmLabel: "Delete drawing",
    });
    if (!ok) return;

    setBusyId(drawing.id);
    setError(null);
    try {
      const res = await deleteJobDrawing(drawing.id);
      if (!res.ok) throw new Error(res.error || "The drawing was not deleted.");
      await loadDrawings();
      onChanged?.();
      toast.success({ title: "Drawing deleted", description: drawing.file_name || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The drawing could not be deleted.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMakePrimary(drawing: JobDrawing) {
    if (!job) return;
    setBusyId(drawing.id);
    setError(null);
    try {
      const res = await setPrimaryDrawing(job.id, drawing.id);
      if (!res.ok) throw new Error(res.error || "The primary drawing was not changed.");
      await loadDrawings();
      onChanged?.();
      toast.success({
        title: "Primary drawing updated",
        description: `“${drawing.file_name || "Drawing"}” is now the primary for this job.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The primary drawing was not changed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!open || !job) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Drawings — ${job.job_no || "Job"}`}
      subtitle={`${getJobTypeLabel(job.job_type)} · DRG status: ${job.drawing_status || "not set"}`}
      footer={
        <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept={ACCEPT}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || loading}
            className="mr-auto px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-primary/20 cursor-pointer"
          >
            {uploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <UploadCloud size={16} />
            )}
            {uploading ? "Uploading…" : "Upload drawing"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
          >
            Done
          </button>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-danger-muted border border-danger/25 text-danger text-sm mb-5"
        >
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={loadDrawings}
            className="font-bold underline underline-offset-2 cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <p className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">
        {drawings.length} drawing{drawings.length === 1 ? "" : "s"}
      </p>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-text-muted">
          <Loader2 size={28} className="animate-spin mb-3" />
          <p className="text-sm">Loading drawings…</p>
        </div>
      ) : drawings.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-2xl bg-bg/50">
          <EmptyState
            icon={<Images size={24} />}
            title="No drawing uploaded"
            description="Upload the first drawing for this job. PNG, JPG, WEBP and PDF are supported, up to 10 MB each. The first upload becomes the primary drawing."
            action={
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
              >
                Upload drawing
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {drawings.map((d, index) => {
            const isImage =
              d.file_type?.startsWith("image/") ||
              d.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
            const busy = busyId === d.id;

            return (
              <div
                key={d.id}
                aria-busy={busy}
                className={`flex flex-col bg-bg border rounded-xl overflow-hidden transition-all hover:border-text-muted ${
                  d.is_primary ? "border-primary shadow-md shadow-primary/10" : "border-border"
                } ${busy ? "opacity-60" : ""}`}
              >
                <div className="aspect-video bg-surface-hover flex items-center justify-center relative border-b border-border overflow-hidden">
                  {isImage ? (
                    <img
                      src={d.file_url}
                      alt={d.file_name || "Drawing"}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileText size={44} className="text-text-muted" />
                  )}

                  {d.is_primary && (
                    <span className="absolute top-2 left-2 px-2.5 py-1 bg-primary text-white text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1 shadow-md">
                      <CheckCircle size={12} />
                      Primary
                    </span>
                  )}

                  {/* Always-visible preview control: the hover-only overlay
                      meant a keyboard or touch user could never open it. */}
                  <button
                    type="button"
                    onClick={() => window.open(d.file_url, "_blank", "noopener,noreferrer")}
                    title="Open drawing in a new tab"
                    aria-label={`Open ${d.file_name || "drawing"} in a new tab`}
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-lg bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors cursor-pointer backdrop-blur-sm"
                  >
                    <ExternalLink size={16} />
                  </button>
                </div>

                <div className="p-4 flex flex-col flex-1">
                  <p
                    className="font-semibold text-text text-sm truncate mb-1"
                    title={d.file_name || "Unnamed drawing"}
                  >
                    {d.file_name || `Drawing ${index + 1}`}
                  </p>
                  <div className="flex items-center justify-between text-xs text-text-muted mb-3">
                    <span>Ver {d.version || 1}</span>
                    <span>{d.received_date || "No date"}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-auto pt-3 border-t border-border">
                    {d.is_primary ? (
                      <span className="text-xs font-semibold text-text-muted inline-flex items-center gap-1">
                        <CheckCircle size={12} /> Primary
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleMakePrimary(d)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-hover transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Star size={12} />
                        )}
                        Set primary
                      </button>
                    )}

                    <div className="flex items-center gap-1">
                      <IconButton
                        label={`Preview ${d.file_name || "drawing"}`}
                        size="sm"
                        icon={<ImageIcon size={14} />}
                        onClick={() => window.open(d.file_url, "_blank", "noopener,noreferrer")}
                        disabled={busy}
                      />
                      <IconButton
                        label={`Delete ${d.file_name || "drawing"}`}
                        size="sm"
                        variant="danger"
                        icon={<Trash2 size={14} />}
                        onClick={() => handleDelete(d)}
                        busy={busy}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
