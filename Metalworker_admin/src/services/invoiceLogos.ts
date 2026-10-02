// src/services/invoiceLogos.ts
//
// The invoice logo library: add a logo once, then reference it from any number of
// bills.
//
// WHERE THE WORK HAPPENS
// Three different jobs, three different places, and the split is deliberate:
//
//   LIST / ADD / RENAME   direct from this module, through RLS. These are cheap,
//                         single-row writes on a small table, and routing them
//                         through an edge function would add a round trip and a
//                         second place that can disagree about permissions.
//
//   ASSIGN / REMOVE       the `set-bill-logos` edge function. Not optional: an
//                         assignment is one SQL statement followed by a bounded
//                         batch of PDF re-prints, which is server work no client
//                         can do.
//
//   RENDER                server-side, at the moment a document is produced. The
//                         logo bytes are read out of a PRIVATE bucket with the
//                         service role, so no client ever holds a URL it could
//                         hand to someone else. The stored bill PDFs are never
//                         modified — a logo is metadata on the bill and the
//                         document is re-rendered from it.
//
// ONE REQUEST, NOT N
// "Select 400 bills and assign a logo" is a single `set_bill_logo` statement
// (migration 0011), not 400 UPDATEs, so the assignment itself is instant at any
// size. The re-prints that follow are a bounded batch, and this module loops over
// them so the caller gets one call and one honest result — see
// `applyLogoToBills`.
//
// THE BUCKET IS PRIVATE
// A letterhead is part of a financial document's identity, so the images are not
// put on a public CDN. Preview thumbnails are short-lived signed URLs, exactly as
// the bill PDFs are; a URL that stops working in two minutes cannot leak.

import { Platform } from "react-native";

import { supabase } from "./supabase";
import { logAudit } from "./auditLog";
import type {
  BillLogoApplyResult,
  BillLogoRef,
  BillLogoState,
  InvoiceLogo,
  LogoFit,
} from "../types/invoiceLogo";
import {
  fitLogoWithinLimits,
  INVOICE_LOGO_MAX_BYTES,
  INVOICE_LOGO_MAX_EDGE,
  INVOICE_LOGO_MIME_TYPES,
} from "../types/invoiceLogo";

const LOGOS = "invoice_logos";
const BILLS = "bills";
const BUCKET = "invoice-logos";

/** Preview URLs are short-lived, like the bill PDFs' two minutes. */
const SIGNED_URL_TTL_SECONDS = 120;

/* ──────────────────────────────────────────────
   Reading
   ────────────────────────────────────────────── */

/**
 * Every logo in the library, with how many bills use each.
 *
 * ONE request for the whole list, which is the point. The obvious alternative —
 * listing logos, then a COUNT per logo — is an N+1 that gets slower exactly as
 * the library becomes worth having, and the library screen and the picker both
 * need that number on every row.
 *
 * The counts come from `get_invoice_logo_usage`, which groups in the database and
 * returns one row per logo, including logos with no bills (as 0, so a new logo is
 * an ordinary row rather than something the client has to reconcile). If that
 * function is not there yet the list still loads; the count falls back to the
 * column PostgREST can compute via a hint, and the library remains usable.
 */
export async function fetchInvoiceLogos(): Promise<InvoiceLogo[]> {
  const { data, error } = await supabase
    .from(LOGOS)
    // The hint MUST be the foreign key's name. PostgREST accepts an index name
    // here, but only an index it can read as a relationship — and
    // `bills_logo_id_idx` is PARTIAL (`WHERE logo_id IS NOT NULL`), so no
    // relationship can be inferred from it and the request fails with
    // "Could not find a relationship between 'invoice_logos' and 'bills'". That
    // failure is not stale cache; reloading the schema does not fix it. The
    // constraint created by `ADD COLUMN ... REFERENCES` is `bills_logo_id_fkey`.
    .select("*, bills!bills_logo_id_fkey(count)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (InvoiceLogo & {
    bills?: { count: number }[] | null;
  })[];

  const logos = rows.map((row) => ({
    ...row,
    bill_count: Array.isArray(row.bills) ? row.bills[0]?.count ?? 0 : 0,
  }));

  /* Prefer the RPC's number: it counts DISTINCT bills, and a count over an
     embedded relation is a second, subtly different implementation of the same
     figure. Falling back to the embedded one keeps the screen working before the
     migration is applied rather than showing every logo as unused. */
  const { data: usage, error: usageError } = await supabase.rpc("get_invoice_logo_usage");
  if (!usageError && Array.isArray(usage)) {
    const counts = new Map<string, number>();
    for (const entry of usage as { logo_id: string; bill_count: number | string }[]) {
      counts.set(entry.logo_id, Number(entry.bill_count) || 0);
    }
    for (const logo of logos) {
      const exact = counts.get(logo.id);
      if (exact !== undefined) logo.bill_count = exact;
    }
  }

  return logos;
}

