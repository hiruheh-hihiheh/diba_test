import { useState, useEffect } from "react";
import { X, Loader2, Save } from "lucide-react";
import type { Job, JobInput } from "../../types/job";
import { updateJob } from "../../services/jobs";
import { getJobTypeLabel } from "../../types/job";
import AdminModal from "../ui/AdminModal";

interface Props {
  open: boolean;
  onClose: () => void;
  job: Job | null;
  onSaved: () => void;
}

export default function JobEditModal({ open, onClose, job, onSaved }: Props) {
  const [formData, setFormData] = useState<JobInput>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job && open) {
      setFormData({
        job_no: job.job_no,
        job_given_date: job.job_given_date,
        po_status: job.po_status,
        tool_description: job.tool_description,
        tool_part: job.tool_part,
        quantity: job.quantity,
        expected_completion_date: job.expected_completion_date,
        expected_completion_note: job.expected_completion_note,
        current_machining_status: job.current_machining_status,
        status: job.status,
        drawing_status: job.drawing_status,
        drawing_status_note: job.drawing_status_note,
        model_status: job.model_status,
      });
      setError(null);
    }
  }, [job, open]);

  if (!open || !job) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await updateJob(job!.id, formData);
      if (!res.ok) {
        setError(res.error || "Failed to update job.");
        setLoading(false);
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  const inputCls = "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";
  const labelCls = "block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5";

  return (
    <AdminModal open={open} onClose={onClose}>
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(100vh-104px)] flex flex-col animate-scale-in">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold text-text">Edit Job Details</h3>
            <p className="text-sm text-text-muted">Job Type: <span className="font-semibold text-text">{getJobTypeLabel(job.job_type)}</span></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 flex-1 min-h-0 overflow-y-auto">
          <form id="job-edit-form" onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="px-4 py-3 rounded-xl bg-danger-muted border border-danger/20 text-danger text-sm">
                {error}
              </div>
            )}

            {/* JOB INFORMATION */}
            <div>
              <h4 className="text-sm font-bold text-text mb-3 border-b border-border pb-1">JOB INFORMATION</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Job No</label>
                  <input type="text" value={formData.job_no || ""} onChange={e => setFormData(p => ({ ...p, job_no: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>

            {/* SCHEDULING */}
            <div>
              <h4 className="text-sm font-bold text-text mb-3 border-b border-border pb-1">SCHEDULING</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Job Given Date</label>
                  <input type="date" value={formData.job_given_date || ""} onChange={e => setFormData(p => ({ ...p, job_given_date: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Expected Completion Date</label>
                  <input type="date" value={formData.expected_completion_date || ""} onChange={e => setFormData(p => ({ ...p, expected_completion_date: e.target.value }))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Expected Completion Note</label>
                  <input type="text" value={formData.expected_completion_note || ""} onChange={e => setFormData(p => ({ ...p, expected_completion_note: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>

            {/* PURCHASE / TOOL */}
            <div>
              <h4 className="text-sm font-bold text-text mb-3 border-b border-border pb-1">PURCHASE / TOOL</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>PO Status</label>
                  <input type="text" value={formData.po_status || ""} onChange={e => setFormData(p => ({ ...p, po_status: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Tool / Part</label>
                  <input type="text" value={formData.tool_part || ""} onChange={e => setFormData(p => ({ ...p, tool_part: e.target.value }))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Tool Description</label>
                  <input type="text" value={formData.tool_description || ""} onChange={e => setFormData(p => ({ ...p, tool_description: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>

            {/* PRODUCTION */}
            <div>
              <h4 className="text-sm font-bold text-text mb-3 border-b border-border pb-1">PRODUCTION</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Quantity</label>
                  <input type="text" value={formData.quantity || ""} onChange={e => setFormData(p => ({ ...p, quantity: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <input type="text" value={formData.status || ""} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Current Machining Status</label>
                  <input type="text" value={formData.current_machining_status || ""} onChange={e => setFormData(p => ({ ...p, current_machining_status: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>

            {/* DOCUMENTATION */}
            <div>
              <h4 className="text-sm font-bold text-text mb-3 border-b border-border pb-1">DOCUMENTATION</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>DRG Status</label>
                  <input type="text" value={formData.drawing_status || ""} onChange={e => setFormData(p => ({ ...p, drawing_status: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Model Status</label>
                  <input type="text" value={formData.model_status || ""} onChange={e => setFormData(p => ({ ...p, model_status: e.target.value }))} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>DRG Status Note</label>
                  <input type="text" value={formData.drawing_status_note || ""} onChange={e => setFormData(p => ({ ...p, drawing_status_note: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>

          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0 bg-surface rounded-b-2xl">
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-all cursor-pointer">
            Cancel
          </button>
          <button type="submit" form="job-edit-form" disabled={loading} className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-lg shadow-primary/20">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Changes
          </button>
        </div>

      </div>
    </AdminModal>
  );
}
