export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

export async function uploadDispatchPhoto(
  source: string | Blob
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Missing Cloudinary configuration");
  }

  const formData = new FormData();
  formData.append("upload_preset", uploadPreset);

  if (typeof source === "string") {
    // Native (React Native)
    formData.append("file", {
      uri: source,
      type: "image/jpeg",
      name: "dispatch-photo.jpg",
    } as any);
  } else {
    // Web (File/Blob object)
    formData.append("file", source, "dispatch-photo.jpg");
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData,
      // IMPORTANT: Do NOT manually set "Content-Type": "multipart/form-data".
      // The browser/runtime will automatically set it with the correct boundary.
    }
  );

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      console.error("Cloudinary error response:", errorData);
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