/**
 * Fetch the logos a set of bills currently carry, keyed by logo id.
 *
 * A bill list needs the NAME beside every row, and that name lives in another
 * table. Selecting it per row would be one request per bill; this collects the
 * distinct ids first and asks once. Called with a large page's ids, it is one
 * request no matter how many rows are on screen.
 */
export async function fetchLogosByIds(ids: readonly string[]): Promise<Map<string, BillLogoRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
  const out = new Map<string, BillLogoRef>();
  if (wanted.length === 0) return out;

  const { data, error } = await supabase
    .from(LOGOS)
    .select("id, name, storage_path, pixel_width, pixel_height")
    .in("id", wanted);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as BillLogoRef[]) out.set(row.id, row);
  return out;
}

/**
 * A short-lived URL for a logo's image, for previewing it in the app.
 *
 * The bucket is private, so this is the only way a client can see the image, and
 * it is the same mechanism the bill PDFs already use. Two minutes is enough to
 * render a thumbnail and is short enough that a URL pasted into a chat does not
 * keep working.
 */
export async function getLogoImageUrl(logoId: string): Promise<string> {
  const { data: logo, error: lookupError } = await supabase
    .from(LOGOS)
    .select("storage_path")
    .eq("id", logoId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!logo) throw new Error("That logo no longer exists.");

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(logo.storage_path as string, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Could not load that logo.");
  return data.signedUrl;
}

/** Signed URLs for several logos at once, for a list of previews. */
export async function getLogoImageUrls(logoIds: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(logoIds.filter((id) => typeof id === "string" && id !== ""))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;

  const { data: logos, error } = await supabase
    .from(LOGOS)
    .select("id, storage_path")
    .in("id", wanted);
  if (error) throw new Error(error.message);

  const paths = (logos ?? []).map((l) => l.storage_path as string);
  if (paths.length === 0) return out;

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (signError) throw new Error(signError.message);

  /* `createSignedUrls` answers in the order it was asked, and names each result
     with the object name rather than the logo id, so the two are re-paired here.
     Matching on the path is what makes this correct for logos whose filenames
     happen to be similar. */
  const byPath = new Map<string, string>();
  for (const entry of (signed ?? []) as { path: string; signedUrl: string | null }[]) {
    if (entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }
  for (const logo of (logos ?? []) as { id: string; storage_path: string }[]) {
    const url = byPath.get(logo.storage_path);
    if (url) out.set(logo.id, url);
  }
  return out;
}

/* ──────────────────────────────────────────────
   Adding and renaming
   ────────────────────────────────────────────── */

/** A file the admin has chosen, before it exists in the library. */
export interface PickedInvoiceLogo {
  name: string;
  uri: string;
  /** Intrinsic pixel size, used to validate and to lay out without decoding. */
  width: number;
  height: number;
  byteSize: number;
  contentType: (typeof INVOICE_LOGO_MIME_TYPES)[number];
}

/**
 * Open the system image picker, narrowed to the formats that can be printed.
 *
 * `mediaTypes: ["images"]` is the current SDK 57 shape; it replaces the older
 * `MediaTypeOptions.Images` enum, which is deprecated. `allowsEditing` is
 * deliberately NOT set: a logo must not be cropped by a picker, because the
 * image's aspect ratio is the thing being preserved, and a crop square is the
 * fastest way to stretch a letterhead.
 */
export async function pickInvoiceLogo(): Promise<PickedInvoiceLogo | null> {
  const { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } = await import(
    "expo-image-picker"
  );

  const permission = await requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Allow access to your photos to choose a logo.");
  }

  const result = await launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    // The file is uploaded to storage as-is, so no re-encoding happens here that
    // could quietly change the aspect ratio or drop transparency.
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0];

  const contentType = normaliseImageType(asset.mimeType, asset.fileName ?? null);
  if (!contentType) {
    throw new Error(
      "A logo must be a PNG or JPEG file. Those are the only formats the invoice PDF can print."
    );
  }

  if (asset.fileSize != null && asset.fileSize > INVOICE_LOGO_MAX_BYTES) {
    throw new Error("That image is larger than 5 MB. Please choose a smaller one.");
  }
  if (!asset.width || !asset.height) {
    throw new Error("That image's size could not be read. Please choose it again.");
  }
  /* An oversized image is no longer refused here. It is resized on the way in, by
     `addInvoiceLogo`, because the alternative is asking an admin to open
     Photoshop for a logo the app can fix in about a second. The original pixel
     size is still recorded on `picked` — it is what the confirmation preview
     describes and what the normalized size is measured against. The caller can
     ask `fitLogoWithinLimits(picked.width, picked.height)` whether a resize is
     coming, and say so before the admin commits. */

  return {
    name: deriveLogoName(asset.fileName ?? null),
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    byteSize: asset.fileSize ?? 0,
    contentType,
  };
}

