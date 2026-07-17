"use client";

import React from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Arrow,
  Ellipse,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type {
  ReviewAnnotation,
  ReviewTool,
} from "@/utils/review-collaboration";

type ReviewAnnotationLayerProps = {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  annotations: ReviewAnnotation[];
  activeTool: ReviewTool;
  selectedId: string | null;
  actorId: string;
  onSelect(id: string | null): void;
  onCreate(annotation: ReviewAnnotation): void;
  onUpdate(before: ReviewAnnotation, after: ReviewAnnotation): void;
};

function AnnotationNode({
  annotation,
  selected,
  selectable,
  onSelect,
  onUpdate,
}: {
  annotation: ReviewAnnotation;
  selected: boolean;
  selectable: boolean;
  onSelect(): void;
  onUpdate(after: ReviewAnnotation): void;
}) {
  const shapeRef = React.useRef<Konva.Node | null>(null);
  const transformerRef = React.useRef<Konva.Transformer | null>(null);

  React.useEffect(() => {
    if (!selected || !shapeRef.current || !transformerRef.current) return;
    transformerRef.current.nodes([shapeRef.current]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selected]);

  const shared = {
    ref: (node: Konva.Node | null) => {
      shapeRef.current = node;
    },
    x: annotation.x,
    y: annotation.y,
    scaleX: annotation.scaleX,
    scaleY: annotation.scaleY,
    rotation: annotation.rotation,
    draggable: selectable,
    onClick: (event: KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      if (selectable) onSelect();
    },
    onTap: (event: KonvaEventObject<TouchEvent>) => {
      event.cancelBubble = true;
      if (selectable) onSelect();
    },
    onDragEnd: (event: KonvaEventObject<DragEvent>) => {
      onUpdate({
        ...annotation,
        x: event.target.x(),
        y: event.target.y(),
      });
    },
    onTransformEnd: () => {
      const node = shapeRef.current;
      if (!node) return;
      onUpdate({
        ...annotation,
        x: node.x(),
        y: node.y(),
        scaleX: Math.max(0.05, node.scaleX()),
        scaleY: Math.max(0.05, node.scaleY()),
        rotation: node.rotation(),
      });
    },
  };

  let shape: React.ReactNode;
  if (annotation.type === "arrow") {
    shape = (
      <Arrow
        {...shared}
        points={annotation.points || [0, 0, annotation.width, annotation.height]}
        stroke={annotation.stroke}
        fill={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
        pointerLength={annotation.strokeWidth * 4}
        pointerWidth={annotation.strokeWidth * 3}
        lineCap="round"
        lineJoin="round"
      />
    );
  } else if (annotation.type === "rectangle") {
    shape = (
      <Rect
        {...shared}
        width={annotation.width}
        height={annotation.height}
        stroke={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
      />
    );
  } else if (annotation.type === "circle") {
    shape = (
      <Ellipse
        {...shared}
        x={annotation.x}
        y={annotation.y}
        radiusX={Math.max(1, annotation.width / 2)}
        radiusY={Math.max(1, annotation.height / 2)}
        stroke={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
      />
    );
  } else if (annotation.type === "pen") {
    shape = (
      <Line
        {...shared}
        points={annotation.points || []}
        stroke={annotation.stroke}
        strokeWidth={annotation.strokeWidth}
        lineCap="round"
        lineJoin="round"
        tension={0.35}
      />
    );
  } else {
    shape = (
      <Text
        {...shared}
        text={annotation.type === "emoji" ? annotation.emoji : annotation.text}
        width={Math.max(1, annotation.width)}
        height={Math.max(1, annotation.height)}
        fontSize={Math.max(12, annotation.height * 0.8)}
        fill={annotation.stroke}
        verticalAlign="middle"
      />
    );
  }

  return (
    <>
      {shape}
      {selected ? (
        <Transformer
          ref={transformerRef}
          flipEnabled={false}
          rotateEnabled
          borderStroke="#2563eb"
          anchorFill="#ffffff"
          anchorStroke="#2563eb"
          anchorSize={8}
          boundBoxFunc={(oldBox, newBox) =>
            Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8
              ? oldBox
              : newBox
          }
        />
      ) : null}
    </>
  );
}

function annotationAtPoint(
  tool: Exclude<ReviewTool, "select">,
  actorId: string,
  x: number,
  y: number,
  strokeWidth: number,
): ReviewAnnotation {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    type: tool,
    x,
    y,
    width: strokeWidth * 12,
    height: strokeWidth * 12,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    points: tool === "arrow" || tool === "pen" ? [0, 0, 0, 0] : undefined,
    text: tool === "text" ? "Text" : undefined,
    emoji: tool === "emoji" ? "👍" : undefined,
    stroke: "#ef4444",
    strokeWidth,
    createdBy: actorId,
  };
}

export default function ReviewAnnotationLayer({
  width,
  height,
  imageWidth,
  imageHeight,
  annotations,
  activeTool,
  selectedId,
  actorId,
  onSelect,
  onCreate,
  onUpdate,
}: ReviewAnnotationLayerProps) {
  const [draft, setDraft] = React.useState<ReviewAnnotation | null>(null);
  const draftRef = React.useRef<ReviewAnnotation | null>(null);
  const drawOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const scaleX = width / Math.max(1, imageWidth);
  const scaleY = height / Math.max(1, imageHeight);
  const point = (stage: Konva.Stage) => {
    const pointer = stage.getPointerPosition() || { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(imageWidth, pointer.x / scaleX)),
      y: Math.max(0, Math.min(imageHeight, pointer.y / scaleY)),
    };
  };

  const start = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (activeTool === "select") {
      if (event.target === event.target.getStage()) onSelect(null);
      return;
    }
    const stage = event.target.getStage();
    if (!stage) return;
    const current = point(stage);
    const strokeWidth = Math.max(3, Math.max(imageWidth, imageHeight) * 0.004);
    const next = annotationAtPoint(
      activeTool,
      actorId,
      current.x,
      current.y,
      strokeWidth,
    );
    if (activeTool === "text") {
      const value = window.prompt("Text", "");
      if (!value?.trim()) return;
      onCreate({ ...next, text: value.trim(), width: strokeWidth * 35 });
      return;
    }
    if (activeTool === "emoji") {
      onCreate(next);
      return;
    }
    draftRef.current = next;
    drawOriginRef.current = current;
    setDraft(next);
  };

  const move = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
    const currentDraft = draftRef.current;
    const origin = drawOriginRef.current;
    const stage = event.target.getStage();
    if (!currentDraft || !origin || !stage) return;
    const current = point(stage);
    let next: ReviewAnnotation;
    if (currentDraft.type === "pen") {
      const points = currentDraft.points || [0, 0];
      const lastX = points[points.length - 2] + currentDraft.x;
      const lastY = points[points.length - 1] + currentDraft.y;
      if (Math.hypot(current.x - lastX, current.y - lastY) < currentDraft.strokeWidth) {
        return;
      }
      next = {
        ...currentDraft,
        points: [...points, current.x - currentDraft.x, current.y - currentDraft.y].slice(
          0,
          512,
        ),
        width: Math.max(currentDraft.width, Math.abs(current.x - currentDraft.x)),
        height: Math.max(currentDraft.height, Math.abs(current.y - currentDraft.y)),
      };
    } else {
      const dx = current.x - origin.x;
      const dy = current.y - origin.y;
      next = {
        ...currentDraft,
        points: currentDraft.type === "arrow" ? [0, 0, dx, dy] : undefined,
        width: Math.max(1, Math.abs(dx)),
        height: Math.max(1, Math.abs(dy)),
        x:
          currentDraft.type === "circle"
            ? (origin.x + current.x) / 2
            : currentDraft.type === "rectangle"
              ? Math.min(origin.x, current.x)
              : origin.x,
        y:
          currentDraft.type === "circle"
            ? (origin.y + current.y) / 2
            : currentDraft.type === "rectangle"
              ? Math.min(origin.y, current.y)
              : origin.y,
      };
    }
    draftRef.current = next;
    setDraft(next);
  };

  const finish = () => {
    const current = draftRef.current;
    draftRef.current = null;
    drawOriginRef.current = null;
    setDraft(null);
    if (!current) return;
    const arrowPoints = current.type === "arrow" ? current.points || [] : [];
    const valid =
      current.type === "pen"
        ? (current.points?.length || 0) >= 4
        : current.type === "arrow"
          ? arrowPoints.length >= 4 &&
            Math.hypot(arrowPoints[2], arrowPoints[3]) > current.strokeWidth
          : current.width > current.strokeWidth &&
            current.height > current.strokeWidth;
    if (valid) {
      onCreate(current);
    }
  };

  return (
    <Stage
      width={width}
      height={height}
      onMouseDown={start}
      onTouchStart={start}
      onMouseMove={move}
      onTouchMove={move}
      onMouseUp={finish}
      onTouchEnd={finish}
    >
      <Layer scaleX={scaleX} scaleY={scaleY}>
        {annotations.map((annotation) => (
          <AnnotationNode
            key={annotation.id}
            annotation={annotation}
            selected={selectedId === annotation.id}
            selectable={activeTool === "select"}
            onSelect={() => onSelect(annotation.id)}
            onUpdate={(after) => onUpdate(annotation, after)}
          />
        ))}
        {draft ? (
          <AnnotationNode
            annotation={draft}
            selected={false}
            selectable={false}
            onSelect={() => undefined}
            onUpdate={() => undefined}
          />
        ) : null}
      </Layer>
    </Stage>
  );
}
