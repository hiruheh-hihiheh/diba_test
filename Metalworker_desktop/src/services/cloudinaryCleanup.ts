// src/services/cloudinaryCleanup.ts
//
// Best-effort Cloudinary asset cleanup, mirroring the admin app's helper
// (Metalworker_admin/src/services/cloudinary.ts → destroyCloudinaryAsset).
//
// Deleting a Cloudinary asset requires the Admin API credentials
// (CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET), which must never reach a
// client. All deletion therefore goes through the `delete-cloudinary-asset`
// edge function, which verifies the caller is an active admin and performs the
// destroy with server-held credentials.
//
// Design rules:
//  - Never throws, never blocks, never fails the calling mutation.
//  - Call it with `void destroyCloudinaryAsset(...)` AFTER the referencing row
//    is gone, so an asset is only destroyed once nothing references it.
//  - If the edge function is not deployed yet (or the destroy fails) the asset
//    stays in Cloudinary and the console.warn is the only trace.
import { supabase } from "../lib/supabase";

export async function destroyCloudinaryAsset(
  publicId: string | null | undefined,
  context?: string
): Promise<void> {
  if (!publicId) return;
  try {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      error?: string;
    }>("delete-cloudinary-asset", {
      body: { public_id: publicId },
    });

    if (error || !data?.ok) {
      console.warn(
        `[Cloudinary] Asset destroy skipped${context ? ` (${context})` : ""}:`,
        error?.message ?? data?.error ?? "unknown error",
        `(${publicId})`
      );
    }
  } catch (err) {
    console.warn(
      `[Cloudinary] Asset destroy skipped${context ? ` (${context})` : ""}:`,
      err instanceof Error ? err.message : String(err),
      `(${publicId})`
    );
  }
}
