// useRegeneration.ts — the client side of the PDF regeneration job.
//
// Kept byte-identical in Metalworker_admin/src/hooks and Metalworker_desktop/src/hooks.
//
// The server holds the job; this hook only mirrors it. On mount it asks whether a
// job is already running (after a reload, or started from another window) and
// offers to resume it rather than letting a second one start. While this window
// drives the job it shows every server response; while another window drives it,
// it polls the status so the panel stays truthful without doing any work itself.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  RegenerationInterruptedError,
  cancelRegeneration,
  driveRegeneration,
  getRegenerationStatus,
  startRegeneration,
  type RegenerationWait,
} from "../services/regenerateBillPdfs";
import type { RegenerationScope, RegenerationView } from "../services/regenerationModel";

export type RegenerationMode =
  /** Nothing to show. */
  | "idle"
  /** The start request is in flight. */
  | "starting"
  /** This window is advancing the job. */
  | "running"
  /** A job is running but this window is not driving it (reload, other window). */
  | "detached"
  /** This window lost contact while driving; the job is still on the server. */
  | "interrupted"
  /** The job reached a terminal state. */
  | "finished"
  /** A request failed in a way a retry will not fix. */
  | "error";

export interface RegenerationController {
  mode: RegenerationMode;
  view: RegenerationView | null;
  wait: RegenerationWait | null;
  error: string | null;
  cancelling: boolean;
  /** True whenever a job exists that has not finished: the start button must be off. */
  active: boolean;
  /**
   * The last start found a job already running, so the requested selection was NOT
   * applied; the panel shows that job's own scope instead.
   */
  attachedToExisting: boolean;
  start: (scope: RegenerationScope) => void;
  resume: () => void;
  cancel: () => void;
  dismiss: () => void;
}

const DETACHED_POLL_MS = 5_000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useRegeneration(onFinished?: () => void): RegenerationController {
  const [mode, setMode] = useState<RegenerationMode>("idle");
  const [view, setView] = useState<RegenerationView | null>(null);
  const [wait, setWait] = useState<RegenerationWait | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [attachedToExisting, setAttachedToExisting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // Reconnect: a job left running by a reload or another window is shown, not duplicated.
  useEffect(() => {
    let alive = true;
    getRegenerationStatus()
      .then((res) => {
        if (!alive || !res.job || res.job.status !== "running") return;
        setView(res.job);
        setMode("detached");
      })
      .catch(() => {
        // No status is not an error worth showing on page load; the button still works.
      });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const jobId = view?.job_id ?? null;

  // While detached, follow the job's progress without advancing it.
  useEffect(() => {
    if (mode !== "detached" || !jobId) return;
    const timer = setInterval(() => {
      getRegenerationStatus(jobId)
        .then((res) => {
          if (!res.job) return;
          setView(res.job);
          if (res.job.status !== "running") {
            setMode("finished");
            onFinishedRef.current?.();
          }
        })
        .catch(() => {
          // A missed poll is retried on the next tick.
        });
    }, DETACHED_POLL_MS);
    return () => clearInterval(timer);
  }, [mode, jobId]);

  const drive = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMode("running");
    setError(null);
    try {
      const final = await driveRegeneration(
        id,
        (update) => {
          if (controller.signal.aborted) return;
          if (update.view) setView(update.view);
          setWait(update.wait);
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setWait(null);
      if (final) setView(final);
      setMode("finished");
      onFinishedRef.current?.();
    } catch (err) {
      if (controller.signal.aborted) return;
      setWait(null);
      setError(messageOf(err));
      setMode(err instanceof RegenerationInterruptedError ? "interrupted" : "error");
    }
  }, []);

  const start = useCallback((scope: RegenerationScope) => {
    setMode("starting");
    setError(null);
    setAttachedToExisting(false);
    startRegeneration(scope)
      .then((res) => {
        if (!res.job) throw new Error("The server did not return a regeneration job.");
        setAttachedToExisting(res.attached === true);
        setView(res.job);
        if (res.job.status === "running") void drive(res.job.job_id);
        else setMode("finished");
      })
      .catch((err) => {
        setError(messageOf(err));
        setMode("error");
      });
  }, [drive]);

  const resume = useCallback(() => {
    if (jobId) void drive(jobId);
  }, [drive, jobId]);

  const cancel = useCallback(() => {
    if (!jobId) return;
    abortRef.current?.abort();
    setCancelling(true);
    setWait(null);
    void (async () => {
      try {
        // The job stops at a unit boundary. If a step is still finishing on the
        // server the answer is "busy" for a moment; ask again rather than give up.
        let stopped = false;
        for (let i = 0; i < 20 && !stopped; i++) {
          const res = await cancelRegeneration(jobId);
          if (res.job) setView(res.job);
          stopped = !res.busy;
          if (!stopped) await pause(1_500);
        }
        if (!stopped) throw new Error("The job is still busy on the server, so it could not be stopped yet. Try Stop again.");
        setMode("finished");
        onFinishedRef.current?.();
      } catch (err) {
        setError(messageOf(err));
        setMode("interrupted");
      } finally {
        setCancelling(false);
      }
    })();
  }, [jobId]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setView(null);
    setWait(null);
    setError(null);
    setAttachedToExisting(false);
    setMode("idle");
  }, []);

  const active =
    mode === "starting" ||
    mode === "running" ||
    mode === "detached" ||
    mode === "interrupted" ||
    (mode === "error" && view?.status === "running");

  return { mode, view, wait, error, cancelling, active, attachedToExisting, start, resume, cancel, dismiss };
}
