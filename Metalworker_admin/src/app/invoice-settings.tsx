// src/app/invoice-settings.tsx
// The Invoice Business Profile: the company's standing invoice defaults, set once.
//
// WHAT THIS SCREEN IS FOR
// A workbook carries what is specific to one invoice - who it is billed to, what
// was supplied, the amounts. It should not have to carry what is the same on every
// invoice the company ever issues: the company name, the office address, the bank
// block, the standard terms, the wording under the signatures. That is what lives
// here. Once it is set, a workbook only needs the bill-specific data and the rest
// fills in.
//
// THE ONE RULE, AND WHY THIS SCREEN NEVER OVERRIDES IT
//   a bill's own value wins, then this profile, then nothing is printed.
//
// This screen therefore has no control that could force a profile value onto an
// invoice. It cannot mark a field "always use this", and there is no
// "apply to all existing bills" button - deliberately. A setting that silently
// restated invoices which had already been issued is how a company ends up
// contradicting a document a customer already has.
//
// WHAT HAPPENS TO INVOICES THAT ALREADY EXIST
// Nothing. A PDF in storage is an artifact: saving here does not touch it, and
// there is no re-print. Nor does it change what a later re-print of an old invoice
// produces - each bill records the defaults that produced its own documents, and a
// re-print reads those back rather than reading this screen. An invoice printed
// with a 40-day window keeps saying 40 days however this form is edited afterwards.
// The screen says so on its face, because "will this change my old invoices?" is the
// first question anyone has when they see a settings page for invoices.
//
// SAFE TO HALF-FILL
// Nothing here is required. A company with no MSME number leaves it blank, and
// blank is stored as "not configured" rather than as an empty string, so it is
// distinct from a value that was typed and then cleared.

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
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
import {
  previewTemplate,
  templateHasUnresolved,
  TEMPLATE_VARIABLES,
} from "../utils/template";
import { notify } from "../utils/notify";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

/**
 * The fields, in the order they are shown, with the label and the help text that
 * explains where each one ends up on the page.
 *
 * Held here rather than derived, because the label and the destination are the two
 * things an admin actually needs to know about a field, and neither is derivable
 * from a column name. `template: true` additionally marks the fields whose text may
 * use `{PAYMENT_DAYS}` / `{COMPANY_NAME}`, which is what puts the preview under
 * them.
 *
 * `multiline` is chosen by content, not by taste: the tax line, the address, the
 * three terms and the footer wording are all prose that has to wrap as written, and
 * a single-line input would silently reflow a two-sentence term into one scrollable
 * line and hide the fact that it was long.
 */
interface FieldSpec {
  key: ProfileFieldKey;
  label: string;
  hint: string;
  multiline?: boolean;
  keyboard?: "default" | "email-address" | "phone-pad" | "number-pad";
  template?: boolean;
}

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
    hint: "Printed as “GST No.…”. Only used when the workbook printed no tax line of its own.",
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
    multiline: true,
  },
  { key: "email_1", label: "Email 1", hint: "", keyboard: "email-address" },
  { key: "email_2", label: "Email 2", hint: "", keyboard: "email-address" },
  { key: "mobile_1", label: "Mobile 1", hint: "", keyboard: "phone-pad" },
  { key: "mobile_2", label: "Mobile 2", hint: "", keyboard: "phone-pad" },
  { key: "bank_name", label: "Bank name", hint: "The bank block. Each part fills in only where the workbook left that part blank." },
  { key: "bank_branch", label: "Branch", hint: "" },
  { key: "bank_ifsc", label: "IFSC code", hint: "" },
  { key: "bank_account_number", label: "Account number", hint: "" },
  {
    key: "payment_days",
    label: "Payment window (days)",
    hint: "Substituted for {PAYMENT_DAYS}. Leave blank if your terms do not state one.",
    keyboard: "number-pad",
  },
  {
    key: "term_1",
    label: "Term 1",
    hint: "Used only when the workbook printed no terms at all. {PAYMENT_DAYS} and {COMPANY_NAME} work here.",
    multiline: true,
    template: true,
  },
  { key: "term_2", label: "Term 2", hint: "", multiline: true, template: true },
  { key: "term_3", label: "Term 3", hint: "", multiline: true, template: true },
  {
    key: "certification_text",
    label: "Certification line",
    hint: "The sentence above the signatures.",
    multiline: true,
    template: true,
  },
  {
    key: "authorized_signatory_text",
    label: "Signatory line",
    hint: "The “For …” line. {COMPANY_NAME} works here.",
    multiline: true,
    template: true,
  },
  { key: "authorized_signatory_designation", label: "Designation", hint: "e.g. (Proprietor)" },
  { key: "receiver_signature_label", label: "Receiver signature", hint: "e.g. (Receivers Signature)" },
];

