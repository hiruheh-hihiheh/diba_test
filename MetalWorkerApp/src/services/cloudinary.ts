export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
}

export async function uploadDispatchPhoto(uri: string): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Missing Cloudinary configuration");
  }

  const formData = new FormData();
  formData.append("upload_preset", uploadPreset);
  
  // React Native requires this specific object structure for file uploads
  formData.append("file", {
    uri,
    type: "image/jpeg",
    name: "dispatch-photo.jpg",
  } as any);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
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