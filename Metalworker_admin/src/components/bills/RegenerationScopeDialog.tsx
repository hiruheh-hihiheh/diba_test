// src/components/bills/RegenerationScopeDialog.tsx
//
// "Regenerate PDFs" → choose exactly which workbooks.
//
// The list comes from the Edge Function (`list_workbooks`), which is also what
// validates the selection when the job starts, so the eligibility shown here and
// the eligibility enforced there are the same rule. "Select all" selects every
// eligible workbook in the full list — never just the rows a search is showing.
// Standalone Bill Creator bills are a separate, unticked option: choosing
// workbooks never pulls them in silently.

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { listRegenerationWorkbooks } from "../../services/regenerateBillPdfs";
import {
  buildScope,
  eligibleCount,
  filterWorkbookOptions,
  selectAllEligible,
  selectionLabel,
  toggleWorkbook,
  type RegenerationScope,
  type WorkbookOption,
} from "../../services/regenerationModel";
import { Icon } from "../ui/Icon";
import { SearchBar } from "../ui/SearchBar";

interface Props {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (scope: RegenerationScope) => void;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function RegenerationScopeDialog({ visible, onCancel, onConfirm }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [options, setOptions] = useState<WorkbookOption[] | null>(null);
  const [standaloneCount, setStandaloneCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [includeStandalone, setIncludeStandalone] = useState(false);

  // The parent mounts this only while open, so every opening starts with a fresh
  // list and an empty selection.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    listRegenerationWorkbooks()
      .then((res) => {
        if (!alive) return;
        setOptions(res.workbooks);
        setStandaloneCount(res.standalone_count);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [visible]);

  const all = useMemo(() => options ?? [], [options]);
  const shown = useMemo(() => filterWorkbookOptions(all, query), [all, query]);
  const scope = buildScope(selected, all, includeStandalone);
  const eligible = eligibleCount(all);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>Regenerate PDFs</Text>
          <Text style={styles.subtitle}>
            Choose the workbooks to rebuild from their saved bill records. No Excel file is uploaded again, and each
            workbook&apos;s combined PDFs are only replaced once all three new copies are verified.
          </Text>

          {error ? (
            <View style={[styles.notice, { backgroundColor: theme.colors.dangerMuted }]}>
              <Icon name="alert" size={14} color={theme.colors.danger} />
              <Text style={styles.noticeText}>{error}</Text>
            </View>
          ) : !options ? (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={styles.meta}>Loading workbooks…</Text>
            </View>
          ) : (
            <>
              <SearchBar
                value={query}
                onChangeText={setQuery}
                placeholder="Search by filename"
                accessibilityLabel="Search workbooks by filename"
                autoCapitalize="none"
              />
              <View style={styles.controls}>
                <Text style={styles.counter} accessibilityLiveRegion="polite">
                  {selectionLabel(selected, all)}
                </Text>
                <View style={styles.controlButtons}>
                  <Pressable
                    onPress={() => setSelected(selectAllEligible(all))}
                    disabled={eligible === 0}
                    accessibilityRole="button"
                    accessibilityLabel={`Select all ${eligible} eligible workbooks`}
                    style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                  >
                    <Text style={styles.linkText}>Select all workbooks</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSelected(new Set())}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                  >
                    <Text style={styles.linkText}>Deselect all</Text>
                  </Pressable>
                </View>
              </View>
              {query.trim() !== "" && (
                <Text style={styles.meta}>
                  Showing {shown.length} of {all.length}. &quot;Select all workbooks&quot; still selects every eligible workbook.
                </Text>
              )}

              <FlatList
                data={shown}
                keyExtractor={(o) => o.upload_id}
                style={styles.list}
                ListEmptyComponent={
                  <Text style={[styles.meta, styles.empty]}>
                    {all.length === 0 ? "No Excel workbooks have been uploaded." : "No workbook matches that search."}
                  </Text>
                }
                renderItem={({ item }) => {
                  const checked = selected.has(item.upload_id);
                  const date = formatDate(item.uploaded_at);
                  return (
                    <Pressable
                      onPress={() => setSelected((s) => toggleWorkbook(s, item))}
                      disabled={!item.eligible}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked, disabled: !item.eligible }}
                      accessibilityLabel={item.name}
                      style={({ pressed }) => [styles.row, !item.eligible && styles.rowDisabled, pressed && styles.pressed]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          checked && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                        ]}
                      >
                        {checked && <Icon name="check" size={13} color={theme.colors.primaryButtonText} />}
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.meta} numberOfLines={2}>
                          {[`${item.bill_count} ${item.bill_count === 1 ? "bill" : "bills"}`, date ? `uploaded ${date}` : null, item.eligible && !item.has_combined_pdfs ? "no combined PDFs yet" : null]
                            .filter(Boolean)
                            .join(" · ")}
                          {!item.eligible && item.ineligible_reason ? `\nNot eligible: ${item.ineligible_reason}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  );
                }}
              />

              {standaloneCount > 0 && (
                <Pressable
                  onPress={() => setIncludeStandalone((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: includeStandalone }}
                  style={({ pressed }) => [styles.row, styles.standalone, pressed && styles.pressed]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      includeStandalone && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                    ]}
                  >
                    {includeStandalone && <Icon name="check" size={13} color={theme.colors.primaryButtonText} />}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>
                      Also regenerate {standaloneCount} standalone {standaloneCount === 1 ? "bill" : "bills"}
                    </Text>
                    <Text style={styles.meta}>Bills made in Bill Creator, which belong to no workbook. Not included unless ticked.</Text>
                  </View>
                </Pressable>
              )}
            </>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => scope && onConfirm(scope)}
              disabled={!scope}
              accessibilityRole="button"
              accessibilityState={{ disabled: !scope }}
              style={({ pressed }) => [styles.button, styles.confirm, !scope && styles.dimmed, pressed && styles.pressed]}
            >
              <Text style={styles.confirmText}>Regenerate selected</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.md,
    },
    card: {
      width: "100%",
      maxWidth: 560,
      maxHeight: "92%",
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 20,
      gap: theme.spacing.sm,
      ...theme.elevation.overlay,
    },
    title: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "700" },
    subtitle: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, lineHeight: 19 },
    loading: { alignItems: "center", gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
    notice: { flexDirection: "row", gap: 8, padding: 10, borderRadius: theme.radius.sm },
    noticeText: { flex: 1, color: theme.colors.text, fontSize: theme.textSizes.sm },
    controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
    controlButtons: { flexDirection: "row", gap: 4 },
    counter: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700", fontVariant: ["tabular-nums"] },
    link: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: theme.radius.sm },
    linkText: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "600" },
    list: {
      flexGrow: 0,
      maxHeight: 340,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
    },
    empty: { padding: theme.spacing.md, textAlign: "center" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowDisabled: { opacity: 0.5 },
    standalone: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600" },
    meta: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, lineHeight: 17 },
    actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    button: { flex: 1, minHeight: 46, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
    cancel: { borderWidth: 1, borderColor: theme.colors.borderStrong },
    cancelText: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "600" },
    confirm: { backgroundColor: theme.colors.primary },
    confirmText: { color: theme.colors.primaryButtonText, fontSize: theme.textSizes.md, fontWeight: "700" },
    dimmed: { opacity: 0.45 },
    pressed: { opacity: 0.82 },
  });
}
