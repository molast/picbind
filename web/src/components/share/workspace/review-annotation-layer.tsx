"use client";

import React from "react";
import Konva from "konva";
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
  defaultColor: string;
  onSelect(id: string | null): void;
  onTextRequest(position: { x: number; y: number; strokeWidth: number }): void;
  onTextEditRequest(annotation: ReviewAnnotation, caretIndex: number): void;
  onCreate(annotation: ReviewAnnotation): void;
  onUpdate(before: ReviewAnnotation, after: ReviewAnnotation): void;
};

function annotationAtPoint(
  tool: Exclude<ReviewTool, "select">,
  actorId: string,
  x: number,
  y: number,
  strokeWidth: number,
  stroke: string,
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
    stroke,
    strokeWidth,
    createdBy: actorId,
  };
}

function createAnnotationNode(
  annotation: ReviewAnnotation,
  selectable: boolean,
) {
  const shared: Konva.NodeConfig = {
    id: annotation.id,
    x: annotation.x,
    y: annotation.y,
    scaleX: annotation.scaleX,
    scaleY: annotation.scaleY,
    rotation: annotation.rotation,
    draggable: selectable,
  };
  if (annotation.type === "arrow") {
    return new Konva.Arrow({
      ...shared,
      points: annotation.points || [0, 0, annotation.width, annotation.height],
      stroke: annotation.stroke,
      fill: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
      pointerLength: annotation.strokeWidth * 4,
      pointerWidth: annotation.strokeWidth * 3,
      lineCap: "round",
      lineJoin: "round",
    });
  }
  if (annotation.type === "rectangle") {
    return new Konva.Rect({
      ...shared,
      width: annotation.width,
      height: annotation.height,
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
    });
  }
  if (annotation.type === "circle") {
    return new Konva.Ellipse({
      ...shared,
      radiusX: Math.max(1, annotation.width / 2),
      radiusY: Math.max(1, annotation.height / 2),
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
    });
  }
  if (annotation.type === "pen") {
    return new Konva.Line({
      ...shared,
      points: annotation.points || [],
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
      lineCap: "round",
      lineJoin: "round",
      tension: 0.35,
    });
  }
  return new Konva.Text({
    ...shared,
    text: annotation.type === "emoji" ? annotation.emoji : annotation.text,
    width: Math.max(1, annotation.width),
    height: Math.max(1, annotation.height),
    fontSize: Math.max(12, annotation.height * 0.8),
    fill: annotation.stroke,
    verticalAlign: "middle",
  });
}

