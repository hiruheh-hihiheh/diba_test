// src/components/bills/LogoThumbnail.tsx
//
// A logo's picture, for the library, the pickers and the bill detail.
//
// ASPECT RATIO IS PRESERVED, ALWAYS
// `object-contain` inside a fixed box: the image is fitted to the box, never
// stretched to fill it. This is the same rule the PDF renderer follows, so what
// the admin sees here is what prints. A stretched preview would make a correct
// logo look wrong, and the admin would "fix" a logo that was already fine.

import { ImageOff } from "lucide-react";

import { useLogoImageUrls } from "./useLogoImageUrls";

/** One logo's picture, sized to fit a box without ever distorting it. */
export function LogoThumbnail({
  logoId,
  size = 56,
  className = "",
}: {
  logoId: string;
  size?: number;
  className?: string;
}) {
  const urls = useLogoImageUrls([logoId]);
  const url = urls.get(logoId);

  if (!url) {
    /* A neutral placeholder rather than a spinner that never resolves: the fetch
       is fast, and a permanent-looking empty box reads as a broken image. */
    return (
      <div
        className={`rounded-lg bg-surface-hover border border-border flex items-center justify-center shrink-0 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <ImageOff size={Math.round(size * 0.35)} className="text-text-muted/40" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className={`rounded-lg object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export default LogoThumbnail;