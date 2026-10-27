import { supabase } from "../lib/supabase";

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
  let totalProcessed = 0;
  let billSucceeded = 0;
  let aggSucceeded = 0;
  let totalFailed = 0;
  let jobId: string | null = null;
  let more = true;
  while (more) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await supabase.functions.invoke("regenerate-bill-pdfs", {
      body: { job_id: jobId, limit: 25 },
    });
    const data = res.data;
    const error = res.error;
    if (error) throw new Error(error.message ?? "Regeneration failed.");
    if (!data?.ok) throw new Error(data?.error ?? "Regeneration failed.");
    jobId = data.job_id ?? jobId;
    const phase = data.phase === "aggregates" ? "aggregates" : "bills";
    const p = data.processed ?? 0;
    const s = data.succeeded ?? 0;
    const f = data.failed ?? 0;
    totalProcessed += p;
    totalFailed += f;
    if (phase === "bills") billSucceeded += s;
    else aggSucceeded += s;
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