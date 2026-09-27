// src/components/ui/ImageLightbox.tsx
//
// Full-screen image viewer.
//
// Every photo in this app (stock records, bill groups, drawing groups,
// dispatch photos, job drawings) used to be shown either as a 160px thumbnail
// you could not enlarge, or as a fixed-position panel whose close button sat
// outside the panel and was therefore unreachable. This component is the single
// viewer: click any thumbnail anywhere in the app, and the image opens here,
// sized to the viewport, with the close control inside the visible area.
//
// Keyboard: Escape closes, ArrowLeft / ArrowRight step through the set.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Images } from "lucide-react";

export interface LightboxImage {
  id: string;
  url: string;
  /** Accessible description, e.g. "Drawing photo 2 of 5". */
  label: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
  /** Rendered under the image, e.g. a delete button. */
  footer?: ReactNode;
}

export default function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  footer,
}: ImageLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = index >= 0 && index < images.length;
  const current = open ? images[index] : null;

  /* The keydown listener below is bound once per open, so it closes over
     whatever `index` was current at that moment. Reading `index` directly made
     every arrow press compute from the index the viewer opened at: ArrowRight
     jumped to image 2 and then did nothing, and ArrowLeft never moved at all.
     A ref mirrors the live index so the keyboard always steps from where the
     viewer actually is. The on-screen buttons were unaffected because they are
     re-rendered with the current `index` each time. */
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const go = (delta: number) => {
    const len = images.length;
    if (!len) return;
    onIndexChange((indexRef.current + delta + len) % len);
  };

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow, paddingRight } = document.body.style;
    // Lock the page behind the viewer and compensate for the scrollbar so the
    // image does not jump sideways when it appears.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, images.length]);

  if (!open || !current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-black/85 backdrop-blur-sm animate-overlay-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${current.label}`}
      onClick={onClose}
    >
      {/* Top bar — inside the viewport, so the close button is always clickable. */}
      <div
        className="flex items-center justify-between gap-3 px-4 sm:px-6 h-14 sm:h-16 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-white/90 text-sm font-semibold truncate">{current.label}</p>
        <div className="flex items-center gap-2">
          {images.length > 1 && (
            <span className="flex items-center gap-1.5 text-white/70 text-xs font-semibold tabular-nums">
              <Images size={15} />
              {index + 1} / {images.length}
            </span>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close image viewer (Esc)"
            title="Close (Esc)"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        className="flex-1 min-h-0 flex items-center justify-center gap-2 px-2 sm:px-4 pb-2"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous image"
            title="Previous (←)"
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0"
          >
            <ChevronLeft size={26} />
          </button>
        )}

        <img
          src={current.url}
          alt={current.label}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        />

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next image"
            title="Next (→)"
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0"
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>

      {footer && (
        <div
          className="flex items-center justify-center gap-3 px-4 sm:px-6 py-4 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {footer}
        </div>
      )}
    </div>,
    document.body
  );
}