/**
 * Work out the stored type from what the picker reported.
 *
 * The MIME type is trusted first and the extension second, because Android's
 * picker often reports `application/octet-stream` for an image — exactly the
 * situation `pickBillWorkbook` already has to handle. Returning null for anything
 * else is what keeps a file the PDF writer cannot embed from entering the
 * library at all.
 */
function normaliseImageType(
  mimeType: string | undefined,
  fileName: string | null
): (typeof INVOICE_LOGO_MIME_TYPES)[number] | null {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  if (/\.png$/i.test(fileName ?? "")) return "image/png";
  if (/\.jpe?g$/i.test(fileName ?? "")) return "image/jpeg";
  return null;
}

/**
 * A sensible default name from the filename.
 *
 * Only a default: the admin renames it on the confirmation step, and the name is
 * free text rather than a validated enum, because the set of letterheads a
 * company prints is not something the schema should be able to reject.
 */
function deriveLogoName(fileName: string | null): string {
  const stem = (fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem || "Invoice logo";
}

/**
 * The chosen image as raw bytes.
 *
 * Read as bytes rather than base64, for two reasons: `Uint8Array` is what the
 * storage upload actually wants, so no re-encoding is needed, and base64 would
 * mean decoding through `atob`, which is not dependable on every native runtime.
 * `File.bytes()` is the SDK 57 native path; on web the browser's own `fetch`
 * reads the picker blob URL.
 */
async function readLogoBytes(picked: PickedInvoiceLogo): Promise<Uint8Array> {
  if (Platform.OS === "web") {
    const response = await fetch(picked.uri);
    if (!response.ok) {
      throw new Error("That image could not be read from this device. Try choosing it again.");
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  const { File } = await import("expo-file-system");
  return new File(picked.uri).bytes();
}

/** Progress text for a long upload, so a resize is never a silent pause. */
export type LogoStatus = (message: string) => void;

interface NormalisedLogo {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Resample an oversized logo down to something the PDF renderer will accept.
 *
 * WHY THE FIT IS NOT JUST "MAKE THE LONG EDGE 3000"
 * `pdfImage.ts` refuses an image if EITHER side exceeds 3000px OR the total
 * exceeds 4,000,000 pixels. Those are different constraints and the second one
 * binds first for most shapes — 3000 x 3000 is 9,000,000 pixels, so fitting the
 * edge alone would upload an image the renderer then refuses on somebody's
 * invoice. `fitLogoWithinLimits` takes the smaller of the two scales.
 *
 * WEB: `createImageBitmap` is asked to decode AT the target size. That matters
 * for the case this exists for: a 16667 x 16667 logo is 278 megapixels, over 1 GB
 * decoded as RGBA, and past the 16384-pixel canvas limit every browser enforces.
 * Resampling inside `createImageBitmap` avoids materialising the full-size bitmap
 * at all; the canvas is only ever the small one. The resize options are ignored
 * by older Safari, which then decodes at full size — the canvas draw below still
 * produces the right output, it just costs more memory, and a decode failure is
 * caught and reported rather than crashing.
 *
 * NATIVE: `expo-image-manipulator` is the Expo module for this, loaded lazily so
 * the web build never pulls it in. It re-encodes, so the output format follows
 * the input: PNG in, PNG out, so transparency survives.
 *
 * Returns null when the image is already inside the limits, and the caller then
 * uploads the original bytes untouched — no re-encode, no quality loss, and no
 * change to the path that is already working.
 */
async function normaliseLogoImage(
  picked: PickedInvoiceLogo,
  fit: LogoFit,
  onStatus?: LogoStatus
): Promise<NormalisedLogo | null> {
  if (!fit.resized) return null;

  onStatus?.(
    `Image is ${picked.width} x ${picked.height}. Resizing to ${fit.width} x ${fit.height} to fit the ${INVOICE_LOGO_MAX_EDGE}px limit...`
  );

  try {
    if (Platform.OS === "web") {
      return await resizeInBrowser(picked, fit);
    }
    return await resizeOnDevice(picked, fit);
  } catch (err) {
    throw new Error(
      `That image is ${picked.width} x ${picked.height} and could not be resized on this device` +
        ` (${err instanceof Error ? err.message : "unknown error"}). ` +
        "A logo under 3000 x 3000 pixels can still be added directly."
    );
  }
}

/** Decode-at-size and re-encode through a canvas. Web only. */
async function resizeInBrowser(picked: PickedInvoiceLogo, fit: LogoFit): Promise<NormalisedLogo> {
  const response = await fetch(picked.uri);
  if (!response.ok) throw new Error("the image could not be read");
  const blob = await response.blob();

  let source: ImageBitmap | HTMLImageElement | null = null;
  if (typeof createImageBitmap === "function") {
    try {
      // resizeWidth/resizeHeight make the browser downscale during decode. This is
      // the two-argument overload (image + options); the six-argument form takes
      // a source rectangle instead.
      source = await createImageBitmap(blob, {
        resizeWidth: fit.width,
        resizeHeight: fit.height,
        resizeQuality: "high",
      });
    } catch {
      source = null;
    }
  }
  if (!source) {
    const url = URL.createObjectURL(blob);
    try {
      source = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("the image could not be decoded"));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const canvas = document.createElement("canvas");
  // Exactly the fit size, never the source size: this canvas is the one that has
  // to fit inside the browser's area limit.
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser could not provide a 2D canvas");
  // Nothing is filled in first, so PNG alpha composites onto transparent rather
  // than onto black. That is the whole reason a logo's background stays clear.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, fit.width, fit.height);
  if (typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();

  const isPng = picked.contentType === "image/png";
  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("the browser produced no image"))),
      picked.contentType,
      isPng ? undefined : 0.92
    );
  });

  return {
    bytes: new Uint8Array(await out.arrayBuffer()),
    width: fit.width,
    height: fit.height,
  };
}

/** Resample through the Expo image module. Native only. */
async function resizeOnDevice(picked: PickedInvoiceLogo, fit: LogoFit): Promise<NormalisedLogo> {
  const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
  const result = await manipulateAsync(
    picked.uri,
    // Both dimensions given, so the ratio is preserved by construction rather than
    // left to the module to infer from one of them.
    [{ resize: { width: fit.width, height: fit.height } }],
    {
      // Format follows the input: a PNG is re-encoded as a PNG so its alpha
      // channel is still there for the renderer to turn into a soft mask.
      format: picked.contentType === "image/png" ? SaveFormat.PNG : SaveFormat.JPEG,
      // For PNG this is deflate effort, not quality — PNG stays lossless at any
      // setting. 0.7 keeps a large flat-colour logo inside the 5 MB bucket.
      compress: picked.contentType === "image/png" ? 0.7 : 0.92,
    }
  );
  if (result.width !== fit.width || result.height !== fit.height) {
    throw new Error(`the resize produced ${result.width} x ${result.height}, expected ${fit.width} x ${fit.height}`);
  }
  const { File } = await import("expo-file-system");
  return { bytes: await new File(result.uri).bytes(), width: result.width, height: result.height };
}

/**
 * The storage object name for a logo.
 *
 * Namespaced by logo id rather than by the admin's filename, so the original name
 * can be anything at all — including two logos both called "logo.png" — and
 * renaming a logo never touches its bytes.
 *
 * The extension follows the real format rather than the original file's name, so
 * a PNG uploaded from a file someone called `.jpg` is stored with a truthful name.
 * Nothing reads it back — `content_type` on the row is what the server trusts —
 * so this is for human eyes in the storage console.
 */
function storagePathFor(logoId: string, contentType: PickedInvoiceLogo["contentType"]): string {
  return `${logoId}/logo.${contentType === "image/png" ? "png" : "jpg"}`;
}

/**
 * Add a logo to the library.
 *
 * TWO WRITES, AND THE ORDER IS THE WHOLE THING
 * The image goes to storage first and the row is written second. If the row write
 * fails the file is deleted again, so the bucket cannot accumulate objects that
 * no row points at. The reverse order would leave an image the library believes
 * exists and cannot show — and because the bucket is private, "cannot show" means
 * a broken thumbnail rather than a visible leak, which is the better failure but
 * still a failure worth avoiding.
 *
 * THE ID IS MINTED BY THE DATABASE, NOT HERE
 * The object name is namespaced by logo id, so the id has to exist before the
 * upload. Letting Postgres generate it means one round trip to get it back
 * first — and it avoids depending on `crypto.randomUUID`, which is not guaranteed
 * to exist on every native runtime this app runs on. The alternative, generating
 * one by hand, would be inventing a UUID format for no benefit.
 *
 * The row is written with the signed-in admin's own key, so the insert is subject
 * to the same RLS as the rest of the app: a worker token is refused by the
 * database, not merely hidden in the UI.
 */
export async function addInvoiceLogo(
  picked: PickedInvoiceLogo,
  name: string,
  onStatus?: LogoStatus
): Promise<InvoiceLogo> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the logo a name so you can tell it apart later.");

  /* Normalized BEFORE the row is written, because pixel_width / pixel_height on
     that row must describe the file that is actually stored. Writing the
     original size here would leave the library claiming a 16667 x 16667 logo
     that no longer exists, and every layout that trusts those numbers — the
     picker's aspect ratio, the header placement — would be wrong. */
  const fit = fitLogoWithinLimits(picked.width, picked.height);
  const normalised = await normaliseLogoImage(picked, fit, onStatus);

  const bytes = normalised ? normalised.bytes : await readLogoBytes(picked);
  const storedWidth = normalised ? normalised.width : picked.width;
  const storedHeight = normalised ? normalised.height : picked.height;

  if (bytes.length === 0) throw new Error("That image is empty.");
  if (bytes.length > INVOICE_LOGO_MAX_BYTES) {
    throw new Error(
      normalised
        ? "That image is still larger than 5 MB after resizing. Please choose a smaller one."
        : "That image is larger than 5 MB. Please choose a smaller one."
    );
  }

  const { data: userData } = await supabase.auth.getUser();
  const now = new Date().toISOString();

  /* The row is created first here, with no path yet, purely to obtain the id. It
     is never left in this state: the next statement fills in the path, and both
     later failures delete it. A brand-new logo is on no bill, so a row that is
     briefly incomplete is harmless — unlike a bill, nothing depends on it yet. */
  const { data: created, error: createError } = await supabase
    .from(LOGOS)
    .insert({
      name: trimmed,
      // A placeholder the renderer can never resolve: if this row somehow survived
      // without the update below, the logo would fail visibly rather than point at
      // another logo's image.
      storage_path: "",
      file_name: null,
      pixel_width: storedWidth,
      pixel_height: storedHeight,
      content_type: picked.contentType,
      byte_size: bytes.length,
      created_by: userData.user?.id ?? null,
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();
  if (createError) throw new Error(`The logo could not be added: ${createError.message}`);

  const logoId = created.id as string;
  const path = storagePathFor(logoId, picked.contentType);

  const dropRow = async (message: string): Promise<never> => {
    /* The row goes first: once it is gone nothing can reference the object, and
       the object can then be removed without a window in which a bill could be
       pointed at it. */
    await supabase.from(LOGOS).delete().eq("id", logoId);
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(message);
  };

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: picked.contentType,
      // Not an upsert. Every logo gets a fresh database-generated id, so this path
      // has never existed before and cannot already hold an object. `upsert: true`
      // would map to INSERT ... ON CONFLICT DO UPDATE, and the bucket grants INSERT
      // but deliberately not UPDATE, so the conflict branch would be refused by RLS
      // — a permission the logo library has no reason to ask for.
      upsert: false,
    });
  if (uploadError) {
    return dropRow(`That image could not be saved: ${uploadError.message}`);
  }

  const { data: saved, error: saveError } = await supabase
    .from(LOGOS)
    .update({ storage_path: path })
    .eq("id", logoId)
    .select("*")
    .single();
  if (saveError) {
    return dropRow(`The logo could not be added: ${saveError.message}`);
  }

  void logAudit({ action: "invoice_logo.created", targetType: "invoice_logo", targetId: logoId });

  return { ...(saved as InvoiceLogo), bill_count: 0 };
}

