// src/services/cloudinary.ts
// Adapted from MetalWorkerApp — general-purpose photo upload for admin
//
// Native upload uses Expo's File API (expo-file-system) + expo/fetch
// to avoid the "Unsupported FormDataPart Implementation" error from the
// old { uri, name, type } as unknown as Blob pattern.

import { Platform } from "react-native";

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

/**
 * Derive a sensible filename and MIME type from a file URI.
 */
function getFileMetadata(uri: string): { filename: string; mimeType: string } {
  const lastSegment = uri.split("/").pop() || "photo.jpg";
  // Strip any query string from the filename
  const filename = lastSegment.split("?")[0];
  const match = /\.(\w+)$/.exec(filename);
  const ext = match ? match[1].toLowerCase() : "jpg";

  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };

  return {
    filename,
    mimeType: mimeMap[ext] || "image/jpeg",
  };
}

/**
 * Upload an image to Cloudinary.
 * @param source – On native: a local file URI string (from expo-image-picker).
 *                 On web: a Blob, or a data-URI / object-URL string.
 */
export async function uploadPhoto(
  source: string | Blob
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Missing Cloudinary configuration. Check EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME and EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET in .env"
    );
  }

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  let response: Response;

  if (typeof source === "string" && Platform.OS !== "web") {
    // ─── Native path (iOS / Android) ───────────────────────────────
    // Use Expo's File from expo-file-system with expo/fetch.
    // This is the SDK 57+ supported way to upload local files via FormData.
    const { File: ExpoFile } = await import("expo-file-system");
    const { fetch: expoFetch } = await import("expo/fetch");

    const { filename } = getFileMetadata(source);
    const file = new ExpoFile(source);

    const formData = new FormData();
    formData.append("upload_preset", uploadPreset);
    formData.append("file", file as unknown as Blob, filename);

    response = await expoFetch(url, {
      method: "POST",
      body: formData,
    });
  } else {
    // ─── Web path ──────────────────────────────────────────────────
    const formData = new FormData();
    formData.append("upload_preset", uploadPreset);

    if (typeof source === "string") {
      // Web string source (data URI or object URL) → convert to Blob
      const blobResponse = await fetch(source);
      const blob = await blobResponse.blob();
      formData.append("file", blob, "photo.jpg");
    } else {
      // Direct Blob from web file input
      formData.append("file", source, "photo.jpg");
    }

    response = await fetch(url, {
      method: "POST",
      body: formData,
    });
  }

  // ─── Handle response ──────────────────────────────────────────────
  if (!response.ok) {
    let errorMessage = `Cloudinary upload failed (HTTP ${response.status})`;
    try {
      const errorData = await response.json();
      if (errorData?.error?.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      // Ignore JSON parse errors
    }
    console.error("[Cloudinary] Upload error:", errorMessage);
    throw new Error(errorMessage);
  }

  const data = await response.json();

  if (!data.secure_url || !data.public_id) {
    console.error("[Cloudinary] Invalid response:", data);
    throw new Error("Invalid response from Cloudinary");
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
  };
}
