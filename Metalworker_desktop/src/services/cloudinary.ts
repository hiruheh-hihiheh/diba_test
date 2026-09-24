// src/services/cloudinary.ts
// Browser-native Cloudinary upload (no Expo/React Native dependencies)

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

/**
 * Upload an image to Cloudinary from the browser.
 * @param source — A File object from file input, a Blob, or a data-URI/object-URL string.
 */
export async function uploadPhoto(
  source: File | Blob | string
): Promise<CloudinaryUploadResult> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Missing Cloudinary configuration. Check VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env"
    );
  }

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const formData = new FormData();
  formData.append("upload_preset", uploadPreset);

  if (typeof source === "string") {
    // String source (data URI or object URL) → convert to Blob
    const blobResponse = await fetch(source);
    const blob = await blobResponse.blob();
    formData.append("file", blob, "photo.jpg");
  } else {
    // File or Blob
    formData.append("file", source, source instanceof File ? source.name : "photo.jpg");
  }

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

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
