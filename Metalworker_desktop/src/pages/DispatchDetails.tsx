// src/pages/DispatchDetails.tsx
//
// One dispatch, in detail, with inline editing and a full-screen photo view.
//
// What was wrong and what changed:
//  * The full-screen photo overlay put its close button at `-top-12`, i.e.
//    48px *above* the image, outside the overlay's own box. The overlay clipped
//    overflow, so the button was invisible and the only way out was Escape or a
//    click on the backdrop. It now uses the shared `ImageLightbox`, whose
//    controls live inside the viewport at any window size.
//  * "Vehicle number is required" arrived in a `window.alert`, which looks like
//    a browser error and loses your place. It is now inline on the field, and
//    the field is focused.
//  * A failed save or delete also used `window.alert`; both are toasts now.
//  * Delete used a bare `window.confirm` that did not say what happens to the
//    record. It is the in-app dialog and names the worker and vehicle.
//  * "Cancel" silently threw away typed changes with no warning. It now asks
//    first when the form is dirty.
//  * Save and Delete were not disabled while running, so a double click could
//    fire two deletes.
//  * Saving only refreshed the record quietly; you got no confirmation that
//    anything had changed.
//  * The page title / breadcrumb came from the route map, so an error state
//    still showed "Dispatch Details" for a dispatch that did not load.
//  * Edit mode is a two-column layout on wide screens and stacks on narrow
//    ones, and the status/material choices are proper radio groups so arrow keys
//    work.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  User,
  Truck,
  Package,
  MapPin,
  Clock,
  CheckCircle2,
  Pencil,
  Trash2,
  Save,
  X,
  ImageOff,
  Maximize2,
  CalendarDays,
  Hash,
} from "lucide-react";
import {
  fetchDispatchById,
  updateDispatch,
  deleteDispatch,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import type { Dispatch, DispatchStatus, MaterialType, UpdateDispatchInput } from "../types/dispatch";
import ImageLightbox from "../components/ui/ImageLightbox";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { usePageMeta } from "../contexts/PageMetaContext";
import { ErrorState } from "../components/ui/LoadingState";
import { isNotFound, readableError } from "../utils/readableError";

const inputCls =
  "w-full px-4 py-3 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

const MATERIAL_OPTIONS: { key: MaterialType; label: string }[] = [
  { key: "scrap", label: "Scrap" },
  { key: "ferrous", label: "Ferrous Metal" },
  { key: "non_ferrous", label: "Non-Ferrous" },
  { key: "other", label: "Other" },
];

const STATUS_OPTIONS: { key: DispatchStatus; label: string; hint: string }[] = [
  { key: "submitted", label: "Submitted", hint: "Awaiting review" },
  { key: "reviewed", label: "Reviewed", hint: "Checked, awaiting a decision" },
  { key: "approved", label: "Approved", hint: "Accepted" },
  { key: "rejected", label: "Rejected", hint: "Sent back to the worker" },
];

interface EditForm {
  vehicle_number: string;
  material_type: MaterialType;
  location_name: string;
  status: DispatchStatus;
}

function formFrom(dispatch: Dispatch): EditForm {
  return {
    vehicle_number: dispatch.vehicle_number,
    material_type: dispatch.material_type,
    location_name: dispatch.location_name || "",
    status: dispatch.status,
  };
}

export default function DispatchDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** False for "gone" / "not allowed", where a retry button cannot help. */
  const [errorRetryable, setErrorRetryable] = useState(true);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditForm>({
    vehicle_number: "",
    material_type: "scrap",
    location_name: "",
    status: "submitted",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);

  const loadDispatch = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const res = await fetchDispatchById(id);
        if (res.ok && res.data) {
          setDispatch(res.data);
          setForm(formFrom(res.data));
          setError(null);
          setErrorRetryable(true);
        } else {
          setError(
            res.error || "That dispatch could not be found. It may have been deleted."
          );
          /* "Not found" is an answer, not an outage — a retry cannot change it. */
          setErrorRetryable(!isNotFound(res.error));
        }
      } catch (err) {
        const r = readableError(err, {
          subject: "this dispatch",
          fallback: "That dispatch could not be loaded. Check your connection and try again.",
          byKind: {
            "not-found": "That dispatch no longer exists — it was probably deleted.",
            forbidden: "Your account does not have permission to view this dispatch.",
            connection:
              "Could not reach the server, so this dispatch could not be loaded. Check your connection and try again.",
          },
        });
        setError(r.message);
        setErrorRetryable(r.retryable);
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    loadDispatch();
  }, [loadDispatch]);

  const dirty = useMemo(() => {
    if (!dispatch) return false;
    const original = formFrom(dispatch);
    return (
      form.vehicle_number.trim() !== original.vehicle_number ||
      form.material_type !== original.material_type ||
      form.location_name.trim() !== original.location_name ||
      form.status !== original.status
    );
  }, [dispatch, form]);

  usePageMeta(
    {
      title: dispatch ? `Dispatch — ${dispatch.vehicle_number}` : "Dispatch Details",
      crumbs: [{ label: "Dispatches" }, { label: dispatch ? dispatch.vehicle_number : "Details" }],
      subtitle: dispatch
        ? `${dispatch.worker_username} · ${getMaterialLabel(dispatch.material_type)}`
        : "Loading dispatch…",
    },
    [dispatch]
  );

  /* ── Edit ─────────────────────────────────────────── */

  function startEditing() {
    if (dispatch) setForm(formFrom(dispatch));
    setFormError(null);
    setIsEditing(true);
  }

  async function cancelEditing() {
    if (dirty) {
      const ok = await confirm({
        title: "Discard your changes?",
        message: (
          <>
            You have unsaved edits to this dispatch. Closing now loses them.
            <strong className="block mt-2 text-text">The saved record is not affected.</strong>
          </>
        ),
        confirmLabel: "Discard changes",
        tone: "danger",
      });
      if (!ok) return;
    }
    if (dispatch) setForm(formFrom(dispatch));
    setFormError(null);
    setIsEditing(false);
  }

  async function saveChanges() {
    if (!id || saving) return;
    const trimmedVehicle = form.vehicle_number.trim();
    if (!trimmedVehicle) {
      setFormError("A vehicle number is required — it is how the dispatch is identified.");
      document.getElementById("dispatch-vehicle")?.focus();
      return;
    }
    setFormError(null);
    setSaving(true);

    const updateData: UpdateDispatchInput = {
      vehicle_number: trimmedVehicle,
      material_type: form.material_type,
      location_name: form.location_name.trim() || null,
      status: form.status,
    };

    try {
      const res = await updateDispatch(id, updateData);
      if (!res.ok) {
        setFormError(res.error || "The dispatch was not updated. Please try again.");
        return;
      }
      setIsEditing(false);
      await loadDispatch(true);
      toast.success({
        title: "Dispatch updated",
        description: `${trimmedVehicle} is now ${updateData.status}.`,
      });
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "The dispatch was not updated. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ───────────────────────────────────────── */

  async function handleDelete() {
    if (!id || !dispatch || deleting) return;
    const ok = await confirm({
      title: `Delete the dispatch for ${dispatch.vehicle_number}?`,
      message: (
        <>
          The dispatch submitted by{" "}
          <strong className="text-text">{dispatch.worker_username}</strong>, including its photo
          and review history, is permanently removed.
          <strong className="block mt-2 text-text">This cannot be undone.</strong>
        </>
      ),
      confirmLabel: "Delete dispatch",
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await deleteDispatch(id);
      if (!res.ok) {
        toast.error({
          title: "Could not delete the dispatch",
          description: res.error || "It was not deleted. Please try again.",
        });
        return;
      }
      toast.success({
        title: "Dispatch deleted",
        description: `${dispatch.vehicle_number} was removed.`,
      });
      navigate("/dispatches", { replace: true });
    } catch (err) {
      toast.error({
        title: "Could not delete the dispatch",
        description:
          err instanceof Error ? err.message : "It was not deleted. Please try again.",
      });
    } finally {
      setDeleting(false);
    }
  }

  /* ── Render ───────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32" role="status" aria-live="polite">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading dispatch</span>
      </div>
    );
  }

  if (error || !dispatch) {
    return (
      <div className="space-y-6 animate-fade-in max-w-2xl">
        <BackLink onClick={() => navigate("/dispatches")} />
        <ErrorState
          title={errorRetryable ? "Dispatch unavailable" : "Dispatch not found"}
          message={error || "That dispatch could not be found. It may have been deleted."}
          onRetry={errorRetryable ? () => loadDispatch() : undefined}
          secondaryAction={
            <button
              type="button"
              onClick={() => navigate("/dispatches")}
              className="px-4 py-2.5 rounded-xl bg-surface border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Back to all dispatches
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-5xl">
      <BackLink onClick={() => navigate("/dispatches")} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8">
        {/* Photo */}
        <div className="lg:col-span-2">
          {dispatch.photo_url ? (
            <button
              type="button"
              onClick={() => setShowFullImage(true)}
              aria-label="Open the dispatch photo full screen"
              className="group relative block w-full rounded-2xl overflow-hidden border border-border cursor-zoom-in"
            >
              <img
                src={dispatch.photo_url}
                alt={`Dispatch photo for ${dispatch.vehicle_number}`}
                className="w-full object-cover transition-transform group-hover:scale-[1.02]"
                style={{ maxHeight: 420 }}
              />
              <span className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 text-white text-xs font-bold backdrop-blur-sm">
                <Maximize2 size={13} />
                Enlarge
              </span>
            </button>
          ) : (
            <div className="w-full h-64 rounded-2xl border border-border bg-surface flex flex-col items-center justify-center text-text-muted">
              <ImageOff size={32} className="mb-2 opacity-30" />
              <p className="text-sm font-semibold">No photo attached</p>
              <p className="text-xs mt-1 text-center px-6">
                The worker did not attach a photo to this dispatch.
              </p>
            </div>
          )}

          {/* Quick facts, always visible regardless of edit mode. */}
          <dl className="mt-4 bg-surface border border-border rounded-2xl p-5 space-y-3">
            <Fact icon={<Hash size={15} />} label="Reference" value={dispatch.id.slice(0, 8).toUpperCase()} />
            <Fact
              icon={<CalendarDays size={15} />}
              label="Submitted"
              value={formatDateTime(dispatch.submitted_at)}
            />
            {dispatch.status !== "submitted" && (
              <Fact
                icon={<CheckCircle2 size={15} />}
                label="Decided"
                value={dispatch.status}
              />
            )}
          </dl>
        </div>

        {/* Details */}
        <div className="lg:col-span-3 space-y-4">
          {!isEditing ? (
            <>
              <div className="bg-surface border border-border rounded-2xl p-5 sm:p-6 space-y-5">
                <h2 className="text-[13px] font-bold text-text-muted uppercase tracking-[0.12em]">
                  Dispatch Information
                </h2>
                <div className="space-y-4">
                  <DetailRow
                    icon={<User size={16} />}
                    label="Worker"
                    value={dispatch.worker_username}
                  />
                  <DetailRow
                    icon={<Truck size={16} />}
                    label="Vehicle Number"
                    value={dispatch.vehicle_number}
                  />
                  <DetailRow
                    icon={<Package size={16} />}
                    label="Material"
                    value={getMaterialLabel(dispatch.material_type)}
                  />
                  <DetailRow
                    icon={<MapPin size={16} />}
                    label="Location"
                    value={dispatch.location_name || "Not recorded"}
                    sub={
                      dispatch.latitude && dispatch.longitude
                        ? `${dispatch.latitude.toFixed(4)}, ${dispatch.longitude.toFixed(4)}`
                        : undefined
                    }
                  />
                  <DetailRow
                    icon={<Clock size={16} />}
                    label="Submitted"
                    value={formatDateTime(dispatch.submitted_at)}
                  />
                </div>
              </div>

              <div className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-text-muted">
                    <CheckCircle2 size={16} />
                    <span className="text-sm font-medium">Status</span>
                  </div>
                  <span
                    className="text-[13px] font-bold px-4 py-2 rounded-full uppercase tracking-wide"
                    style={{
                      backgroundColor: getStatusColor(dispatch.status) + "20",
                      color: getStatusColor(dispatch.status),
                    }}
                  >
                    {dispatch.status}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  {STATUS_OPTIONS.find((s) => s.key === dispatch.status)?.hint}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={startEditing}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-[15px] font-bold transition-all cursor-pointer"
                >
                  <Pencil size={18} /> Edit Dispatch
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-danger-muted hover:bg-danger/20 text-danger text-[15px] font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Trash2 size={18} />
                  )}
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </>
          ) : (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveChanges();
                }}
                className="bg-surface border border-border rounded-2xl p-5 sm:p-6 space-y-5"
                aria-label="Edit dispatch"
              >
                <h2 className="text-[13px] font-bold text-text-muted uppercase tracking-[0.12em]">
                  Edit Dispatch
                </h2>

                <div>
                  <label
                    htmlFor="dispatch-vehicle"
                    className="block text-[12px] font-bold text-text-muted mb-2"
                  >
                    Vehicle Number <span className="text-danger">*</span>
                  </label>
                  <input
                    id="dispatch-vehicle"
                    type="text"
                    value={form.vehicle_number}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, vehicle_number: e.target.value }));
                      setFormError(null);
                    }}
                    aria-invalid={formError ? true : undefined}
                    aria-describedby={formError ? "dispatch-error" : undefined}
                    className={inputCls}
                  />
                </div>

                <fieldset>
                  <legend className="block text-[12px] font-bold text-text-muted mb-2">
                    Material Type
                  </legend>
                  <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Material type">
                    {MATERIAL_OPTIONS.map((opt) => (
                      <ChoiceChip
                        key={opt.key}
                        selected={form.material_type === opt.key}
                        onClick={() => setForm((p) => ({ ...p, material_type: opt.key }))}
                        label={opt.label}
                      />
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="block text-[12px] font-bold text-text-muted mb-1.5">
                    Status
                  </legend>
                  <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Status">
                    {STATUS_OPTIONS.map((opt) => (
                      <ChoiceChip
                        key={opt.key}
                        selected={form.status === opt.key}
                        onClick={() => setForm((p) => ({ ...p, status: opt.key }))}
                        label={opt.label}
                        hint={opt.hint}
                        color={getStatusColor(opt.key)}
                      />
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label
                    htmlFor="dispatch-location"
                    className="block text-[12px] font-bold text-text-muted mb-2"
                  >
                    Location Name
                  </label>
                  <input
                    id="dispatch-location"
                    type="text"
                    value={form.location_name}
                    onChange={(e) => setForm((p) => ({ ...p, location_name: e.target.value }))}
                    placeholder="Where the material was collected or delivered"
                    className={inputCls}
                  />
                  <p className="text-xs text-text-muted mt-1.5">
                    Optional. Leave empty if no location was captured.
                  </p>
                </div>

                {formError && (
                  <p
                    id="dispatch-error"
                    role="alert"
                    className="px-4 py-3 rounded-xl text-sm bg-danger-muted border border-danger/20 text-danger flex items-start gap-2"
                  >
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    {formError}
                  </p>
                )}
              </form>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-surface border border-border text-text-muted text-[15px] font-bold hover:bg-surface-hover transition-all cursor-pointer disabled:opacity-50"
                >
                  <X size={18} /> {dirty ? "Discard changes" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={saveChanges}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-[15px] font-bold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full-screen photo */}
      {showFullImage && dispatch.photo_url && (
        <ImageLightbox
          images={[
            {
              id: dispatch.id,
              url: dispatch.photo_url,
              label: `Dispatch photo — ${dispatch.vehicle_number} (${dispatch.worker_username})`,
            },
          ]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setShowFullImage(false)}
        />
      )}
    </div>
  );
}

/* ── Local pieces ───────────────────────────────────── */

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 text-sm text-text-muted hover:text-text transition-colors mb-6 cursor-pointer font-semibold"
    >
      <ArrowLeft size={18} /> Back to Dispatches
    </button>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-xs font-semibold text-text-muted uppercase tracking-wide">
        {icon}
        {label}
      </dt>
      <dd className="text-sm font-semibold text-text text-right">{value}</dd>
    </div>
  );
}

function ChoiceChip({
  selected,
  onClick,
  label,
  hint,
  color,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
  color?: string;
}) {
  const accent = color ?? "var(--color-primary)";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer border"
      style={
        selected
          ? { backgroundColor: `${accent}1f`, borderColor: `${accent}55`, color: accent }
          : {
              backgroundColor: "transparent",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }
      }
    >
      <span className="block text-[13px] font-bold">{label}</span>
      {hint && (
        <span className="block text-[11px] font-medium opacity-75 mt-0.5">{hint}</span>
      )}
    </button>
  );
}

function DetailRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-text-muted mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-text-muted font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-[15px] font-semibold text-text mt-0.5 break-words">{value}</p>
        {sub && <p className="text-[13px] text-text-muted mt-0.5 tabular-nums">{sub}</p>}
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
