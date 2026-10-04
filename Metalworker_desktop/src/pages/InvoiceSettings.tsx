// src/pages/InvoiceSettings.tsx
// The Invoice Business Profile: the company's standing invoice defaults, set once.
//
// WHAT THIS SCREEN IS FOR
// A workbook carries what is specific to one invoice - who it is billed to, what was
// supplied, the amounts. It should not have to carry what is the same on every invoice
// the company ever issues: the company name, the office address, the bank block, the
// standard terms, the wording under the signatures. That is what lives here. Once it
// is set, a workbook only needs the bill-specific data and the rest fills in.
//
// THE ONE RULE, AND WHY THIS SCREEN NEVER OVERRIDES IT
//   a bill's own value wins, then this profile, then nothing is printed.
//
// This screen therefore has no control that could force a profile value onto an
// invoice. It cannot mark a field "always use this", and there is no "apply to all
// existing bills" button - deliberately. A setting that silently restated invoices
// which had already been issued is how a company ends up contradicting a document a
// customer already has.
//
// WHAT HAPPENS TO INVOICES THAT ALREADY EXIST
// Nothing. A PDF in storage is an artifact: saving here does not touch it, and there is
// no re-print. Nor does it change what a later re-print of an old invoice produces -
// each bill records the defaults that produced its own documents, and a re-print reads
// those back rather than reading this screen. An invoice printed with a 40-day window
// keeps saying 40 days however this form is edited afterwards. The screen says so on
// its face, because "will this change my old invoices?" is the first question anyone
// has when they see a settings page for invoices.
//
// SAFE TO HALF-FILL
// Nothing here is required. A company with no MSME number leaves it blank, and blank
// is stored as "not configured" rather than as an empty string, so it is distinct from
// a value that was typed and then cleared.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Loader2, RotateCcw, Save } from "lucide-react";

import {
  fetchInvoiceBusinessProfile,
  saveInvoiceBusinessProfile,
} from "../services/invoiceBusinessProfile";
import {
  emptyProfileForm,
  fieldsFromForm,
  formFromProfile,
  validateProfileForm,
  type InvoiceBusinessProfile,
  type InvoiceBusinessProfileForm,
  type ProfileFieldErrors,
  type ProfileFieldKey,
} from "../types/invoiceBusinessProfile";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useToast } from "../components/ui/Toast";
import { ErrorState } from "../components/ui/LoadingState";

/** The variables a stored string may use. Kept in step with the server's list. */
const TEMPLATE_VARIABLES = ["PAYMENT_DAYS", "COMPANY_NAME"] as const;

type TemplateValues = {
  PAYMENT_DAYS: number | null;
  COMPANY_NAME: string | null;
};

/**
 * Fill the supported variables, for preview only.
 *
 * The authoritative implementation is
 * `supabase/functions/process-bill-upload/_shared/businessProfile.ts` -> fillTemplate();
 * that is the one that decides what a PDF prints. This is a duplicate because the two
 * apps bundle separately and cannot import from the Edge Function folder, and a
 * settings screen that showed the raw `{PAYMENT_DAYS}` would be useless.
 *
 * The rule matches: an unsupported variable, or a supported one with no value, is LEFT
 * AS TYPED. Substituting an empty string would preview "Payment requested within  DAYS",
 * which is not a sentence anyone can pay by - and seeing exactly that broken sentence is
 * the clearest signal the window is missing.
 */
function previewTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{([A-Z_]+)\}/g, (whole, name: string) => {
    if (name !== "PAYMENT_DAYS" && name !== "COMPANY_NAME") return whole;
    const value = values[name];
    if (value === null || value === "") return whole;
    return String(value);
  });
}

interface FieldSpec {
  key: ProfileFieldKey;
  label: string;
  hint: string;
  textarea?: boolean;
  inputMode?: "text" | "email" | "tel" | "numeric";
  template?: boolean;
}

