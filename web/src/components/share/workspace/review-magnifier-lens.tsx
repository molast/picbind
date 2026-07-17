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
  position: MagnifierPosition;
  containerWidth: number;
  containerHeight: number;
};

const LENS_SIZE = 168;
const MAGNIFICATION = 2.5;
const GAP = 22;

export default function ReviewMagnifierLens({
  imageUrl,
  position,
  containerWidth,
  containerHeight,
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

  return (
    <div
      className="pointer-events-none absolute z-40 overflow-hidden rounded-full border-4 border-white bg-white shadow-2xl ring-2 ring-blue-500"
      style={{
        left,
        top,
        width: LENS_SIZE,
        height: LENS_SIZE,
        backgroundImage: `url(${JSON.stringify(imageUrl)})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${position.sourceWidth * MAGNIFICATION}px ${position.sourceHeight * MAGNIFICATION}px`,
        backgroundPosition: `${LENS_SIZE / 2 - position.sourceX * MAGNIFICATION}px ${
          LENS_SIZE / 2 - position.sourceY * MAGNIFICATION
        }px`,
      }}
      aria-hidden="true"
    />
  );
}