/**
 * Rename a logo.
 *
 * A single-column update. The image bytes are not touched, which is the whole
 * reason a logo is a row rather than a path copied onto each bill: renaming must
 * not become a mass write across the bills that use it, and must not invalidate a
 * single document.
 */
export async function renameInvoiceLogo(id: string, name: string): Promise<InvoiceLogo> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A logo needs a name.");

  const { data, error } = await supabase
    .from(LOGOS)
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  void logAudit({ action: "invoice_logo.renamed", targetType: "invoice_logo", targetId: id });
  return { ...(data as InvoiceLogo), bill_count: 0 };
}

/**
 * What a delete would destroy, gathered before anything is changed.
 *
 * Named rather than inlined in the delete call, because the confirmation dialog
 * is the only place the admin learns this, and it has to say a number. The count
 * comes from the library list the screen already has, so opening the dialog costs
 * no request at all.
 */
export interface LogoUsageSummary {
  bill_count: number;
  /** A few bill references, so "24 bills" can be made concrete. */
  sample_bills: { id: string; label: string }[];
  /** The most this call looks up, so it can never become a full scan. */
  sample_limit: number;
}

/** How many bills a delete confirmation names before it says "and N more". */
export const LOGO_USAGE_SAMPLE_LIMIT = 5;

/**
 * Look up the bills a logo is on, for the delete confirmation.
 *
 * TWO QUERIES, and both are bounded. The exact count comes from a `head: true`
 * count, so the dialog can say "24 bills" truthfully; the named sample comes from
 * a `limit`, so it can make that concrete without reading hundreds of invoice ids
 * to render one dialog — which is especially important precisely in the large-use
 * case the dialog exists for.
 */