/** The fields, in display order, with the label and where each one ends up. */
const FIELDS: FieldSpec[] = [
  {
    key: "company_name",
    label: "Company name",
    hint: "The seller name in the header. A workbook's own name is used instead when it has one.",
  },
  {
    key: "business_description",
    label: "Business description",
    hint: "The line under the company name, e.g. what the company does.",
  },
  {
    key: "gst_number",
    label: "GST number",
    hint: 'Printed as "GST No.…". Only used when the workbook printed no tax line of its own.',
  },
  {
    key: "msme_number",
    label: "MSME / Udyam number",
    hint: "Printed after the GST number on the same tax line.",
  },
  {
    key: "office_address",
    label: "Office address",
    hint: "The seller's address block in the header.",
    textarea: true,
  },
  { key: "email_1", label: "Email 1", hint: "", inputMode: "email" },
  { key: "email_2", label: "Email 2", hint: "", inputMode: "email" },
  { key: "mobile_1", label: "Mobile 1", hint: "", inputMode: "tel" },
  { key: "mobile_2", label: "Mobile 2", hint: "", inputMode: "tel" },
  {
    key: "bank_name",
    label: "Bank name",
    hint: "The bank block. Each part fills in only where the workbook left that part blank.",
  },
  { key: "bank_branch", label: "Branch", hint: "" },
  { key: "bank_ifsc", label: "IFSC code", hint: "" },
  { key: "bank_account_number", label: "Account number", hint: "" },
  {
    key: "payment_days",
    label: "Payment window (days)",
    hint: "Substituted for {PAYMENT_DAYS}. Leave blank if your terms do not state one.",
    inputMode: "numeric",
  },
  {
    key: "term_1",
    label: "Term 1",
    hint: "Used only when the workbook printed no terms at all. {PAYMENT_DAYS} and {COMPANY_NAME} work here.",
    textarea: true,
    template: true,
  },
  { key: "term_2", label: "Term 2", hint: "", textarea: true, template: true },
  { key: "term_3", label: "Term 3", hint: "", textarea: true, template: true },
  {
    key: "certification_text",
    label: "Certification line",
    hint: "The sentence above the signatures.",
    textarea: true,
    template: true,
  },
  {
    key: "authorized_signatory_text",
    label: "Signatory line",
    hint: 'The "For …" line. {COMPANY_NAME} works here.',
    textarea: true,
    template: true,
  },
  {
    key: "authorized_signatory_designation",
    label: "Designation",
    hint: "e.g. (Proprietor)",
  },
  {
    key: "receiver_signature_label",
    label: "Receiver signature",
    hint: "e.g. (Receivers Signature)",
  },
];

/**
 * A titled run of fields, so a twenty-one-field form is not one undifferentiated wall.
 *
 * Each group is defined by the LAST key it contains, and `FIELDS` above is already in
 * display order - so a group is the slice from the end of the previous one up to its own
 * `lastKey`. Slicing by position means a field added to `FIELDS` cannot be dropped by
 * forgetting to add it to a group: it lands in whichever slice covers its position.
 */
const GROUPS: { title: string; hint: string; lastKey: ProfileFieldKey }[] = [
  { title: "Company", hint: "Printed in the header of every invoice.", lastKey: "mobile_2" },
  {
    title: "Bank details",
    hint: "The bank block. Fills in only the parts a workbook left blank.",
    lastKey: "bank_account_number",
  },
  {
    title: "Terms",
    hint: "Used only when a workbook printed no terms of its own.",
    lastKey: "term_3",
  },
  {
    title: "Footer",
    hint: "The wording under the line items.",
    lastKey: "receiver_signature_label",
  },
];

function groupFields(fields: FieldSpec[]): { title: string; hint: string; fields: FieldSpec[] }[] {
  const out: { title: string; hint: string; fields: FieldSpec[] }[] = [];
  let cursor = 0;
  for (const group of GROUPS) {
    const end = fields.findIndex((f) => f.key === group.lastKey);
    if (end < cursor) continue;
    out.push({ title: group.title, hint: group.hint, fields: fields.slice(cursor, end + 1) });
    cursor = end + 1;
  }
  // Whatever the groups did not cover is appended rather than dropped, so a field added
  // to FIELDS without a group is still editable instead of invisible.
  if (cursor < fields.length) out.push({ title: "Other", hint: "", fields: fields.slice(cursor) });
  return out;
}

const inputCls =
  "w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary";

