"use client";

type MagnifierPosition = {
  pointerX: number;
  pointerY: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

type ReviewMagnifierLensProps = {
  imageUrl: string;
  annotationSnapshot: string | null;
  position: MagnifierPosition;
  containerWidth: number;
  containerHeight: number;
  dimBackground: boolean;
};

const LENS_SIZE = 168;
const MAGNIFICATION = 2.5;
const GAP = 22;

export default function ReviewMagnifierLens({
  imageUrl,
  annotationSnapshot,
  position,
  containerWidth,
  containerHeight,
  dimBackground,
}: ReviewMagnifierLensProps) {
  const preferredLeft = position.pointerX + GAP;
  const left = Math.max(
    8,
    Math.min(
      containerWidth - LENS_SIZE - 8,
      preferredLeft + LENS_SIZE <= containerWidth
        ? preferredLeft
        : position.pointerX - LENS_SIZE - GAP,
    ),
  );
  const top = Math.max(
    8,
    Math.min(
      containerHeight - LENS_SIZE - 8,
      position.pointerY - LENS_SIZE / 2,
    ),
  );
  const backgroundPosition = `${LENS_SIZE / 2 - position.sourceX * MAGNIFICATION}px ${
    LENS_SIZE / 2 - position.sourceY * MAGNIFICATION
  }px`;
  const backgroundSize = `${position.sourceWidth * MAGNIFICATION}px ${
    position.sourceHeight * MAGNIFICATION
  }px`;
  const backgroundImages = [annotationSnapshot, imageUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => `url(${JSON.stringify(value)})`)
    .join(", ");

  return (
    <>
      {dimBackground ? (
        <div
          className="pointer-events-none absolute inset-0 z-30 bg-slate-950/40 backdrop-blur-[4px] backdrop-saturate-50"
          aria-hidden="true"
        />
      ) : null}
      <div
        className="pointer-events-none absolute z-40 overflow-hidden rounded-full border-4 border-white bg-white shadow-2xl ring-2 ring-blue-500"
        style={{
          left,
          top,
          width: LENS_SIZE,
          height: LENS_SIZE,
          backgroundImage: backgroundImages,
          backgroundRepeat: "no-repeat",
          backgroundSize: annotationSnapshot
            ? `${backgroundSize}, ${backgroundSize}`
            : backgroundSize,
          backgroundPosition: annotationSnapshot
            ? `${backgroundPosition}, ${backgroundPosition}`
            : backgroundPosition,
        }}
        aria-hidden="true"
      />
    </>
  );
}
