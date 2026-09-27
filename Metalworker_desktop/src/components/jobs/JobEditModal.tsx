// src/components/jobs/JobEditModal.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, AlertTriangle } from "lucide-react";
import type { Job, JobInput } from "../../types/job";
import { updateJob } from "../../services/jobs";
import { getJobTypeLabel } from "../../types/job";
import Modal from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  job: Job | null;
  onSaved: () => void;
}

type FormState = Pick<
  Job,
  | "job_no"
  | "job_given_date"
  | "po_status"
  | "tool_description"
  | "tool_part"
  | "quantity"
  | "expected_completion_date"
  | "expected_completion_note"
  | "current_machining_status"
  | "status"
  | "drawing_status"
  | "drawing_status_note"
  | "model_status"
>;

const FIELDS: {
  section: string;
  items: {
    key: keyof FormState;
    label: string;
    /** Full width. */
    wide?: boolean;
    placeholder?: string;
    /** Free text that should read as YYYY-MM-DD but is not typed as such. */
    dateLike?: boolean;
  }[];
}[] = [
  {
    section: "Job Information",
    items: [{ key: "job_no", label: "Job No", placeholder: "e.g. JOB-1042" }],
  },
  {
    section: "Scheduling",
    items: [
      { key: "job_given_date", label: "Job Given Date", dateLike: true },
      { key: "expected_completion_date", label: "Expected Completion Date", dateLike: true },
      {
        key: "expected_completion_note",
        label: "Expected Completion Note",
        wide: true,
        placeholder: "e.g. Urgent — before Friday",
      },
    ],
  },
  {
    section: "Purchase / Tool",
    items: [
      { key: "po_status", label: "PO Status", placeholder: "e.g. Received" },
      { key: "tool_part", label: "Tool / Part", placeholder: "e.g. Shaft" },
      {
        key: "tool_description",
        label: "Tool Description",
        wide: true,
        placeholder: "Free-text description",
      },
    ],
  },
  {
    section: "Production",
    items: [
      { key: "quantity", label: "Quantity", placeholder: "e.g. 12" },
      { key: "status", label: "Status", placeholder: "e.g. In Progress" },
      {
        key: "current_machining_status",
        label: "Current Machining Status",
        wide: true,
        placeholder: "e.g. Turning 60%",
      },
    ],
  },
  {
    section: "Documentation",
    items: [
      { key: "drawing_status", label: "DRG Status", placeholder: "e.g. Approved" },
      { key: "model_status", label: "Model Status", placeholder: "e.g. Available" },
      {
        key: "drawing_status_note",
        label: "DRG Status Note",
        wide: true,
        placeholder: "Free-text note",
      },
    ],
  },
];

const inputCls =
  "w-full px-3.5 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

function emptyToNull(v: string): string | null {
  return v.trim() === "" ? null : v.trim();
}

/** Flags values that look like a typo'd date so they can be caught before save. */
function dateProblem(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Use the date picker, or type YYYY-MM-DD.";
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "That date does not exist.";
  return null;
}

