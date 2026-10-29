// Client for the `regenerate-bill-pdfs` Edge Function.
//
// The server owns the job: its state, its counters and which workbook it is on all
// live in `bill_pdf_regeneration_jobs`. This module only asks it to start, report
// or advance, so a reload, a second tab or a dropped connection reconnects to the
// same job instead of starting another one.
import { supabase } from "../lib/supabase";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import type { RegenerationScope, RegenerationView, WorkbookOption } from "./regenerationModel";

export interface RegenerationResponse {
  ok: true;
  job: RegenerationView | null;
  busy?: boolean;
  retry_after_ms?: number;
  attached?: boolean;
  units?: number;
}

/** A failed request. `retryable` is false for auth, validation and missing-job errors. */
export class RegenerationRequestError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly code: string | null;
  constructor(message: string, retryable: boolean, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "RegenerationRequestError";
    this.retryable = retryable;
    this.status = status;
    this.code = code;
  }
}

async function toRequestError(error: unknown): Promise<RegenerationRequestError> {
  if (error instanceof FunctionsHttpError) {
    const status: number | null = error.context?.status ?? null;
    let message = `HTTP ${status ?? "error"}`;
    let code: string | null = null;
    try {
      const body = await error.context.clone().json();
      if (body && typeof body === "object") {
        if (typeof body.error === "string") message = body.error;
        if (typeof body.code === "string") code = body.code;
      }
    } catch {
      try {
        const text = await error.context.clone().text();
        if (text) message = `HTTP ${status}: ${text.slice(0, 200)}`;
      } catch {
        // keep the status line
      }
    }
    // 546 is the platform stopping the worker (resource limit); 5xx and 429 are
    // worth retrying. A 4xx is an answer, not an outage — except a missing
    // migration, which no retry will fix either.
    const retryable = code !== "migration_required" && (status === null || status >= 500 || status === 429);
    return new RegenerationRequestError(message, retryable, status, code);
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return new RegenerationRequestError(error.message || "The server could not be reached.", true);
  }
  return new RegenerationRequestError(error instanceof Error ? error.message : String(error), true);
}

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  let res: { data: unknown; error: unknown };
  try {
    res = await supabase.functions.invoke("regenerate-bill-pdfs", { body });
  } catch (err) {
    throw await toRequestError(err);
  }
  if (res.error) throw await toRequestError(res.error);
  const data = res.data as { ok?: boolean; error?: string } | null;
  if (!data || data.ok !== true) {
    throw new RegenerationRequestError(data?.error ?? "The regeneration request failed.", false);
  }
  return data;
}

async function call(
  action: "start" | "step" | "status" | "cancel",
  jobId: string | null = null,
  scope: RegenerationScope | null = null
): Promise<RegenerationResponse> {
  return (await invoke({ action, job_id: jobId, ...(scope ? { scope } : {}) })) as RegenerationResponse;
}

export interface RegenerationWorkbookList {
  workbooks: WorkbookOption[];
  /** Finalized Bill Creator bills, which belong to no workbook. */
  standalone_count: number;
}

/** Every workbook upload the selector can offer, with its eligibility. */
export async function listRegenerationWorkbooks(): Promise<RegenerationWorkbookList> {
  const data = (await invoke({ action: "list_workbooks" })) as Partial<RegenerationWorkbookList>;
  return { workbooks: data.workbooks ?? [], standalone_count: data.standalone_count ?? 0 };
}

/** The running job, if any. Used on page load to reconnect. */
export function getRegenerationStatus(jobId: string | null = null): Promise<RegenerationResponse> {
  return call("status", jobId);
}

/**
 * Start a job for exactly `scope`, or attach to the one already running
 * (`attached: true`) — in which case the running job keeps its own scope.
 */
export function startRegeneration(scope: RegenerationScope): Promise<RegenerationResponse> {
  return call("start", null, scope);
}

/** Stop a job at its next unit boundary. `busy` means try again in a moment. */
export function cancelRegeneration(jobId: string): Promise<RegenerationResponse> {
  return call("cancel", jobId);
}

export interface RegenerationWait {
  reason: "busy" | "retry" | "connection";
  message: string;
  /** Epoch ms when the next request will be made. */
  until: number;
}

export interface DriveUpdate {
  view: RegenerationView | null;
  wait: RegenerationWait | null;
}

/** The connection kept failing; the job is still on the server and can be resumed. */
export class RegenerationInterruptedError extends Error {
  readonly lastView: RegenerationView | null;
  constructor(message: string, lastView: RegenerationView | null) {
    super(message);
    this.name = "RegenerationInterruptedError";
    this.lastView = lastView;
  }
}

const MAX_CONSECUTIVE_FAILURES = 6;
const BUSY_POLL_MS = 3_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Keep advancing `jobId` until it finishes, reporting every server response.
 *
 * Every request is safe to repeat: the server only advances on a revision-checked
 * write, so a retry can neither skip a workbook nor count one twice. Transport
 * failures (including HTTP 546) back off 1s, 2s, 4s… up to six times in a row,
 * then give up with `RegenerationInterruptedError` — the job is still on the
 * server, and Resume picks it up exactly where it stopped.
 */
export async function driveRegeneration(
  jobId: string,
  onUpdate: (u: DriveUpdate) => void,
  signal: AbortSignal
): Promise<RegenerationView | null> {
  let last: RegenerationView | null = null;
  let failures = 0;
  while (!signal.aborted) {
    let res: RegenerationResponse;
    try {
      res = await call("step", jobId);
    } catch (err) {
      const e = err instanceof RegenerationRequestError ? err : await toRequestError(err);
      if (!e.retryable) throw e;
      failures++;
      if (failures > MAX_CONSECUTIVE_FAILURES) {
        throw new RegenerationInterruptedError(`Lost contact with the server (${e.message}).`, last);
      }
      const delay = Math.min(1_000 * 2 ** (failures - 1), 20_000);
      onUpdate({
        view: last,
        wait: {
          reason: "connection",
          message: `${e.status === 546 ? "The server stopped a step before it finished" : e.message}. Retrying (${failures} of ${MAX_CONSECUTIVE_FAILURES})…`,
          until: Date.now() + delay,
        },
      });
      await sleep(delay, signal);
      continue;
    }
    failures = 0;
    if (!res.job) throw new RegenerationRequestError("The regeneration job no longer exists.", false);
    last = res.job;
    if (res.job.status !== "running") {
      onUpdate({ view: res.job, wait: null });
      return res.job;
    }
    if (res.busy) {
      onUpdate({
        view: res.job,
        wait: {
          reason: "busy",
          message: res.job.lease_active
            ? "Another window, or a step the server is still finishing, is working on this job. Waiting for it…"
            : "Waiting for the job to become available…",
          until: Date.now() + BUSY_POLL_MS,
        },
      });
      await sleep(BUSY_POLL_MS, signal);
      continue;
    }
    if (res.retry_after_ms) {
      onUpdate({
        view: res.job,
        wait: {
          reason: "retry",
          message: `${res.job.last_error?.message ?? "A temporary error occurred"}. Retrying (attempt ${res.job.attempts + 1})…`,
          until: Date.now() + res.retry_after_ms,
        },
      });
      await sleep(res.retry_after_ms, signal);
      continue;
    }
    onUpdate({ view: res.job, wait: null });
  }
  return last;
}
