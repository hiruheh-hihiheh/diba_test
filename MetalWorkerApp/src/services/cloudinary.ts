import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";

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
    // Expo / React Native
    const file = new File(source);

    if (!file.exists) {
      throw new Error("Selected image file does not exist");
    }

    formData.append("file", file);
  } else {
    // Web
    formData.append("file", source, "dispatch-photo.jpg");
  }

  const response = await expoFetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    let errorMessage = `Cloudinary upload failed. HTTP status: ${response.status}`;

    try {
      const errorData = await response.json();

      console.error("Cloudinary error response:", errorData);

      if (errorData?.error?.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      // Ignore JSON parsing errors.
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();

  if (!data.secure_url || !data.public_id) {
    console.error("Invalid Cloudinary response:", data);
    throw new Error("Invalid response from Cloudinary");
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
  };
}
