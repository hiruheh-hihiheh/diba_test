// src/components/bills/LinkBillToJobsSheet.tsx
//
// SECTION I OF THE BILL CREATOR, ON A PHONE: LINK JOBS TO THE BILL BEING CREATED.
//
// NOT A SECOND RELATIONSHIP SYSTEM
//
// Every read and write here is `billJobConnections` against the existing
// `bill_job_connections` table, through the same SECURITY DEFINER functions the Bills
// list and the jobs screens use. If this sheet had its own insert, an admin would end up
// with links that one screen can see and another cannot, and no way to tell which is
// which. It is a dialog, not a feature.
//
// WHY TWO TABS AND NOT ONE LIST
//
// Labour jobs and with-material jobs have different job numbers and different vocabulary,
// and on a phone a combined list of both is a wall of text an admin has to read twice to
// find the six rows they were looking for. Each tab filters the SAME loaded set and has
// its own search box, but there is ONE selection set across both: switching tabs must not
// lose what was ticked, because the common case is three labour jobs and two
// with-material jobs linked in one go.
//
// WHY THE CALLER HAS TO HAVE A BILL FIRST
//
// A link points at a bill row. A draft that has never been saved has no id, so there is
// nothing to point at. The buttons that open this sheet are therefore disabled until the
// first autosave has happened, which is why they say so rather than failing when pressed.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { getBillConnections, linkJobsToBill } from "../../services/billJobConnections";
import { formatBillDate } from "../../services/billFormat";
import { fetchJobsPage } from "../../services/jobs";
import { notify } from "../../utils/notify";
import type { BillJobConnection } from "../../types/billJobConnections";
import { getJobTypeLabel, type Job, type JobType } from "../../types/job";

const PAGE_SIZE = 50;

const TABS: { type: JobType; label: string }[] = [
  { type: "labour", label: "Labour" },
  { type: "with_material", label: "With Material" },
];

export interface LinkBillToJobsSheetProps {
  visible: boolean;
  /** The draft's bill id. Always non-empty: the buttons are disabled until there is one. */
  billId: string;
  /** Named in the heading so the admin can see which invoice they are editing. */
  billLabel: string;
  /** Which tab opens first. Defaults to Labour. */
  initialTab?: JobType;
  onClose: () => void;
}

type Styles = ReturnType<typeof createStyles>;

export function LinkBillToJobsSheet(props: LinkBillToJobsSheetProps) {
  /* A shell that owns the open/close and NOTHING else.
     When `visible` goes false the body is unmounted, and when it comes back the body
     mounts fresh: tab, search and the picked set all start at their defaults again.
     That reset is the point, and it is a property of dropping the subtree rather than
     of remembering to clear each field in an effect — the effect version is exactly the
     bug where reopening links labour jobs the admin was not looking at any more. */
  if (!props.visible || !props.billId) return null;
  return <LinkBillToJobsSheetBody key={`${props.billId}`} {...props} />;
}

