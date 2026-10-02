// supabase/functions/process-bill-upload/_shared/invoiceLogo.ts
//
// Fetching a logo's bytes and turning them into something the PDF writer can use.
//
// WHY THIS IS A SEPARATE MODULE
// Two functions need exactly this and must not drift apart: `set-bill-logos`, which
// re-prints after an assignment, and `update-bill`, which re-prints after an edit.
// A bill that is edited while carrying a logo has to come out of the edit with that
// logo still on it — an edit is not supposed to change which letterhead an invoice
// is on, and if only one of the two render paths knew about logos, editing a bill
// would silently strip its mark.
//
// THE IMAGES ARE PRIVATE
// The `invoice-logos` bucket is not public, and no client holds a service-role key.
// So the bytes are fetched here with the service-role client, server-side, at the
// moment a document is being produced — the same way the PDF bytes themselves are
// handled. The bucket's `allowed_mime_types` already refuses anything that is not
// a PNG or JPEG, which are the only two formats `decodePdfImage` can embed; this
// module still checks, because a row can outlive the constraint that created it.
//
// FAILURE IS A NULL, NOT A THROW
// A logo that cannot be read must not fail the whole batch. The caller decides what
// to do with a null — `set-bill-logos` reports the bill and prints nothing rather
// than printing an invoice with a letterhead quietly missing — but that decision
// belongs to the caller, so this returns a value instead of deciding.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { decodePdfImage, type PdfImage } from "./pdfImage.ts";

export const LOGO_BUCKET = "invoice-logos";
const LOGO_TABLE = "invoice_logos";

type Client = ReturnType<typeof createClient>;

/**
 * Load one logo, decoded and ready to embed.
 *
 * Returns null if the logo is gone, its file is missing, or the bytes are not a
 * PNG or JPEG this writer can place. Every one of those is logged, because all
 * three mean an invoice is about to be printed that does not match what the
 * database says it should look like.
 */
export async function loadInvoiceLogoImage(
  admin: Client,
  logoId: string | null | undefined
): Promise<PdfImage | null> {
  if (!logoId) return null;

  const { data: logo, error } = await admin
    .from(LOGO_TABLE)
    .select("storage_path")
    .eq("id", logoId)
    .maybeSingle();
  if (error) {
    console.error("invoiceLogo: lookup failed:", logoId, error.message);
    return null;
  }
  if (!logo) {
    console.error("invoiceLogo: logo row is missing:", logoId);
    return null;
  }

  const path = logo.storage_path as string;
  const { data: blob, error: downloadError } = await admin.storage.from(LOGO_BUCKET).download(path);
  if (downloadError) {
    console.error("invoiceLogo: download failed:", path, downloadError.message);
    return null;
  }

  const image = await decodePdfImage(new Uint8Array(await blob.arrayBuffer()));
  if (!image) console.error("invoiceLogo: not an embeddable PNG or JPEG:", path);
  return image;
}