export async function fetchLogoUsage(logoId: string): Promise<LogoUsageSummary> {
  const [countResult, sampleResult] = await Promise.all([
    supabase.from(BILLS).select("id", { count: "exact", head: true }).eq("logo_id", logoId),
    supabase
      .from(BILLS)
      .select("id, invoice_no, sheet_name, party_name")
      .eq("logo_id", logoId)
      .limit(LOGO_USAGE_SAMPLE_LIMIT),
  ]);
  if (countResult.error) throw new Error(countResult.error.message);
  if (sampleResult.error) throw new Error(sampleResult.error.message);

  const sample = (
    (sampleResult.data ?? []) as {
      id: string;
      invoice_no: string | null;
      sheet_name: string | null;
      party_name: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    label: row.invoice_no?.trim() || row.party_name?.trim() || row.sheet_name?.trim() || "this bill",
  }));

  return {
    bill_count: countResult.count ?? sample.length,
    sample_bills: sample,
    sample_limit: LOGO_USAGE_SAMPLE_LIMIT,
  };
}

/**
 * Delete a logo.
 *
 * ONLY PERMITTED WHEN NOTHING USES IT, and that rule is enforced in three places
 * on purpose, because it is the one thing in this feature that could quietly
 * corrupt a financial document:
 *
 *   1. the database, by `ON DELETE RESTRICT` on `bills.logo_id` — the backstop
 *      that holds even if this function is never called;
 *   2. this check, so the admin gets a sentence naming the bills instead of a
 *      constraint violation;
 *   3. the confirmation dialog, so the number is on screen before the tap.
 *
 * A caller that means to delete a logo which IS in use must first call
 * `applyLogoToBills` with `null` to remove it from those bills, and let the
 * re-prints drain — deleting the image first would leave those invoices pointing
 * at nothing. The order is the admin's to choose and the screen asks for it.
 */