export default function ReviewAnnotationLayer(props: ReviewAnnotationLayerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<Konva.Stage | null>(null);
  const layerRef = React.useRef<Konva.Layer | null>(null);
  const transformerRef = React.useRef<Konva.Transformer | null>(null);
  const draftRef = React.useRef<ReviewAnnotation | null>(null);
  const draftNodeRef = React.useRef<Konva.Node | null>(null);
  const drawOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const propsRef = React.useRef(props);
  propsRef.current = props;

  const pointInImage = React.useCallback((stage: Konva.Stage) => {
    const current = propsRef.current;
    const pointer = stage.getPointerPosition() || { x: 0, y: 0 };
    return {
      x: Math.max(
        0,
        Math.min(
          current.imageWidth,
          pointer.x / (current.width / Math.max(1, current.imageWidth)),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          current.imageHeight,
          pointer.y / (current.height / Math.max(1, current.imageHeight)),
        ),
      ),
    };
  }, []);

  const drawDraft = React.useCallback((annotation: ReviewAnnotation) => {
    const layer = layerRef.current;
    if (!layer) return;
    draftNodeRef.current?.destroy();
    const node = createAnnotationNode(annotation, false);
    draftNodeRef.current = node;
    layer.add(node);
    layer.batchDraw();
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const stage = new Konva.Stage({
      container,
      width: propsRef.current.width,
      height: propsRef.current.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    stageRef.current = stage;
    layerRef.current = layer;

    const start = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const currentProps = propsRef.current;
      if (currentProps.activeTool === "select") {
        if (event.target === stage) {
          currentProps.onSelect(null);
        }
        return;
      }
      const current = pointInImage(stage);
      const strokeWidth = Math.max(
        3,
        Math.max(currentProps.imageWidth, currentProps.imageHeight) * 0.004,
      );
      const next = annotationAtPoint(
        currentProps.activeTool,
        currentProps.actorId,
        current.x,
        current.y,
        strokeWidth,
        currentProps.defaultColor,
      );
      if (currentProps.activeTool === "text") {
        currentProps.onSelect(null);
        currentProps.onTextRequest({
          x: current.x,
          y: current.y,
          strokeWidth,
        });
        return;
      }
      draftRef.current = next;
      drawOriginRef.current = current;
      drawDraft(next);
    };

    const move = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const currentDraft = draftRef.current;
      const origin = drawOriginRef.current;
      if (!currentDraft || !origin) return;
      const current = pointInImage(stage);
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
          points: [...points, current.x - origin.x, current.y - origin.y].slice(0, 512),
          width: Math.max(currentDraft.width, Math.abs(current.x - origin.x)),
          height: Math.max(currentDraft.height, Math.abs(current.y - origin.y)),
        };
      } else {
        const dx = current.x - origin.x;
        const dy = current.y - origin.y;
        const constrained =
          (currentDraft.type === "rectangle" || currentDraft.type === "circle") &&
          event.evt.shiftKey;
        const centered =
          (currentDraft.type === "rectangle" || currentDraft.type === "circle") &&
          event.evt.altKey;
        const extent = Math.max(Math.abs(dx), Math.abs(dy));
        const shapeDx = constrained
          ? (dx < 0 ? -1 : 1) * extent
          : dx;
        const shapeDy = constrained
          ? (dy < 0 ? -1 : 1) * extent
          : dy;
        const shapeWidth = Math.max(1, Math.abs(shapeDx) * (centered ? 2 : 1));
        const shapeHeight = Math.max(1, Math.abs(shapeDy) * (centered ? 2 : 1));
        next = {
          ...currentDraft,
          points: currentDraft.type === "arrow" ? [0, 0, dx, dy] : undefined,
          width: shapeWidth,
          height: shapeHeight,
          x:
            currentDraft.type === "circle"
              ? centered
                ? origin.x
                : origin.x + shapeDx / 2
              : currentDraft.type === "rectangle"
                ? centered
                  ? origin.x - shapeWidth / 2
                  : Math.min(origin.x, origin.x + shapeDx)
                : origin.x,
          y:
            currentDraft.type === "circle"
              ? centered
                ? origin.y
                : origin.y + shapeDy / 2
              : currentDraft.type === "rectangle"
                ? centered
                  ? origin.y - shapeHeight / 2
                  : Math.min(origin.y, origin.y + shapeDy)
                : origin.y,
        };
      }
      draftRef.current = next;
      drawDraft(next);
    };

    const finish = () => {
      const current = draftRef.current;
      draftRef.current = null;
      drawOriginRef.current = null;
      draftNodeRef.current?.destroy();
      draftNodeRef.current = null;
      layer.batchDraw();
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
      if (valid) propsRef.current.onCreate(current);
    };

    stage.on("mousedown touchstart", start);
    stage.on("mousemove touchmove", move);
    stage.on("mouseup touchend", finish);
    return () => {
      stage.destroy();
      stageRef.current = null;
      layerRef.current = null;
      transformerRef.current = null;
    };
  }, [drawDraft, pointInImage]);

  React.useEffect(() => {
    const stage = stageRef.current;
    const layer = layerRef.current;
    if (!stage || !layer) return;
    stage.size({ width: props.width, height: props.height });
    layer.destroyChildren();
    draftNodeRef.current = null;
    const scaleX = props.width / Math.max(1, props.imageWidth);
    const scaleY = props.height / Math.max(1, props.imageHeight);
    layer.scale({ x: scaleX, y: scaleY });

    let selectedNode: Konva.Node | null = null;
    for (const annotation of props.annotations) {
      const node = createAnnotationNode(annotation, props.activeTool === "select");
      node.on("click tap", (event) => {
        event.cancelBubble = true;
        if (propsRef.current.activeTool === "select") {
          propsRef.current.onSelect(annotation.id);
        }
      });
      if (annotation.type === "text") {
        node.on("dblclick dbltap", (event) => {
          event.cancelBubble = true;
          if (propsRef.current.activeTool !== "select") return;
          const pointer = node.getRelativePointerPosition();
          const text = annotation.text || "";
          const caretIndex = pointer
            ? Math.max(
                0,
                Math.min(
                  text.length,
                  Math.round((pointer.x / Math.max(1, annotation.width)) * text.length),
                ),
              )
            : text.length;
          propsRef.current.onSelect(null);
          propsRef.current.onTextEditRequest(annotation, caretIndex);
        });
      }
      node.on("dragend", () => {
        propsRef.current.onUpdate(annotation, {
          ...annotation,
          x: node.x(),
          y: node.y(),
        });
      });
      node.on("transformend", () => {
        propsRef.current.onUpdate(annotation, {
          ...annotation,
          x: node.x(),
          y: node.y(),
          scaleX: Math.max(0.05, node.scaleX()),
          scaleY: Math.max(0.05, node.scaleY()),
          rotation: node.rotation(),
        });
      });
      layer.add(node);
      if (annotation.id === props.selectedId) selectedNode = node;
    }

    const transformer = new Konva.Transformer({
      flipEnabled: false,
      rotateEnabled: true,
      rotateAnchorCursor: "grab",
      rotateAnchorOffset: 22 / Math.max(scaleX, scaleY),
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 4,
      borderStroke: "#2563eb",
      anchorFill: "#ffffff",
      anchorStroke: "#2563eb",
      anchorSize: 2 / Math.max(scaleX, scaleY),
      anchorStyleFunc: (anchor) => {
        anchor.hitStrokeWidth(12 / Math.max(scaleX, scaleY));
        if (!anchor.hasName("rotater")) return;
        const size = 7 / Math.max(scaleX, scaleY);
        anchor.width(size);
        anchor.height(size);
        anchor.offsetX(size / 2);
        anchor.offsetY(size / 2);
        anchor.cornerRadius(size / 2);
        anchor.fill("#2563eb");
      },
      boundBoxFunc: (oldBox, newBox) =>
        Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8
          ? oldBox
          : newBox,
    });
    transformerRef.current = transformer;
    layer.add(transformer);
    if (selectedNode) transformer.nodes([selectedNode]);
    layer.draw();
  }, [
    props.activeTool,
    props.annotations,
    props.defaultColor,
    props.height,
    props.imageHeight,
    props.imageWidth,
    props.selectedId,
    props.width,
  ]);

  return <div ref={containerRef} className="h-full w-full" />;
}