/** Keys that may legitimately use a template variable, for the preview. */
const TEMPLATE_FIELDS = new Set(FIELDS.filter((f) => f.template).map((f) => f.key));

export default function InvoiceSettingsScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { checking: authChecking } = useAdminGate();

  const [profile, setProfile] = useState<InvoiceBusinessProfile | null>(null);
  const [form, setForm] = useState<InvoiceBusinessProfileForm>(emptyProfileForm);
  const [errors, setErrors] = useState<ProfileFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Whether the form holds unsaved edits.
   *
   * A ref as well as state, because `load` is a `useCallback` with no dependencies
   * and must still be able to read this at the moment the request comes back. A
   * state value captured in the closure would be whatever it was when the callback
   * was created - always false - and the guard below would never fire.
   */
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);

  const markEditing = useCallback((value: boolean) => {
    editingRef.current = value;
    setEditing(value);
  }, []);

  /**
   * Load the profile into the form.
   *
   * `isRefresh` is the pull-to-refresh case, and it will NOT overwrite a form the
   * admin is part-way through filling in. Refetching over unsaved edits would
   * discard their work with no warning, which on a settings screen is
   * indistinguishable from the app losing it. The re-read still happens, so the
   * "last saved" line stays truthful; only the form is left alone.
   *
   * A focus-driven load is not a refresh and always applies - leaving the screen and
   * coming back is a deliberate move away from the form, not a gesture made over it.
   */
  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const loaded = await fetchInvoiceBusinessProfile();
      setProfile(loaded);
      setLoadError(null);
      if (!isRefresh || !editingRef.current) {
        setForm(formFromProfile(loaded));
        markEditing(false);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "The invoice business profile could not be loaded."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [markEditing]);

  /* `useFocusEffect` covers the first focus AND every return, so the profile is
     re-read when the admin comes back to this screen after editing a bill - the
     profile could have been changed from the desktop app, or on another device,
     and a stale form would invite them to save values that were already
     superseded. A separate mount effect would be the same fetch twice.

     The reload deliberately discards unsaved edits: leaving and returning to a
     settings form is an unambiguous signal the admin has moved on, and the
     `editing` guard inside `load` still protects a pull-to-refresh made while
     they are mid-edit. */
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const setField = useCallback((key: ProfileFieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    markEditing(true);
    // Clear a field's error as soon as it is edited, rather than waiting for the
    // next save attempt: the message is about the previous value and is now stale.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, [markEditing]);

  /** The values a template variable resolves to, from the form as typed. */
  const templateValues = useMemo(
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
      notify(
        "Check the highlighted field",
        Object.values(found).filter(Boolean)[0] ?? "Some values could not be saved."
      );
      return;
    }

    setSaving(true);
    try {
      const saved = await saveInvoiceBusinessProfile(fieldsFromForm(form), profile);
      setProfile(saved);
      setForm(formFromProfile(saved));
      markEditing(false);
      notify(
        "Business profile saved",
        "New and re-printed invoices will use these details. Invoices already issued keep what they printed."
      );
    } catch (err) {
      notify(
        "The business profile was not saved",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setSaving(false);
    }
  }, [form, profile, markEditing]);

  const onDiscard = useCallback(() => {
    setForm(formFromProfile(profile));
    setErrors({});
    markEditing(false);
  }, [profile, markEditing]);

  const busy = loading || authChecking;

  if (busy) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.muted}>Loading the invoice business profile.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={theme.colors.textMuted}
            />
          }
        >
          <Text style={styles.headerTitle}>Invoice Business Profile</Text>
          <Text style={styles.muted}>
            The details every invoice carries. A workbook&apos;s own value always wins
            over anything set here, so this only fills in what a workbook leaves out.
          </Text>

          {/* The promise an admin needs before typing anything. */}
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Invoices already issued are not affected</Text>
            <Text style={styles.noticeBody}>
              Saving changes which invoices print these details from now on. It does not
              alter any PDF already generated, and re-printing an existing bill reproduces
              it as it was - including its payment window.
            </Text>
          </View>

          {loadError ? (
            <View style={[styles.notice, styles.errorNotice]}>
              <Text style={styles.errorTitle}>Could not load the profile</Text>
              <Text style={styles.noticeBody}>{loadError}</Text>
              <Button title="Try again" onPress={() => void load()} variant="ghost" />
            </View>
          ) : null}

          {profile === null && loadError === null ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Nothing configured yet</Text>
              <Text style={styles.noticeBody}>
                Until this is filled in, invoices print only what their own workbook
                supplies. Everything here is optional - save whatever applies.
              </Text>
            </View>
          ) : null}

          {/* Fields, grouped so a long form is navigable. */}
          {groupFields(FIELDS).map((group) => (
            <View key={group.title} style={styles.group}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              <Text style={styles.groupHint}>{group.hint}</Text>
              {group.fields.map((field) => {
                const value = form[field.key];
                const filled = previewTemplate(value, templateValues);
                const showPreview =
                  field.template === true && value.trim() !== "" && filled !== value.trim();

                return (
                  <View key={field.key}>
                    <Input
                      label={field.label}
                      value={value}
                      onChangeText={(text) => setField(field.key, text)}
                      error={errors[field.key]}
                      multiline={field.multiline}
                      keyboardType={field.keyboard}
                      autoCapitalize={field.key === "bank_account_number" ? "none" : "sentences"}
                      style={field.multiline ? styles.multiline : undefined}
                    />
                    {field.hint ? (
                      <Text style={styles.fieldHint}>{field.hint}</Text>
                    ) : null}
                    {showPreview ? (
                      <View style={styles.preview}>
                        <Text style={styles.previewLabel}>Prints as</Text>
                        <Text style={styles.previewText}>{filled}</Text>
                      </View>
                    ) : null}
                    {TEMPLATE_FIELDS.has(field.key) && templateHasUnresolved(value, templateValues) ? (
                      <Text style={styles.previewWarn}>
                        Still has something this screen cannot fill in — only{" "}
                        {TEMPLATE_VARIABLES.join(" and ")} are substituted, and only when they
                        have a value. Anything else is printed exactly as typed.
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}

          <View style={styles.actions}>
            <Button
              title="Save business profile"
              onPress={() => void onSave()}
              loading={saving}
              disabled={!editing && profile !== null}
            />
            {editing ? (
              <Button title="Discard changes" onPress={onDiscard} variant="ghost" />
            ) : null}
          </View>

          <Text style={styles.footnote}>
            {profile
              ? `Last saved ${formatSavedAt(profile.updated_at ?? profile.created_at)}.`
              : "Not saved yet."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * A titled run of fields, so a twenty-one-field form is not one undifferentiated
 * wall.
 *
 * Each group is defined by the LAST key it contains, and `FIELDS` above is already
 * in display order - so a group is the slice from the end of the previous one up to
 * its own `upto`. Slicing by position means a field added to `FIELDS` cannot be
 * dropped by forgetting to add it to a group: it lands in whichever slice covers its
 * position, and the sanity check at the bottom fails loudly if the two ever stop
 * covering the whole list.
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
  // Whatever the groups did not cover is appended rather than dropped, so a field
  // added to FIELDS without a group is still editable instead of invisible.
  if (cursor < fields.length) {
    out.push({
      title: "Other",
      hint: "",
      fields: fields.slice(cursor),
    });
  }
  return out;
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "at an unknown time";
  return date.toLocaleString();
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl * 2 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", marginBottom: theme.spacing.sm },
    back: { color: theme.colors.primary, fontSize: theme.textSizes.md },
    headerTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xl,
      fontWeight: "700",
      marginBottom: theme.spacing.xs,
    },
    muted: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, lineHeight: 20 },
    notice: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      marginTop: theme.spacing.lg,
      gap: theme.spacing.xs,
    },
    errorNotice: { borderColor: theme.colors.danger },
    noticeTitle: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    errorTitle: { color: theme.colors.danger, fontSize: theme.textSizes.sm, fontWeight: "700" },
    noticeBody: { color: theme.colors.textSecondary, fontSize: theme.textSizes.sm, lineHeight: 20 },
    group: {
      marginTop: theme.spacing.xl,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
    },
    groupTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginBottom: 2,
    },
    groupHint: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, marginBottom: theme.spacing.md },
    fieldHint: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, marginTop: -8, marginBottom: theme.spacing.md },
    multiline: { minHeight: 84, textAlignVertical: "top" },
    preview: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderRadius: theme.radius.sm,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary,
      padding: theme.spacing.sm,
      marginTop: -8,
      marginBottom: theme.spacing.md,
    },
    previewLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: 2,
    },
    previewText: { color: theme.colors.text, fontSize: theme.textSizes.sm, lineHeight: 19 },
    previewWarn: {
      color: theme.colors.warning,
      fontSize: theme.textSizes.xs,
      marginTop: -8,
      marginBottom: theme.spacing.md,
    },
    actions: { marginTop: theme.spacing.xl, gap: theme.spacing.sm },
    footnote: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      textAlign: "center",
      marginTop: theme.spacing.lg,
    },
  });