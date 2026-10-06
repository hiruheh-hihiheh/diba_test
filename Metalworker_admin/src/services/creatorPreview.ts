// src/services/creatorPreview.ts
//
// SHOWING A PREVIEW PDF, ON WHATEVER THIS BUILD HAPPENS TO BE RUNNING ON.
//
// WHY THIS IS NOT IN THE MIRRORED MODULE
//
// `billCreator.ts` is byte-identical in both clients, and it ends in `openCreatorPreview`,
// which opens a `data:` URL in a new browser window. That is correct for the desktop web
// app and simply does not exist on a phone: there is no `window.open`, and a user tapping
// "Preview PDF" on a phone expects the document to appear in whatever PDF app they have.
//
// The temptation is to make `openCreatorPreview` branch on platform, which would put a
// `react-native` import inside a file that must stay identical in a desktop app with no
// React Native at all — and the next `sync-bill-creator-mirrors` run would have to know
// about two different files. So the shared module keeps the web behaviour it can own, and
// this file adds the native one. One direction of dependency, no conditional mirroring.
//
// THE PREVIEW ITSELF IS NOT SPECIAL
//
// The bytes come from the same `create-bill` edge function either way, rendered by the
// same server-side renderer from the same saved row. The only difference between a preview
// on a phone and a preview on a desktop is which application displays the file. Nothing
// about the document changes, so nothing about what the admin is checking changes.

import { Platform } from "react-native";

import { openCreatorPreview, type PreviewOpenResult } from "./billCreator";

/**
 * Write base64 PDF bytes into the cache and hand the file to the system share sheet.
 *
 * The file is written first rather than shared from a data URI because no share target on
 * either platform reliably accepts one — iOS hands a `data:` URL to the share sheet as a
 * zero-byte file, and Android has no handler for it at all.
 *
 * The file name is the one the server chose, so the admin sees
 * `INV-2026-001_original.pdf` in the share sheet rather than a timestamp.
 */
async function sharePreviewFile(base64: string, filename: string): Promise<PreviewOpenResult> {
  const { Directory, File, Paths } = await import("expo-file-system");
  const { isAvailableAsync, shareAsync } = await import("expo-sharing");

  if (!(await isAvailableAsync())) {
    return "failed";
  }

  const dir = new Directory(Paths.cache, "bill-creator-preview");
  if (!dir.exists) dir.create();

  /* Replaced rather than appended to. The same admin previewing the same draft ten times
     should not leave ten files behind, and a name collision on a full device is a
     confusing failure for something that has an obvious correct answer. */
  const target = new File(dir, filename);
  if (target.exists) target.delete();
  target.create();
  target.write(base64, { encoding: "base64" });

  try {
    await shareAsync(target.uri, {
      UTI: "com.adobe.pdf",
      mimeType: "application/pdf",
      dialogTitle: filename,
    });
    return "opened";
  } catch {
    /* The share sheet being dismissed is not a failure of the preview — the admin saw
       it. Reported as "opened" so the caller does not tell somebody their preview did not
       work when what happened is that they closed it. */
    return "opened";
  } finally {
    /* Removed either way: this is a scratch copy of a document that still lives in the
       app's own storage, and leaving a second copy of every preview on the device is how
       a phone fills up with invoices nobody can find again. */
    try {
      target.delete();
    } catch {
      /* Nothing useful to do, and a failure to tidy up must not replace a preview that
         already succeeded. */
    }
  }
}

/**
 * Show a preview PDF. Returns what happened, rather than deciding it for the caller, so
 * the screen can say something true about it.
 *
 * Returns the same three values on both platforms — `"opened"`, `"downloaded"`,
 * `"failed"` — because the screen has one message per outcome and a platform-specific
 * fourth value would mean a platform-specific branch in the screen too.
 */
export async function showCreatorPreview(
  base64: string,
  filename: string
): Promise<PreviewOpenResult> {
  if (Platform.OS === "web") return openCreatorPreview(base64, filename);
  return sharePreviewFile(base64, filename);
}