function LinkBillToJobsSheetBody({
  billId,
  billLabel,
  initialTab = "labour",
  onClose,
}: LinkBillToJobsSheetProps) {
  const { theme } = useTheme();
  const styles: Styles = useMemo(() => createStyles(theme), [theme]);

  /* Initial state per open. There is deliberately no "reset everything" effect: this
     render IS the reset. */
  const [tab, setTab] = useState<JobType>(initialTab);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [already, setAlready] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* One query for both types rather than one per tab, so switching tabs is instant and
     the already-linked set is known before anything is ticked — which is what lets a
     row that is already linked render as such instead of failing on submit.
     `loading` starts true and every setState sits behind an `await` or a `.then`, which
     is the same rule the Bill Creator pages follow: no synchronous setState in an
     effect, because a re-render round-trips mid-mount for nothing. */
  useEffect(() => {
    let live = true;
    Promise.all([fetchJobsOfBothTypes(), getBillConnections(billId)])
      .then(([all, connections]: [Job[], BillJobConnection[]]) => {
        if (!live) return;
        setJobs(all);
        setAlready(new Set(connections.map((connection) => connection.job_id)));
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load jobs.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [billId]);

  const visibleJobs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return jobs
      .filter((job) => job.job_type === tab)
      .filter((job) => {
        if (needle === "") return true;
        return [job.job_no, job.tool_description, job.tool_part, job.quantity]
          .filter((v): v is string => typeof v === "string")
          .some((v) => v.toLowerCase().includes(needle));
      });
  }, [jobs, tab, search]);

  const toggle = useCallback((id: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (picked.size === 0) return;
    setSaving(true);
    try {
      const result = await linkJobsToBill(billId, [...picked]);
      notify(
        "Linked",
        result.linked === 0
          ? `All ${result.alreadyLinked} were already linked to this bill.`
          : `${result.linked} job${result.linked === 1 ? "" : "s"} linked${
              result.alreadyLinked > 0 ? `, ${result.alreadyLinked} already were` : ""
            }.`
      );
      setPicked(new Set());
      onClose();
    } catch (err) {
      notify(
        "Not linked",
        err instanceof Error ? err.message : "The jobs could not be linked to this bill."
      );
    } finally {
      setSaving(false);
    }
  }, [billId, picked, onClose]);

  /* The shell guarantees `billId` is non-empty; the guard is kept so the body cannot
     render half-open even if a future caller stops routing through the shell. */
  if (!billId) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.headerAction}>Close</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Link jobs to {billLabel}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.tabs}>
          {TABS.map((entry) => {
            const active = entry.type === tab;
            return (
              <Pressable
                key={entry.type}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setTab(entry.type)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {entry.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${getJobTypeLabel(tab).toLowerCase()} jobs`}
          placeholderTextColor={theme.colors.textMuted}
          autoCorrect={false}
        />

        {loading ? (
          <ActivityIndicator color={theme.colors.primary} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <FlatList
            data={visibleJobs}
            keyExtractor={(job) => job.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No jobs match.</Text>}
            renderItem={({ item }) => {
              const linked = already.has(item.id);
              const on = picked.has(item.id);
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => !linked && toggle(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: linked }}
                >
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on && <Text style={styles.boxTick}>✓</Text>}
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{item.job_no || "No job number"}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[item.tool_description, item.tool_part, item.quantity]
                        .filter(Boolean)
                        .join(" · ") || "No description"}
                    </Text>
                    <Text style={styles.rowMuted}>
                      {item.job_given_date ? formatBillDate(item.job_given_date) : "No date"}
                    </Text>
                  </View>
                  {linked && <Text style={styles.linkedTag}>Linked</Text>}
                </Pressable>
              );
            }}
          />
        )}

        <View style={styles.footer}>
          <Text style={styles.footerCount}>
            {picked.size === 0
              ? "Tick the jobs to link."
              : `${picked.size} selected`}
          </Text>
          <Pressable
            style={[styles.primaryBtn, picked.size === 0 && styles.btnOff]}
            onPress={() => void save()}
            disabled={picked.size === 0 || saving}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>
              {saving ? "Linking…" : "Link jobs"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Every job of one type, for the picker.
 *
 * A local function rather than a change to `jobs.ts` because this is the only place in
 * the app that needs both kinds at once, and adding a two-type fetch to the shared
 * service would be a generalisation with exactly one caller.
 */
async function fetchJobsOfBothTypes(): Promise<Job[]> {
  const [labour, withMaterial] = await Promise.all([
    fetchJobsPage("labour", { pageSize: PAGE_SIZE }),
    fetchJobsPage("with_material", { pageSize: PAGE_SIZE }),
  ]);
  return [...labour.items, ...withMaterial.items];
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerTitle: {
      flex: 1,
      textAlign: "center",
      color: c.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    headerAction: { color: c.primary, fontSize: theme.textSizes.sm, fontWeight: "600" },
    headerSpacer: { width: 44 },
    tabs: {
      flexDirection: "row",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
    },
    tab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
    },
    tabActive: { backgroundColor: c.primaryMuted, borderColor: c.primary },
    tabText: { color: c.textSecondary, fontSize: theme.textSizes.sm, fontWeight: "700" },
    tabTextActive: { color: c.primary },
    search: {
      margin: theme.spacing.md,
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 10,
      color: c.text,
      fontSize: theme.textSizes.sm,
    },
    spinner: { marginTop: theme.spacing.lg },
    error: { color: c.danger, fontSize: theme.textSizes.sm, paddingHorizontal: theme.spacing.md },
    empty: {
      color: c.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      paddingVertical: theme.spacing.lg,
    },
    list: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.lg },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: c.primary, borderColor: c.primary },
    boxTick: { color: c.primaryButtonText, fontSize: 13, fontWeight: "900" },
    rowMain: { flex: 1 },
    rowTitle: { color: c.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    rowSub: { color: c.textSecondary, fontSize: theme.textSizes.xs },
    rowMuted: { color: c.textMuted, fontSize: theme.textSizes.xs },
    linkedTag: { color: c.success, fontSize: theme.textSizes.xs, fontWeight: "700" },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    footerCount: { flex: 1, color: c.textMuted, fontSize: theme.textSizes.xs },
    primaryBtn: {
      backgroundColor: c.primary,
      borderRadius: theme.radius.md,
      paddingVertical: 12,
      paddingHorizontal: theme.spacing.md,
    },
    btnOff: { opacity: 0.4 },
    primaryBtnText: {
      color: c.primaryButtonText,
      fontWeight: "800",
      fontSize: theme.textSizes.sm,
    },
  });
}