// src/services/companyBillZip.ts
// Pure ZIP builder for Company Bills, mirroring bulkBillZip.ts approach.
import { Zip, ZipDeflate } from "fflate";
import type { CompanyBillZipEntry } from "./companyBillFiles";

export interface BuildOpts {
  download: (path: string) => Promise<Uint8Array>;
  concurrency?: number;
}

export interface ZipOutcome {
  bytes: Uint8Array;
  included: { filename: string; bytes: number }[];
  failed: { filename: string; error: string }[];
}

export async function buildCompanyBillZip(
  plan: { entries: CompanyBillZipEntry[]; archiveName: string },
  download: (path: string) => Promise<Uint8Array>,
  concurrency = 4
): Promise<ZipOutcome> {
  const entries = plan.entries;
  const total = entries.length;
  const chunks: Uint8Array[] = [];
  const zipState: { error: Error | null } = { error: null };
  const zip = new Zip((err, chunk) => {
    if (err) { zipState.error = new Error(err.message || "zip build failed"); return; }
    chunks.push(chunk);
  });

  const included: ZipOutcome["included"] = [];
  const failed: ZipOutcome["failed"] = [];
  let totalInput = 0;
  const slots: (Promise<Uint8Array> | undefined)[] = new Array(total);
  let next = 0;
  const startNext = () => {
    if (next >= total) return;
    const i = next++;
    slots[i] = download(entries[i].storagePath);
  };
  for (let i = 0; i < Math.min(concurrency, total); i++) startNext();

  for (let i = 0; i < total; i++) {
    const entry = entries[i];
    let bytes: Uint8Array | null = null;
    try {
      const slot = slots[i];
      if (!slot) throw new Error("not scheduled");
      bytes = await slot;
    } catch (e) {
      failed.push({ filename: entry.filename, error: e instanceof Error ? e.message : "download failed" });
    }
    startNext();
    if (bytes) {
      const f = new ZipDeflate(entry.filename, { level: 6 });
      zip.add(f);
      f.push(bytes, true);
      totalInput += bytes.byteLength;
      included.push({ filename: entry.filename, bytes: bytes.byteLength });
    }
  }
  zip.end();
  if (zipState.error) throw zipState.error;
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return { bytes: out, included, failed };
}
