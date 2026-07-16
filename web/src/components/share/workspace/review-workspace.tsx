"use client";

import React from "react";
import type { ShareRoomLabels } from "../share-room-labels";
import type { RoomImage } from "../share-room-types";
import ReviewCanvas, { type ReviewViewportOffset } from "./review-canvas";
import ReviewStatusBar from "./review-status-bar";
import ReviewToolbar from "./review-toolbar";

type ReviewWorkspaceProps = {
  image: RoomImage;
  labels: ShareRoomLabels;
  onBack(): void;
};

export default function ReviewWorkspace({
  image,
  labels,
  onBack,
}: ReviewWorkspaceProps) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState<ReviewViewportOffset>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = React.useState<{
    width: number;
    height: number;
  } | null>(null);

  const resetViewport = React.useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    resetViewport();
    setDimensions(null);
  }, [image.id, resetViewport]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <ReviewToolbar
        imageName={image.name}
        zoomPercent={Math.round(scale * 100)}
        labels={labels}
        onBack={onBack}
        onZoomIn={() => setScale((current) => Math.min(4, current + 0.25))}
        onZoomOut={() => setScale((current) => Math.max(0.25, current - 0.25))}
        onFit={resetViewport}
        onReset={resetViewport}
      />
      <ReviewCanvas
        image={image}
        scale={scale}
        offset={offset}
        onScaleChange={setScale}
        onOffsetChange={setOffset}
        onDimensionsChange={setDimensions}
      />
      <ReviewStatusBar image={image} dimensions={dimensions} />
    </div>
  );
}
