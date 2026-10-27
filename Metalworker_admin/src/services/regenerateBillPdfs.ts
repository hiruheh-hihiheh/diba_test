import { supabase } from "./supabase";

export interface RegenerateProgress {
  phase: "bills" | "aggregates";
  processed: number;
  succeeded: number;
  failed: number;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
}

export async function regenerateAllBillPdfs(
  onProgress?: (p: RegenerateProgress) => void
): Promise<{ bills: number; aggregates: number; failed: number }> {
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let cursor: string | null = null;
  let more = true;
  while (more) {
    const res: any = await supabase.functions.invoke("regenerate-bill-pdfs", {
      body: { phase: "bills", cursor, limit: 25 },
    });
    const data = res.data;
    const error = res.error;
    if (error) {
      throw new Error(error.message ?? "Regeneration failed.");
    }
    if (!data?.ok) throw new Error(data?.error ?? "Regeneration failed.");
    totalProcessed += data.processed ?? 0;
    totalSucceeded += data.succeeded ?? 0;
    totalFailed += data.failed ?? 0;
    onProgress?.({
      phase: "bills",
      processed: data.processed ?? 0,
      succeeded: data.succeeded ?? 0,
      failed: data.failed ?? 0,
      totalProcessed,
      totalSucceeded,
      totalFailed,
    });
    cursor = data.next_cursor ?? null;
    more = Boolean(data.more);
  }

  cursor = null;
  more = true;
  let aggSucceeded = 0;
  while (more) {
    const res: any = await supabase.functions.invoke("regenerate-bill-pdfs", {
      body: { phase: "aggregates", cursor, limit: 25 },
    });
    const data = res.data;
    const error = res.error;
    if (error) {
      throw new Error(error.message ?? "Aggregate regeneration failed.");
    }
    if (!data?.ok) throw new Error(data?.error ?? "Aggregate regeneration failed.");
    const p = data.processed ?? 0;
    const s = data.succeeded ?? 0;
    const f = data.failed ?? 0;
    totalProcessed += p;
    totalSucceeded += s;
    totalFailed += f;
    aggSucceeded += s;
    onProgress?.({
      phase: "aggregates",
      processed: p,
      succeeded: s,
      failed: f,
      totalProcessed,
      totalSucceeded,
      totalFailed,
    });
    cursor = data.next_cursor ?? null;
    more = Boolean(data.more);
  }

  return { bills: totalSucceeded, aggregates: aggSucceeded, failed: totalFailed };
}