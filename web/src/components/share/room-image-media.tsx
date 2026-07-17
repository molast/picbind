"use client";

import React from "react";
import {
  decodeBlurHash,
  type ImagePlaceholderMetadata,
} from "@/utils/share-placeholder";

type RoomImageMediaProps = {
  alt: string;
  src?: string;
  placeholder: ImagePlaceholderMetadata;
};

export default function RoomImageMedia({
  alt,
  src,
  placeholder,
}: RoomImageMediaProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null);
  const loaded = Boolean(src && loadedSrc === src);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (placeholder.pending) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    const scale = 32 / Math.max(placeholder.width, placeholder.height);
    const width = Math.max(1, Math.round(placeholder.width * scale));
    const height = Math.max(1, Math.round(placeholder.height * scale));
    try {
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = width;
      canvas.height = height;
      context.putImageData(
        new ImageData(
          decodeBlurHash(placeholder.blurHash, width, height),
          width,
          height,
        ),
        0,
        0,
      );
    } catch {
      // The dominant color remains as a valid fallback for malformed legacy data.
    }
  }, [placeholder]);

  return (
    <span
      className="relative block h-full w-full overflow-hidden"
      style={{ backgroundColor: placeholder.dominantColor }}
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded || placeholder.pending ? "opacity-0" : "opacity-100"}`}
        aria-hidden="true"
      />
      {src ? (
        // Blob URLs are local browser assets and cannot use the Next image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onLoad={() => setLoadedSrc(src)}
          className={`absolute inset-0 h-full w-full object-cover transition duration-300 hover:scale-[1.02] ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
    </span>
  );
}
