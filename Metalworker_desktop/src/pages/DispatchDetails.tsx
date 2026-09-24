// src/pages/DispatchDetails.tsx

import { useEffect, useState } from "react";
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
  Edit3,
  Trash2,
  Save,
  X,
  ImageOff,
} from "lucide-react";
import {
  fetchDispatchById,
  updateDispatch,
  deleteDispatch,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import type { Dispatch, DispatchStatus, MaterialType, UpdateDispatchInput } from "../types/dispatch";

export default function DispatchDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Edit state
  const [editVehicleNumber, setEditVehicleNumber] = useState("");
  const [editMaterialType, setEditMaterialType] = useState<MaterialType>("scrap");
  const [editLocationName, setEditLocationName] = useState("");
  const [editStatus, setEditStatus] = useState<DispatchStatus>("submitted");

  // Image preview
  const [showFullImage, setShowFullImage] = useState(false);

  useEffect(() => {
    if (id) loadDispatch();
  }, [id]);

  async function loadDispatch() {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetchDispatchById(id);
      if (res.ok && res.data) {
        setDispatch(res.data);
        setEditVehicleNumber(res.data.vehicle_number);
        setEditMaterialType(res.data.material_type);
        setEditLocationName(res.data.location_name || "");
        setEditStatus(res.data.status);
      } else {
        setError(res.error || "Failed to load dispatch");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dispatch");
    } finally {
      setLoading(false);
    }
  }

  function cancelEditing() {
    if (dispatch) {
      setEditVehicleNumber(dispatch.vehicle_number);
      setEditMaterialType(dispatch.material_type);
      setEditLocationName(dispatch.location_name || "");
      setEditStatus(dispatch.status);
    }
    setIsEditing(false);
  }

  async function saveChanges() {
    if (!dispatch || !id) return;
    const trimmedVehicle = editVehicleNumber.trim();
    if (!trimmedVehicle) {
      window.alert("Vehicle number is required");
      return;
    }

    try {
      setSaving(true);
      const updateData: UpdateDispatchInput = {
        vehicle_number: trimmedVehicle,
        material_type: editMaterialType,
        location_name: editLocationName.trim() || null,
        status: editStatus,
      };
      const res = await updateDispatch(id, updateData);
      if (res.ok) {
        setIsEditing(false);
        loadDispatch();
      } else {
        window.alert(res.error || "Failed to update dispatch");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update dispatch");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!id) return;
    const confirmed = window.confirm(
      "Are you sure you want to delete this dispatch? This action cannot be undone."
    );
    if (!confirmed) return;

    try {
      setDeleting(true);
      const res = await deleteDispatch(id);
      if (res.ok) {
        navigate("/dispatches", { replace: true });
      } else {
        window.alert(res.error || "Failed to delete dispatch");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete dispatch");
    } finally {
      setDeleting(false);
    }
  }

  const materialOptions: { key: MaterialType; label: string }[] = [
    { key: "scrap", label: "Scrap" },
    { key: "ferrous", label: "Ferrous Metal" },
    { key: "non_ferrous", label: "Non-Ferrous" },
    { key: "other", label: "Other" },
  ];

  const statusOptions: { key: DispatchStatus; label: string }[] = [
    { key: "submitted", label: "Submitted" },
    { key: "reviewed", label: "Reviewed" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="text-primary animate-spin" />
      </div>
    );
  }

  if (error || !dispatch) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <AlertTriangle size={40} className="text-danger mb-3" />
        <p className="text-sm text-text-muted mb-4">{error || "Dispatch not found"}</p>
        <div className="flex gap-2">
          <button onClick={loadDispatch} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold cursor-pointer">Retry</button>
          <button onClick={() => navigate("/dispatches")} className="px-4 py-2 rounded-lg bg-surface border border-border text-sm text-text-muted cursor-pointer">Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl">
      {/* Back button */}
      <button onClick={() => navigate("/dispatches")}
        className="flex items-center gap-2.5 text-[14px] text-text-muted hover:text-text transition-colors mb-8 cursor-pointer font-medium">
        <ArrowLeft size={18} /> Back to Dispatches
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Photo — left column */}
        <div className="lg:col-span-2">
          {dispatch.photo_url ? (
            <div className="relative group">
              <img
                src={dispatch.photo_url}
                alt="Dispatch photo"
                className="w-full rounded-xl border border-border object-cover cursor-pointer hover:opacity-90 transition-opacity"
                style={{ maxHeight: 400 }}
                onClick={() => setShowFullImage(true)}
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-xl transition-colors pointer-events-none" />
            </div>
          ) : (
            <div className="w-full h-64 rounded-xl border border-border bg-surface flex flex-col items-center justify-center text-text-muted">
              <ImageOff size={32} className="mb-2 opacity-30" />
              <p className="text-sm">No photo available</p>
            </div>
          )}
        </div>

        {/* Details — right column */}
        <div className="lg:col-span-3 space-y-4">
          {!isEditing ? (
            <>
              {/* View Mode */}
              <div className="bg-surface border border-border rounded-2xl p-7 space-y-5">
                <h3 className="text-[13px] font-bold text-text-muted uppercase tracking-[0.12em]">
                  Dispatch Information
                </h3>

                <div className="space-y-4">
                  <DetailRow icon={<User size={16} />} label="Worker" value={dispatch.worker_username} />
                  <DetailRow icon={<Truck size={16} />} label="Vehicle Number" value={dispatch.vehicle_number} />
                  <DetailRow icon={<Package size={16} />} label="Material" value={getMaterialLabel(dispatch.material_type)} />
                  <DetailRow icon={<MapPin size={16} />} label="Location"
                    value={dispatch.location_name || "Unknown"}
                    sub={dispatch.latitude && dispatch.longitude
                      ? `${dispatch.latitude.toFixed(4)}, ${dispatch.longitude.toFixed(4)}`
                      : undefined
                    }
                  />
                  <DetailRow icon={<Clock size={16} />} label="Submitted" value={new Date(dispatch.submitted_at).toLocaleString()} />
                </div>
              </div>

              {/* Status */}
              <div className="bg-surface border border-border rounded-2xl p-7">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-text-muted">
                    <CheckCircle2 size={16} />
                    <span className="text-[14px] font-medium">Status</span>
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
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={() => setIsEditing(true)}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-[15px] font-bold transition-all cursor-pointer">
                  <Edit3 size={18} /> Edit Dispatch
                </button>
                <button onClick={confirmDelete} disabled={deleting}
                  className="flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-danger-muted hover:bg-danger/20 text-danger text-[15px] font-bold transition-all cursor-pointer disabled:opacity-50">
                  <Trash2 size={18} /> {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Edit Mode */}
              <div className="bg-surface border border-border rounded-2xl p-7 space-y-5">
                <h3 className="text-[13px] font-bold text-text-muted uppercase tracking-[0.12em]">
                  Edit Dispatch
                </h3>

                <div>
                  <label className="block text-[12px] font-bold text-text-muted mb-2">Vehicle Number *</label>
                  <input type="text" value={editVehicleNumber} onChange={(e) => setEditVehicleNumber(e.target.value)}
                    className="w-full px-5 py-3.5 rounded-xl bg-bg border border-border text-[15px] text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-text-muted mb-2">Material Type</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {materialOptions.map((opt) => (
                      <button key={opt.key} onClick={() => setEditMaterialType(opt.key)}
                        className={`py-2.5 rounded-xl text-[13px] font-bold transition-all cursor-pointer border ${
                          editMaterialType === opt.key
                            ? "bg-primary-muted border-primary/30 text-primary"
                            : "bg-surface border-border text-text-muted hover:bg-surface-hover"
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-text-muted mb-2">Status</label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {statusOptions.map((opt) => {
                      const color = getStatusColor(opt.key);
                      return (
                        <button key={opt.key} onClick={() => setEditStatus(opt.key)}
                          className="py-2.5 rounded-xl text-[13px] font-bold transition-all cursor-pointer border"
                          style={
                            editStatus === opt.key
                              ? { backgroundColor: color + "20", borderColor: color + "40", color }
                              : { backgroundColor: "transparent", borderColor: "var(--color-border)", color: "var(--color-text-muted)" }
                          }>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-text-muted mb-2">Location Name</label>
                  <input type="text" value={editLocationName} onChange={(e) => setEditLocationName(e.target.value)}
                    placeholder="Enter location name"
                    className="w-full px-5 py-3.5 rounded-xl bg-bg border border-border text-[15px] text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all" />
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={cancelEditing}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-surface border border-border text-text-muted text-[15px] font-bold hover:bg-surface-hover transition-all cursor-pointer">
                  <X size={18} /> Cancel
                </button>
                <button onClick={saveChanges} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-[15px] font-bold transition-all cursor-pointer disabled:opacity-50">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full-screen image overlay */}
      {showFullImage && dispatch.photo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setShowFullImage(false)}
        >
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors cursor-pointer">
            <X size={20} />
          </button>
          <img
            src={dispatch.photo_url}
            alt="Dispatch photo full size"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

/* ── DETAIL ROW COMPONENT ─────────────── */

function DetailRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-text-muted mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-text-muted font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-[15px] font-semibold text-text mt-0.5">{value}</p>
        {sub && <p className="text-[13px] text-text-muted mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