export async function deleteInvoiceLogo(id: string): Promise<{ bill_count: number }> {
  /* The count is asked for here rather than trusted from the caller: the list on
     screen may be minutes old, and a stale "unused" must not become a delete that
     takes a letterhead off four hundred invoices. */
  const { count, error: countError } = await supabase
    .from(BILLS)
    .select("id", { count: "exact", head: true })
    .eq("logo_id", id);
  if (countError) throw new Error(countError.message);

  const billCount = count ?? 0;
  if (billCount > 0) {
    throw new Error(
      `This logo is on ${billCount} ${billCount === 1 ? "bill" : "bills"}. Remove it from ${billCount === 1 ? "that bill" : "those bills"} first, then delete the logo.`
    );
  }

  /* The path is read before the row goes, because after the row is deleted nothing
     can say where the image is — and the bucket is private, so an orphaned object
     is invisible and would never be cleaned up. */
  const { data: logo } = await supabase
    .from(LOGOS)
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  const path = logo?.storage_path as string | undefined;

  const { error } = await supabase.from(LOGOS).delete().eq("id", id);
  if (error) throw new Error(error.message);

  /* The row is gone, so nothing points at the object and removing it cannot affect
     any invoice. A failure here is reported but not retried: the logo the admin
     asked to delete is already deleted, and a leftover object costs storage but
     cannot mislead anyone. */
  if (path) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    if (removeError) {
      console.warn("invoiceLogos: image not removed:", removeError.message, path);
    }
  }

  void logAudit({ action: "invoice_logo.deleted", targetType: "invoice_logo", targetId: id });
  return { bill_count: 0 };
}

/* ──────────────────────────────────────────────
   Assigning to bills
   ────────────────────────────────────────────── */

/**
 * Assign a logo to bills, or remove it, and keep the printed PDFs honest.
 *
 * THE SHAPE OF THIS CALL
 * `logoId === null` is a REMOVAL, and that is the same code path as an assignment
 * rather than a separate operation. They cannot drift apart, and a removal is a
 * real change that needs its bills re-printed just as much as an addition does.
 *
 * ONE ROUND TRIP FOR THE ASSIGNMENT, REGARDLESS OF SIZE
 * All the bill ids go to the server in a single call, which writes them in one SQL
 * statement. A selection of four hundred bills is therefore as instant as one of
 * four — this is the whole reason assignment is not a loop, and the reason the
 * browser does not freeze on a large selection.
 *
 * THE RE-PRINTS ARE A SEPARATE, BOUNDED, RESUMABLE STEP
 * Each bill's three PDFs have to be re-rendered, which is server work. That is
 * done in bounded batches, and this function drains them by calling again until
 * the server reports none outstanding. So the admin sees one operation and one
 * result, while the work underneath stays inside request timeouts.
 *
 * `onProgress` is called with real counts after each batch rather than a
 * fabricated percentage, so a progress bar can show "Re-printing 40 of 137" and be
 * correct at every step.
 *
 * A bill that could not be re-printed is reported in `failures` and stays queued.
 * Its assignment is still correct and still retryable, which is the honest state:
 * the alternative — refusing the whole operation — would discard a correct
 * assignment over a rendering problem.
 */
