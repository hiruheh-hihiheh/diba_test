// src/services/cloudinary.ts
// Adapted from MetalWorkerApp — general-purpose photo upload for admin

import { Platform } from "react-native";

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

/**
 * Upload an image to Cloudinary.
 * @param source – On native: a local file URI string. On web: a Blob.
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

  const formData = new FormData();
  formData.append("upload_preset", uploadPreset);

  if (typeof source === "string") {
    // React Native (native platforms)
    if (Platform.OS === "web") {
      // On web, a string source is a data URI or object URL
      const response = await fetch(source);
      const blob = await response.blob();
      formData.append("file", blob, "photo.jpg");
    } else {
      // On native, use the file URI directly
      const fileUri = source;
      const filename = fileUri.split("/").pop() || "photo.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : "image/jpeg";

      formData.append("file", {
        uri: fileUri,
        name: filename,
        type,
      } as unknown as Blob);
    }
  } else {
    // Web Blob
    formData.append("file", source, "photo.jpg");
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

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
    throw new Error(errorMessage);
  }

  const data = await response.json();

  if (!data.secure_url || !data.public_id) {
    throw new Error("Invalid response from Cloudinary");
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
  };
}
