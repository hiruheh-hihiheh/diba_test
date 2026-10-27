import { supabase } from "./supabase";

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
    const p = data.processed ?? 0;
    const s = data.succeeded ?? 0;
    const f = data.failed ?? 0;
    totalProcessed += p;
    billSucceeded += s;
    totalFailed += f;
    onProgress?.({
      phase: "bills",
      processed: p,
      succeeded: s,
      failed: f,
      totalProcessed,
      totalSucceeded: billSucceeded,
      totalFailed,
      jobId,
    });
    more = Boolean(data.more);
  }

  more = true;
  let aggSucceeded = 0;
  while (more) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await supabase.functions.invoke("regenerate-bill-pdfs", {
      body: { job_id: jobId, limit: 25 },
    });
    const data = res.data;
    const error = res.error;
    if (error) throw new Error(error.message ?? "Aggregate regeneration failed.");
    if (!data?.ok) throw new Error(data?.error ?? "Aggregate regeneration failed.");
    jobId = data.job_id ?? jobId;
    const p = data.processed ?? 0;
    const s = data.succeeded ?? 0;
    const f = data.failed ?? 0;
    totalProcessed += p;
    aggSucceeded += s;
    totalFailed += f;
    onProgress?.({
      phase: "aggregates",
      processed: p,
      succeeded: s,
      failed: f,
      totalProcessed,
      totalSucceeded: aggSucceeded,
      totalFailed,
      jobId,
    });
    more = Boolean(data.more);
  }

  return { bills: billSucceeded, aggregates: aggSucceeded, failed: totalFailed, jobId };
}