export async function applyLogoToBills(
  billIds: readonly string[],
  logoId: string | null,
  onProgress?: (progress: { assigned: number; reprinted: number; remaining: boolean }) => void
): Promise<BillLogoApplyResult> {
  const ids = [...new Set(billIds.filter((id) => typeof id === "string" && id !== ""))];

  const empty: BillLogoApplyResult = {
    ok: false,
    error: "No bills were selected.",
    assigned: 0,
    unchanged: 0,
    reprinted: 0,
    more_work: false,
    failures: [],
  };
  if (ids.length === 0) return empty;

  let assigned = 0;
  let unchanged = 0;
  let reprinted = 0;
  const failures: BillLogoApplyResult["failures"] = [];

  /* The first call carries the assignment. Every call after it is a drain: no bill
     ids, so the server only re-prints what is still outstanding and nothing can
     be assigned twice by a retry. */
  let carryIds: string[] | undefined = ids;
  let carryLogoId: string | null | undefined = logoId;

  for (;;) {
    const body: Record<string, unknown> = {};
    if (carryIds !== undefined) {
      body.bill_ids = carryIds;
      body.logo_id = carryLogoId;
    }
    body.limit = 40;

    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      error?: string;
      reason?: string;
      assigned?: number;
      unchanged?: number;
      reprinted?: number;
      more_work?: boolean;
      failures?: BillLogoApplyResult["failures"];
      warning?: string;
    }>("set-bill-logos", { body });

    if (error) {
      const detail = await readErrorBody(error);
      if (carryIds !== undefined) {
        /* The assignment itself failed, so there is nothing to drain. */
        return {
          ok: false,
          error: detail?.error ?? "The logo could not be assigned.",
          reason: detail?.reason,
          assigned: 0,
          unchanged: 0,
          reprinted: 0,
          more_work: false,
          failures: [],
        };
      }
      /* A batch failed after the assignment succeeded. The bills are correct and
         still queued, so this is a warning rather than a rollback: reporting it
         as a failure would invite the admin to retry the whole assignment, which
         would be harmless but would not fix the stalled re-print. */
      return {
        ok: true,
        assigned,
        unchanged,
        reprinted,
        more_work: true,
        failures,
        error: detail?.error ?? "The logos were assigned, but some PDFs could not be re-printed yet.",
      };
    }

    if (data?.warning) {
      /* The server reports a partial success this way: the rows are written, the
         re-print is not. Kept as the message so the admin is told which of the
         two actually happened. */
      return {
        ok: true,
        assigned: data.assigned ?? assigned,
        unchanged: data.unchanged ?? unchanged,
        reprinted: data.reprinted ?? reprinted,
        more_work: true,
        failures,
        error: data.warning,
      };
    }

    if (!data?.ok) {
      if (carryIds !== undefined) {
        return {
          ok: false,
          error: data?.error ?? "The logo could not be assigned.",
          reason: data?.reason,
          assigned: 0,
          unchanged: 0,
          reprinted: 0,
          more_work: false,
          failures: [],
        };
      }
      break;
    }

    if (carryIds !== undefined) {
      assigned = data.assigned ?? 0;
      unchanged = data.unchanged ?? 0;
    }
    reprinted += data.reprinted ?? 0;
    for (const failure of data.failures ?? []) {
      if (!failures.some((f) => f.bill_id === failure.bill_id)) failures.push(failure);
    }

    onProgress?.({ assigned, reprinted, remaining: !!data.more_work });

    if (!data.more_work) break;
    carryIds = undefined;
    carryLogoId = undefined;
  }

  void logAudit({
    action: logoId ? "bill.logo_assigned" : "bill.logo_removed",
    targetType: "invoice_logo",
    targetId: logoId,
    detail: { bills: ids.length, assigned, unchanged, reprinted },
  });

  return { ok: true, assigned, unchanged, reprinted, more_work: false, failures };
}

/**
 * Re-print any bills whose stored documents no longer match their logo.
 *
 * Separate from assignment on purpose: it takes no bill ids and changes no
 * assignments, so it is also the right thing to call after an interrupted
 * operation, and after anything else that could leave a bill owing a re-print.
 * Returns 0 when there is nothing to do, which makes it safe to call on mount.
 */
export async function drainPendingLogoRenders(
  onProgress?: (progress: { reprinted: number; remaining: boolean }) => void
): Promise<{ reprinted: number; failures: BillLogoApplyResult["failures"] }> {
  let reprinted = 0;
  const failures: BillLogoApplyResult["failures"] = [];

  for (;;) {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      error?: string;
      reprinted?: number;
      more_work?: boolean;
      failures?: BillLogoApplyResult["failures"];
    }>("set-bill-logos", { body: { limit: 40 } });

    if (error || !data?.ok) break;
    reprinted += data.reprinted ?? 0;
    for (const failure of data.failures ?? []) {
      if (!failures.some((f) => f.bill_id === failure.bill_id)) failures.push(failure);
    }
    onProgress?.({ reprinted, remaining: !!data.more_work });
    if (!data.more_work) break;
  }

  return { reprinted, failures };
}

/**
 * Pull the JSON body out of a failed `functions.invoke`.
 *
 * Mirrors the helper in `bills.ts`: supabase-js hands back a `FunctionsHttpError`
 * whose `context` is the `Response`, and its text is the only place the server's
 * specific explanation lives. Duplicated rather than extracted because it is
 * thirteen lines and the alternative is a new shared module imported by one file
 * on top of the two services that already have it.
 */
