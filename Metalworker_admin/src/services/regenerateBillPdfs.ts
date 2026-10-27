import { supabase } from "./supabase";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

async function readInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status;
    try {
      const body = await error.context.clone().json();
      if (body && typeof body === "object" && "error" in body && body.error) {
        return `${body.error} (HTTP ${status})`;
      }
      try {
        const text = await error.context.clone().text();
        if (text) return `HTTP ${status}: ${text}`;
      } catch {
        // ignore
      }
      return `HTTP ${status ?? "error"}`;
    } catch {
      try {
        const text = await error.context.clone().text();
        if (text) return `HTTP ${status}: ${text}`;
      } catch {
        // ignore
      }
      return `HTTP ${status ?? "error"}`;
    }
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface RegenerateProgress {
  phase: "bills" | "aggregates";
  processed: number;
  succeeded: number;
  failed: number;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  jobId?: string | null;
}

export async function regenerateAllBillPdfs(
  onProgress?: (p: RegenerateProgress) => void
): Promise<{ bills: number; aggregates: number; failed: number; jobId?: string | null }> {
  let billSucceeded = 0;
  let aggSucceeded = 0;
  let totalFailed = 0;
  let totalProcessed = 0;
  let jobId: string | null = null;
  let more = true;
  while (more) {
    const res: any = await supabase.functions.invoke("regenerate-bill-pdfs", {
      body: { job_id: jobId, limit: 25 },
    });
    const data = res.data;
    const error = res.error;
    if (error) throw new Error(await readInvokeError(error));
    if (!data?.ok) throw new Error(data?.error ?? "Regeneration failed.");
    jobId = data.job_id ?? jobId;
    const phase = data.phase === "aggregates" ? "aggregates" : "bills";
    const p = data.processed ?? 0;
    const s = data.succeeded ?? 0;
    const f = data.failed ?? 0;
    const c = data.counters ?? {};
    const jobProcessed = (c.bills_processed ?? 0) + (c.aggregates_processed ?? 0);
    const jobBillSucceeded = c.bills_succeeded ?? billSucceeded;
    const jobAggSucceeded = c.aggregates_succeeded ?? aggSucceeded;
    const jobFailed = (c.bills_failed ?? 0) + (c.aggregates_failed ?? 0);
    if (phase === "bills") billSucceeded = jobBillSucceeded;
    else aggSucceeded = jobAggSucceeded;
    totalProcessed = jobProcessed;
    totalFailed = jobFailed;
    onProgress?.({
      phase,
      processed: p,
      succeeded: s,
      failed: f,
      totalProcessed,
      totalSucceeded: phase === "bills" ? billSucceeded : aggSucceeded,
      totalFailed,
      jobId,
    });
    more = Boolean(data.more);
  }

  return { bills: billSucceeded, aggregates: aggSucceeded, failed: totalFailed, jobId };
}