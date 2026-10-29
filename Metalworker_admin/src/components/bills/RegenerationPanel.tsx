// src/components/bills/RegenerationPanel.tsx
//
// The status panel for "Regenerate All PDFs".
//
// It sits inline on the Bills screen rather than as a blocking modal: regeneration
// can run for minutes, and the list underneath stays usable the whole time. The only
// thing locked while a job runs is the button that would start a second one.
//
// Every figure shown comes from the server's job record (`RegenerationView`). Where
// the server cannot count a step — preparing a workbook, saving the three files —
// the bar is indeterminate rather than a guessed percentage, and a workbook is only
// ever shown as finished once its combined PDFs have actually been swapped in.

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import type { RegenerationController } from "../../hooks/useRegeneration";
import {
  COPY_KINDS,
  COPY_NAMES,
  copyStateLabel,
  overallProgress,
  scopeLabel,
  problemWorkbooks,
  stageLabel,
  stageProgress,
  summarize,
  workbookPipeline,
  type CopyState,
  type Fraction,
  type StepState,
} from "../../services/regenerationModel";
import { Icon, type IconName } from "../ui/Icon";

interface Props {
  controller: RegenerationController;
}

export function RegenerationPanel({ controller }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [showDetails, setShowDetails] = useState(true);
  const { mode, view, wait, error, cancelling, attachedToExisting } = controller;

  if (mode === "idle") return null;

  const running = mode === "starting" || mode === "running";
  const finished = mode === "finished" && !!view && view.status !== "running";
  const summary = view ? summarize(view) : null;
  const toneColor = (tone: "success" | "warning" | "danger" | "neutral") =>
    tone === "success" ? theme.colors.success : tone === "warning" ? theme.colors.warning : tone === "danger" ? theme.colors.danger : theme.colors.textMuted;

  let title = "Regenerating PDFs";
  let subtitle = view ? stageLabel(view) : "Starting…";
  if (mode === "starting") subtitle = "Checking for a running job…";
  if (mode === "detached") {
    title = "Regeneration in progress";
    subtitle = view?.lease_active
      ? "Running in another window or session. Progress updates every few seconds."
      : "Paused — no window is advancing it. Resume to continue where it stopped.";
  }
  if (mode === "interrupted") {
    title = "Regeneration paused";
    subtitle = "Lost contact with the server. Nothing was lost: resume to continue from the last saved step.";
  }
  if (mode === "error") {
    title = "Regeneration problem";
    subtitle = error ?? "The request failed.";
  }
  if (finished && summary) {
    title = summary.title;
    subtitle = summary.detail;
  }

  const overall = view ? overallProgress(view) : null;
  const stage = view ? stageProgress(view) : null;
  const wb = view?.current_workbook ?? null;
  const problems = view ? problemWorkbooks(view) : [];

  return (
    <View style={styles.card} accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${subtitle}`}>
      <View style={styles.header}>
        {running || cancelling ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <View
            style={[
              styles.iconBubble,
              {
                backgroundColor: finished
                  ? summary?.tone === "success"
                    ? theme.colors.successMuted
                    : summary?.tone === "warning"
                      ? theme.colors.warningMuted
                      : summary?.tone === "danger"
                        ? theme.colors.dangerMuted
                        : theme.colors.surfaceSecondary
                  : mode === "error"
                    ? theme.colors.dangerMuted
                    : theme.colors.primaryMuted,
              },
            ]}
          >
            <Icon
              name={finished ? (summary?.tone === "success" ? "checkCircle" : summary?.tone === "neutral" ? "info" : "alert") : mode === "error" ? "alert" : "refresh"}
              size={16}
              color={finished && summary ? toneColor(summary.tone) : mode === "error" ? theme.colors.danger : theme.colors.primary}
            />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        {(mode === "detached" || mode === "interrupted" || (mode === "error" && view?.status === "running")) && (
          <PanelButton label="Resume" icon="refresh" primary onPress={controller.resume} styles={styles} theme={theme} disabled={cancelling} />
        )}
        {view?.status === "running" && mode !== "starting" && (
          <PanelButton label={cancelling ? "Stopping…" : "Stop"} icon="close" onPress={controller.cancel} styles={styles} theme={theme} disabled={cancelling} />
        )}
        {view && (
          <PanelButton
            label={showDetails ? "Hide details" : "Show details"}
            icon={showDetails ? "eyeOff" : "eye"}
            onPress={() => setShowDetails((v) => !v)}
            styles={styles}
            theme={theme}
          />
        )}
        {(finished || (mode === "error" && view?.status !== "running")) && (
          <PanelButton label="Close" icon="check" onPress={controller.dismiss} styles={styles} theme={theme} />
        )}
      </View>

      {wait && (
        <View style={[styles.notice, { backgroundColor: theme.colors.warningMuted }]}>
          <Icon name="info" size={14} color={theme.colors.warning} />
          <Text style={[styles.noticeText, { color: theme.colors.text }]}>{wait.message}</Text>
        </View>
      )}
      {error && mode !== "error" && (
        <View style={[styles.notice, { backgroundColor: theme.colors.dangerMuted }]}>
          <Icon name="alert" size={14} color={theme.colors.danger} />
          <Text style={[styles.noticeText, { color: theme.colors.text }]}>{error}</Text>
        </View>
      )}

      {attachedToExisting && view?.status === "running" && (
        <View style={[styles.notice, { backgroundColor: theme.colors.infoMuted }]}>
          <Icon name="info" size={14} color={theme.colors.info} />
          <Text style={[styles.noticeText, { color: theme.colors.text }]}>
            A regeneration was already running, so your selection was not applied. This is the running job and its own scope.
          </Text>
        </View>
      )}

      {view?.scope && (
        <View style={styles.scopeRow}>
          <Text style={styles.scopeText}>
            <Text style={styles.scopeStrong}>Scope: </Text>
            {scopeLabel(view)}
          </Text>
          {view.scope.workbooks_selected > 0 && (
            <Text style={styles.scopeText}>
              <Text style={styles.scopeStrong}>Completed: </Text>
              {view.workbooks_finished} of {view.scope.workbooks_selected} workbooks
            </Text>
          )}
        </View>
      )}

      {view && (
        <>
          <ProgressRow
            label="Overall"
            value={overall ? `${overall.done} of ${overall.total} items · ${overall.percent}%` : running ? "Working…" : "—"}
            fraction={overall}
            indeterminate={!overall && running}
            styles={styles}
            theme={theme}
          />

          {showDetails && wb && view.status === "running" && (
            <View style={styles.section}>
              <Text style={styles.overline}>
                Workbook {wb.position} of {view.workbooks_total}
              </Text>
              <Text style={styles.workbookName} numberOfLines={2}>
                {wb.name ?? "Loading workbook…"}
              </Text>

              <View style={styles.pipeline}>
                {workbookPipeline(view).map((step) => (
                  <StepChip key={step.key} label={step.label} state={step.state} styles={styles} theme={theme} />
                ))}
              </View>

              <ProgressRow
                label={stage?.label ?? stageLabel(view)}
                value={stage ? `${stage.done} of ${stage.total}` : "In progress"}
                fraction={stage}
                indeterminate={!stage}
                styles={styles}
                theme={theme}
              />

              {wb.bills_total > 0 && (
                <Text style={styles.meta}>
                  Bills: {wb.bills_done} of {wb.bills_total} processed · {wb.bills_succeeded} regenerated
                  {wb.bills_failed > 0 ? ` · ${wb.bills_failed} failed` : ""}
                </Text>
              )}

              <View style={styles.copies}>
                {COPY_KINDS.map((k) => (
                  <CopyChip
                    key={k}
                    label={COPY_NAMES[k]}
                    state={wb.copies[k].state}
                    detail={
                      wb.copies[k].state === "rendering" && wb.chunks_total > 0
                        ? `${wb.copies[k].chunks_rendered}/${wb.chunks_total} parts`
                        : copyStateLabel(wb.copies[k].state)
                    }
                    styles={styles}
                    theme={theme}
                  />
                ))}
              </View>

              {(wb.aggregate_blocked || wb.aggregate_failure) && (
                <View style={[styles.notice, { backgroundColor: wb.aggregate_failure ? theme.colors.dangerMuted : theme.colors.warningMuted }]}>
                  <Icon name="alert" size={14} color={wb.aggregate_failure ? theme.colors.danger : theme.colors.warning} />
                  <Text style={[styles.noticeText, { color: theme.colors.text }]}>
                    {(wb.aggregate_failure ?? wb.aggregate_blocked)?.message}
                  </Text>
                </View>
              )}
            </View>
          )}

          {showDetails && view.status === "running" && view.stage === "standalone_bills" && (
            <View style={styles.section}>
              <Text style={styles.overline}>Standalone bills (not from a workbook)</Text>
              <Text style={styles.meta}>
                {view.standalone.processed} of {view.standalone.total} processed · {view.standalone.succeeded} regenerated
                {view.standalone.failed > 0 ? ` · ${view.standalone.failed} failed` : ""}
              </Text>
            </View>
          )}

          {showDetails && view.scope && view.scope.workbooks.length > 1 && (
            <View style={styles.section}>
              <Text style={styles.overline}>Selected workbooks</Text>
              {view.scope.workbooks.slice(0, 12).map((w) => (
                <View key={w.upload_id} style={styles.problem}>
                  <Icon
                    name={w.status === "succeeded" ? "checkCircle" : w.status === "failed" ? "xCircle" : w.status === "partial" ? "alert" : w.status === "in_progress" ? "refresh" : "info"}
                    size={14}
                    color={
                      w.status === "succeeded"
                        ? theme.colors.success
                        : w.status === "failed"
                          ? theme.colors.danger
                          : w.status === "partial"
                            ? theme.colors.warning
                            : w.status === "in_progress"
                              ? theme.colors.primary
                              : theme.colors.textMuted
                    }
                  />
                  <Text style={[styles.problemTitle, styles.problemText]} numberOfLines={1}>
                    {w.name}
                  </Text>
                  <Text style={styles.meta}>{workbookStatusLabel(w.status)}</Text>
                </View>
              ))}
              {view.scope.workbooks.length > 12 && (
                <Text style={styles.meta}>…and {view.scope.workbooks.length - 12} more.</Text>
              )}
            </View>
          )}

          <View style={styles.stats}>
            <Stat label="Bills regenerated" value={view.counters.bills_succeeded} styles={styles} />
            <Stat label="Bills failed" value={view.counters.bills_failed} tone={view.counters.bills_failed > 0 ? theme.colors.danger : undefined} styles={styles} />
            <Stat label="Workbooks done" value={view.counters.aggregates_succeeded} styles={styles} />
            <Stat label="Workbooks failed" value={view.counters.aggregates_failed} tone={view.counters.aggregates_failed > 0 ? theme.colors.danger : undefined} styles={styles} />
          </View>

          {showDetails && (problems.length > 0 || view.bill_failures_total > 0) && (
            <View style={styles.section}>
              <Text style={styles.overline}>Needs attention</Text>
              {problems.slice(0, 6).map((r) => (
                <View key={r.upload_id} style={styles.problem}>
                  <Icon
                    name={r.status === "skipped" ? "info" : "alert"}
                    size={14}
                    color={r.status === "failed" ? theme.colors.danger : r.status === "partial" ? theme.colors.warning : theme.colors.textMuted}
                  />
                  <View style={styles.problemText}>
                    <Text style={styles.problemTitle} numberOfLines={1}>
                      {r.name} · {r.status === "failed" ? "combined PDFs not replaced" : r.status === "partial" ? "some bills failed" : "skipped"}
                    </Text>
                    {!!r.message && <Text style={styles.meta}>{r.message}</Text>}
                  </View>
                </View>
              ))}
              {problems.length > 6 && <Text style={styles.meta}>…and {problems.length - 6} more workbooks.</Text>}
              {view.bill_failures.slice(0, 5).map((f) => (
                <View key={f.bill_id} style={styles.problem}>
                  <Icon name="xCircle" size={14} color={theme.colors.danger} />
                  <View style={styles.problemText}>
                    <Text style={styles.problemTitle} numberOfLines={1}>
                      Bill {f.invoice_no ?? f.bill_id}
                      {f.workbook ? ` · ${f.workbook}` : " · standalone"}
                    </Text>
                    <Text style={styles.meta}>{f.message}</Text>
                  </View>
                </View>
              ))}
              {view.bill_failures_total > 5 && (
                <Text style={styles.meta}>…and {view.bill_failures_total - 5} more bills could not be regenerated.</Text>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

/* ──────────────────────────────────────────────
   Pieces
   ────────────────────────────────────────────── */

type Styles = ReturnType<typeof createStyles>;

function workbookStatusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "Done";
    case "partial":
      return "Done, some bills failed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "in_progress":
      return "In progress";
    default:
      return "Waiting";
  }
}

function PanelButton({
  label,
  icon,
  onPress,
  primary = false,
  disabled = false,
  styles,
  theme,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  styles: Styles;
  theme: AppTheme;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.panelButton,
        primary && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.55 },
      ]}
    >
      <Icon name={icon} size={14} color={primary ? theme.colors.primaryButtonText : theme.colors.text} />
      <Text style={[styles.panelButtonText, primary && { color: theme.colors.primaryButtonText }]}>{label}</Text>
    </Pressable>
  );
}

function ProgressRow({
  label,
  value,
  fraction,
  indeterminate,
  styles,
  theme,
}: {
  label: string;
  value: string;
  fraction: Fraction | null;
  indeterminate: boolean;
  styles: Styles;
  theme: AppTheme;
}) {
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressLabels}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>{value}</Text>
      </View>
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {indeterminate ? (
          <IndeterminateFill color={theme.colors.primary} />
        ) : (
          <View style={[styles.fill, { backgroundColor: theme.colors.primary, width: `${fraction?.percent ?? 0}%` }]} />
        )}
      </View>
    </View>
  );
}

/** A short segment sweeping the track: "working, amount unknown". Static under reduced motion. */
function IndeterminateFill({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1_300, easing: Easing.inOut(Easing.quad), useNativeDriver: false })
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, x]);
  const left = x.interpolate({ inputRange: [0, 1], outputRange: ["-35%", "100%"] });
  return (
    <Animated.View
      style={{ position: "absolute", top: 0, bottom: 0, width: "35%", borderRadius: 4, backgroundColor: color, opacity: 0.75, left: reduced ? "32%" : left }}
    />
  );
}

function stepColors(state: StepState, theme: AppTheme): { bg: string; fg: string; icon: IconName | null } {
  switch (state) {
    case "done":
      return { bg: theme.colors.successMuted, fg: theme.colors.success, icon: "check" };
    case "active":
      return { bg: theme.colors.primaryMuted, fg: theme.colors.primary, icon: null };
    case "failed":
      return { bg: theme.colors.dangerMuted, fg: theme.colors.danger, icon: "xCircle" };
    case "skipped":
      return { bg: theme.colors.warningMuted, fg: theme.colors.warning, icon: "info" };
    default:
      return { bg: theme.colors.surfaceSecondary, fg: theme.colors.textMuted, icon: null };
  }
}

function StepChip({ label, state, styles, theme }: { label: string; state: StepState; styles: Styles; theme: AppTheme }) {
  const c = stepColors(state, theme);
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]} accessibilityLabel={`${label}: ${state}`}>
      {state === "active" ? <ActivityIndicator size="small" color={c.fg} style={styles.chipSpinner} /> : c.icon ? <Icon name={c.icon} size={12} color={c.fg} /> : <View style={[styles.dot, { backgroundColor: c.fg }]} />}
      <Text style={[styles.chipText, { color: state === "pending" ? theme.colors.textMuted : theme.colors.text }]}>{label}</Text>
    </View>
  );
}

function CopyChip({ label, state, detail, styles, theme }: { label: string; state: CopyState; detail: string; styles: Styles; theme: AppTheme }) {
  const map: Record<CopyState, StepState> = { pending: "pending", rendering: "active", assembled: "done", published: "done", failed: "failed" };
  const c = stepColors(map[state], theme);
  return (
    <View style={[styles.copyChip, { borderColor: c.fg === theme.colors.textMuted ? theme.colors.border : c.fg }]} accessibilityLabel={`${label}: ${detail}`}>
      <Text style={styles.copyName}>{label}</Text>
      <Text style={[styles.copyDetail, { color: c.fg }]}>{detail}</Text>
    </View>
  );
}

function Stat({ label, value, tone, styles }: { label: string; value: number; tone?: string; styles: Styles }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    header: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm },
    headerText: { flex: 1, gap: 2 },
    iconBubble: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
    title: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "700" },
    subtitle: { color: theme.colors.textSecondary, fontSize: theme.textSizes.sm, lineHeight: 19 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs },
    panelButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 12,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    panelButtonText: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600" },
    notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: theme.radius.sm },
    noticeText: { flex: 1, fontSize: theme.textSizes.sm, lineHeight: 18 },
    progressRow: { gap: 6 },
    progressLabels: { flexDirection: "row", justifyContent: "space-between", gap: theme.spacing.sm },
    progressLabel: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600", flexShrink: 1 },
    progressValue: { color: theme.colors.textSecondary, fontSize: theme.textSizes.sm, fontVariant: ["tabular-nums"] },
    track: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: theme.colors.surfaceSecondary },
    fill: { height: "100%", borderRadius: 4 },
    section: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    overline: { color: theme.colors.textMuted, fontSize: theme.textSizes.caption, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
    workbookName: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "700" },
    pipeline: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: theme.radius.pill },
    chipSpinner: { transform: [{ scale: 0.6 }], width: 12, height: 12 },
    chipText: { fontSize: theme.textSizes.xs, fontWeight: "600" },
    dot: { width: 6, height: 6, borderRadius: 3, opacity: 0.6 },
    copies: { flexDirection: "row", gap: 6 },
    copyChip: { flex: 1, borderWidth: 1, borderRadius: theme.radius.sm, paddingVertical: 6, paddingHorizontal: 8, gap: 2 },
    copyName: { color: theme.colors.text, fontSize: theme.textSizes.xs, fontWeight: "700" },
    copyDetail: { fontSize: theme.textSizes.caption, fontWeight: "600" },
    meta: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, lineHeight: 17 },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
    scopeRow: { gap: 2 },
    scopeText: { color: theme.colors.textSecondary, fontSize: theme.textSizes.sm },
    scopeStrong: { color: theme.colors.text, fontWeight: "700" },
    stat: {
      flexGrow: 1,
      flexBasis: 120,
      backgroundColor: theme.colors.surfaceSecondary,
      borderRadius: theme.radius.sm,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    statValue: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "800", fontVariant: ["tabular-nums"] },
    statLabel: { color: theme.colors.textMuted, fontSize: theme.textSizes.caption, fontWeight: "600" },
    problem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    problemText: { flex: 1, gap: 2 },
    problemTitle: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600" },
  });
}