async function readErrorBody(
  error: { context?: unknown; message?: string }
): Promise<{ error?: string; reason?: string } | null> {
  try {
    const ctx = error.context;
    if (ctx && typeof (ctx as Response).text === "function") {
      const text = await (ctx as Response).text();
      if (!text) return null;
      const parsed = JSON.parse(text) as { error?: string; reason?: string };
      return parsed && typeof parsed === "object" ? parsed : null;
    }
  } catch {
    // A body we cannot parse is not worth failing over; the transport message
    // below is still shown.
  }
  return null;
}

/* ──────────────────────────────────────────────
   Per-bill state
   ────────────────────────────────────────────── */

/**
 * Read a bill's logo state for the editor and the preview.
 *
 * Returns the embedded logo in the same request as the state, because the two are
 * always shown together and asking twice would show the button before the name it
 * needs.
 */
export async function fetchBillLogoState(billId: string): Promise<BillLogoState> {
  const { data, error } = await supabase
    .from(BILLS)
    .select("logo_id, logo_rendered_logo_id, invoice_logos!bills_logo_id_fkey(id, name, storage_path, pixel_width, pixel_height)")
    .eq("id", billId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const row = data as {
    logo_id: string | null;
    logo_rendered_logo_id: string | null;
    invoice_logos: BillLogoRef | null;
  } | null;

  return {
    logo_id: row?.logo_id ?? null,
    logo_rendered_logo_id: row?.logo_rendered_logo_id ?? null,
    logo: row?.invoice_logos ?? null,
  };
}

/* ──────────────────────────────────────────────
   Finding bills to assign to
   ────────────────────────────────────────────── */

/** One bill, as the "Assign to Bills" list needs it. */
export interface AssignableBill {
  id: string;
  invoice_no: string | null;
  /** The customer or company the invoice is billed to. */
  party_name: string | null;
  /** The job number, which is what an admin recognises an invoice by. */
  order_no: string | null;
  invoice_date: string | null;
  /** Which logo this bill already carries, so the list can mark it. */
  logo_id: string | null;
}

/** How many bills one page of the assign list holds. */
export const ASSIGN_PAGE_SIZE = 25;

/**
 * PostgREST's `or=(...)` grammar uses commas and parentheses as separators, so a
 * search term containing them changes the FILTER rather than the needle. Mirrors
 * `safeOrTerm` in `bills.ts`, which has the identical problem for the same reason.
 */
function safeOrTerm(raw: string): string {
  return raw.replace(/[,()%*]/g, " ").trim();
}

/**
 * Search bills for the "Assign to Bills" dialog, one page at a time.
 *
 * A SEPARATE QUERY FROM `fetchBills`, deliberately, and not a reuse of it:
 *
 *   - different columns. This searches the four things an admin actually types
 *     when hunting for an invoice — invoice number, customer, job number and date —
 *     while `fetchBills` searches invoice/sheet/GST/party and resolves the
 *     workbook filename through a second query. Changing that would change what
 *     the Bills screen's search box matches, which is not this feature's call to
 *     make.
 *
 *   - a fraction of the columns. `fetchBills` inner-joins the upload and returns
 *     fifty financial fields. A picker that only prints an invoice number, a
 *     customer, a job number and a date has no use for any of them, and on a
 *     Select-All over hundreds of bills that difference is the whole page weight.
 *
 * PAGINATED, AND THAT IS THE POINT
 * Select All here selects everything MATCHING THE CURRENT SEARCH, without the
 * client ever holding those rows. So a search that matches four hundred bills
 * costs the same as one that matches four, the checkbox still means "all of them",
 * and the phone is not asked to receive — or render — four hundred rows to tick
 * four hundred boxes.
 */
export async function fetchAssignableBills(
  search: string,
  page = 1,
  pageSize = ASSIGN_PAGE_SIZE
): Promise<{ rows: AssignableBill[]; total: number }> {
  const needle = safeOrTerm(search.trim());
  const from = (Math.max(1, page) - 1) * pageSize;

  let q = supabase
    .from(BILLS)
    .select("id, invoice_no, party_name, order_no, invoice_date, logo_id", { count: "exact" })
    // Newest first, with the id as a final tiebreak so two bills sharing a date
    // cannot swap places between pages and make a selection look like it lost rows.
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  if (needle) {
    q = q.or(
      [
        `invoice_no.ilike.%${needle}%`,
        `party_name.ilike.%${needle}%`,
        `order_no.ilike.%${needle}%`,
        /* A date typed as `2026-04` or `04/2026` is a partial match, not a range.
           The admin is looking for a bill they can see the date of, not composing a
           filter, and a range would silently exclude everything they typed. */
        `invoice_date.ilike.%${needle}%`,
      ].join(",")
    );
  }

  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);

  return { rows: (data ?? []) as AssignableBill[], total: count ?? 0 };
}

/* ──────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────── */

/** One line describing a bill's logo, for a list row or a subtitle. */
export function describeBillLogo(logoId: string | null, logos: Map<string, BillLogoRef>): string {
  if (!logoId) return "No Logo Assigned";
  return logos.get(logoId)?.name ?? "Logo assigned";
}