export default function JobEditModal({ open, onClose, job, onSaved }: Props) {
  const [formData, setFormData] = useState<JobInput>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  /* Snapshot of the values as loaded, used to detect unsaved edits and to
     restore them if a failed save leaves the dialog open. */
  const initialRef = useRef<FormState | null>(null);

  useEffect(() => {
    if (job && open) {
      const next: FormState = {
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
      };
      initialRef.current = next;
      setFormData(next);
      setError(null);
      setShowValidation(false);
    }
  }, [job, open]);

  const dirty = useMemo(() => {
    if (!initialRef.current) return false;
    const init = initialRef.current;
    return FIELDS.some(
      (sec) =>
        sec.items.some((f) => (formData[f.key] ?? null) !== (init[f.key] ?? null)) || false
    );
  }, [formData]);

  const dateIssues = useMemo(() => {
    const out: Partial<Record<keyof FormState, string>> = {};
    for (const sec of FIELDS) {
      for (const f of sec.items) {
        if (!f.dateLike) continue;
        const problem = dateProblem((formData[f.key] ?? null) as string | null);
        if (problem) out[f.key] = problem;
      }
    }
    return out;
  }, [formData]);

  const hasBlockingIssues = Object.keys(dateIssues).length > 0;

  /* Guard against losing a long edit to a stray click or Escape. */
  async function requestClose() {
    if (loading) return;
    if (!dirty) {
      onClose();
      return;
    }
    const discard = await confirm({
      title: "Discard unsaved changes?",
      message:
        "You edited this job but have not saved. Closing now loses those changes. Saving keeps them and updates the job.",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      tone: "danger",
    });
    if (discard) onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !job) return;
    setShowValidation(true);
    if (hasBlockingIssues) {
      setError("Fix the highlighted date fields before saving.");
      return;
    }

    setError(null);
    setLoading(true);

    const payload: JobInput = { ...formData };
    for (const key of Object.keys(payload)) {
      const v = payload[key as keyof JobInput];
      if (typeof v === "string") {
        (payload as Record<string, unknown>)[key] = emptyToNull(v);
      }
    }

    try {
      const res = await updateJob(job.id, payload);
      if (!res.ok) {
        setError(
          res.error
            ? `Could not save: ${res.error}`
            : "The job was not saved. Check your connection and try again."
        );
        setLoading(false);
        return;
      }
      setLoading(false);
      initialRef.current = { ...(initialRef.current as FormState) };
      toast.success({
        title: "Job saved",
        description: `${job.job_no || "Job"} was updated.`,
      });
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not save: ${err.message}`
          : "The job was not saved. Check your connection and try again."
      );
      setLoading(false);
    }
  }

  if (!open || !job) return null;

  const errorFor = (key: keyof FormState) =>
    showValidation ? dateIssues[key] : undefined;

  return (
    <Modal
      open={open}
      onClose={requestClose}
      size="xl"
      title="Edit Job Details"
      subtitle={`${getJobTypeLabel(job.job_type)} · Job ${job.job_no || "without a number"}`}
      footer={
        <>
          <button
            type="button"
            onClick={requestClose}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="job-edit-form"
            disabled={loading || hasBlockingIssues}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer shadow-lg shadow-primary/20"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {loading ? "Saving…" : dirty ? "Save Changes" : "No changes to save"}
          </button>
        </>
      }
    >
      <form
        id="job-edit-form"
        onSubmit={handleSubmit}
        noValidate
        className="space-y-6"
      >
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-danger-muted border border-danger/25 text-danger text-sm"
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {FIELDS.map((sec) => (
          <fieldset key={sec.section} className="min-w-0">
            <legend className="text-xs font-bold text-text-muted uppercase tracking-wider border-b border-border pb-1.5 mb-3 w-full">
              {sec.section}
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sec.items.map((f) => {
                const id = `job-${f.key}`;
                const msg = errorFor(f.key);
                return (
                  <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                    <label
                      htmlFor={id}
                      className="block text-xs font-semibold text-text-secondary mb-1.5"
                    >
                      {f.label}
                    </label>
                    <input
                      id={id}
                      type="text"
                      value={(formData[f.key] as string | null) ?? ""}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, [f.key]: e.target.value }))
                      }
                      placeholder={f.placeholder}
                      aria-invalid={msg ? true : undefined}
                      aria-describedby={msg ? `${id}-error` : undefined}
                      className={`${inputCls} ${msg ? "border-danger focus:ring-danger focus:border-danger" : ""}`}
                    />
                    {msg && (
                      <p
                        id={`${id}-error`}
                        role="alert"
                        className="text-xs text-danger mt-1.5"
                      >
                        {msg}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}

        <p className="text-xs text-text-muted">
          Fields left blank are stored as empty. Press Esc to cancel.
        </p>
      </form>
    </Modal>
  );
}