export default function InvoiceSettingsPage() {
  const toast = useToast();

  const [profile, setProfile] = useState<InvoiceBusinessProfile | null>(null);
  const [form, setForm] = useState<InvoiceBusinessProfileForm>(emptyProfileForm);
  const [errors, setErrors] = useState<ProfileFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Whether the form holds unsaved edits, as a ref as well as state.
   *
   * `load` is a `useCallback` with no dependencies and must still be able to read this
   * when the request comes back. A state value captured in that closure would be
   * whatever it was when the callback was created - always false - and the guard below
   * would never fire.
   */
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);

  const markEditing = useCallback((value: boolean) => {
    editingRef.current = value;
    setEditing(value);
  }, []);

  /** Apply a successful read to the screen. Shared by the mount and the retry. */
  const apply = useCallback(
    (loaded: InvoiceBusinessProfile | null) => {
      setProfile(loaded);
      setLoadError(null);
      setForm(formFromProfile(loaded));
      markEditing(false);
      setLoading(false);
      setLoadedOnce(true);
    },
    [markEditing]
  );

  /** The sentence shown when a read fails. */
  const describeError = (err: unknown): string =>
    err instanceof Error ? err.message : "The business profile could not be loaded.";

  /**
   * Re-read the profile, for the retry button after a failed load.
   *
   * This always shows a spinner, which is why the first load below does not go through
   * here: `loading` starts `true`, so there is nothing to show on mount, and going
   * through this path would set it a second time for no visible effect.
   */
  const load = useCallback(
    async () => {
      setLoading(true);
      try {
        apply(await fetchInvoiceBusinessProfile());
      } catch (err) {
        setLoadError(describeError(err));
        setLoading(false);
        setLoadedOnce(true);
      }
    },
    [apply]
  );

  /**
   * The first load, on mount.
   *
   * This page has no list to go stale, so it deliberately does NOT poll or refetch on
   * an interval the way the bill and logo lists do.
   *
   * The effect body only STARTS the fetch; every state change happens in its result
   * callbacks. That is what React asks for - the effect is starting work, not
   * synchronising with something already computed - and it means the read cannot
   * cascade a render during the commit.
   *
   * `live` is the part that is really about correctness rather than the rule. Without
   * it, an admin who opens this page on a slow connection and immediately navigates
   * away would have the response arrive after unmount and set state on a page that no
   * longer exists.
   */
  useEffect(() => {
    let live = true;
    void fetchInvoiceBusinessProfile().then(
      (loaded) => {
        if (live) apply(loaded);
      },
      (err: unknown) => {
        if (!live) return;
        setLoadError(describeError(err));
        setLoading(false);
        setLoadedOnce(true);
      }
    );
    return () => {
      live = false;
    };
  }, [apply]);

  const setField = useCallback(
    (key: ProfileFieldKey, value: string) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      markEditing(true);
      // Clear a field's error as soon as it is edited rather than waiting for the next
      // save attempt: the message is about the previous value and is now stale.
      setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    },
    [markEditing]
  );

  /** The values a template variable resolves to, from the form as typed. */
  const templateValues = useMemo<TemplateValues>(
    () => ({
      PAYMENT_DAYS: form.payment_days.trim() === "" ? null : Number(form.payment_days),
      COMPANY_NAME: form.company_name.trim() || null,
    }),
    [form.payment_days, form.company_name]
  );

  const onSave = useCallback(async () => {
    const found = validateProfileForm(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error({
        title: "Check the highlighted field",
        description: Object.values(found).filter(Boolean)[0],
      });
      return;
    }

    setSaving(true);
    try {
      const saved = await saveInvoiceBusinessProfile(fieldsFromForm(form), profile);
      setProfile(saved);
      setForm(formFromProfile(saved));
      markEditing(false);
      toast.success({
        title: "Business profile saved",
        description:
          "New and re-printed invoices will use these details. Invoices already issued keep what they printed.",
      });
    } catch (err) {
      toast.error({
        title: "The business profile was not saved",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }, [form, profile, markEditing, toast]);

  const onDiscard = useCallback(() => {
    setForm(formFromProfile(profile));
    setErrors({});
    markEditing(false);
  }, [profile, markEditing]);

  usePageMeta(
    {
      title: "Invoice Profile",
      crumbs: [{ label: "Documents" }, { label: "Bills" }, { label: "Profile" }],
      subtitle: "The company details every invoice carries",
    },
    []
  );

  const groups = useMemo(() => groupFields(FIELDS), []);

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      {/* The promise an admin needs before typing anything. */}
      <div className="rounded-xl border border-border bg-surface-raised p-4">
        <div className="flex items-start gap-2.5">
          <Building2 size={18} className="text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text">
              Invoices already issued are not affected
            </h2>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              Saving changes which invoices print these details from now on. It does not alter
              any PDF already generated, and re-printing an existing bill reproduces it as it
              was — including its payment window.
            </p>
          </div>
        </div>
      </div>

      {loadError && !loadedOnce && (
        <ErrorState message={loadError} onRetry={() => void load()} />
      )}

      {loading && !loadedOnce && (
        <div className="flex items-center justify-center gap-2.5 py-16 text-text-muted">
          <Loader2 size={20} className="animate-spin" />
          Loading the business profile…
        </div>
      )}

      {!loading && profile === null && loadError === null && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">Nothing configured yet</h2>
          <p className="text-xs text-text-muted mt-1">
            Until this is filled in, invoices print only what their own workbook supplies.
            Everything here is optional — save whatever applies.
          </p>
        </div>
      )}

      {!loading && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          {groups.map((group) => (
            <section key={group.title} className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-bold text-text">{group.title}</h2>
              {group.hint && <p className="text-xs text-text-muted mt-0.5">{group.hint}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-4">
                {group.fields.map((field) => {
                  const value = form[field.key];
                  const filled = previewTemplate(value, templateValues);
                  const showPreview = field.template === true && filled !== value;
                  const unresolved =
                    field.template === true && filled.includes("{") && filled !== value;

                  return (
                    <div
                      key={field.key}
                      className={
                        field.textarea || field.hint ? "sm:col-span-2 mb-4" : "mb-4"
                      }
                    >
                      <label
                        htmlFor={`profile-${field.key}`}
                        className="block text-xs font-medium text-text-secondary mb-1.5"
                      >
                        {field.label}
                      </label>

                      {field.textarea ? (
                        <textarea
                          id={`profile-${field.key}`}
                          value={value}
                          rows={3}
                          onChange={(e) => setField(field.key, e.target.value)}
                          className={inputCls}
                        />
                      ) : (
                        <input
                          id={`profile-${field.key}`}
                          type={field.inputMode === "email" ? "email" : "text"}
                          inputMode={field.inputMode}
                          value={value}
                          onChange={(e) => setField(field.key, e.target.value)}
                          className={inputCls}
                        />
                      )}

                      {field.hint && <p className="text-xs text-text-muted mt-1">{field.hint}</p>}

                      {errors[field.key] && (
                        <p
                          role="alert"
                          className="text-xs text-danger mt-1 font-medium"
                        >
                          {errors[field.key]}
                        </p>
                      )}

                      {showPreview && (
                        <div className="mt-2 rounded-lg border-l-2 border-primary bg-surface-raised px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-text-muted">
                            Prints as
                          </p>
                          <p className="text-xs text-text mt-0.5 leading-relaxed">{filled}</p>
                        </div>
                      )}

                      {unresolved && (
                        <p className="text-xs text-warning mt-1.5">
                          Still has something this screen cannot fill in — only{" "}
                          {TEMPLATE_VARIABLES.join(" and ")} are substituted, and only when they
                          have a value. Anything else is printed exactly as typed.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <div className="flex items-center gap-3 sticky bottom-4 self-start rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
            <button
              type="submit"
              disabled={saving || (!editing && profile !== null)}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? "Saving…" : "Save business profile"}
            </button>

            {editing && (
              <button
                type="button"
                onClick={onDiscard}
                className="px-4 py-2.5 rounded-xl border border-border text-text text-sm font-semibold hover:bg-surface-hover transition-all cursor-pointer flex items-center gap-2"
              >
                <RotateCcw size={16} />
                Discard
              </button>
            )}

            <span className="text-xs text-text-muted ml-1">
              {profile
                ? `Last saved ${new Date(
                    profile.updated_at ?? profile.created_at
                  ).toLocaleString()}`
                : "Not saved yet"}
            </span>
          </div>
        </form>
      )}
    </div>
  );
}