"use client";

import React from "react";
import Konva from "konva";
import type {
  ReviewAnnotation,
  ReviewStrokeStyle,
  ReviewTool,
} from "@/utils/review-collaboration";

const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M18.5 8A7 7 0 1 0 19 15' fill='none' stroke='%230f172a' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M16 4.5 19 8l-4.5 1' fill='none' stroke='%230f172a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 12 12, grab`;

type ReviewAnnotationLayerProps = {
  width: number;
  height: number;
  viewportScale: number;
  imageWidth: number;
  imageHeight: number;
  annotations: ReviewAnnotation[];
  activeTool: ReviewTool;
  selectedIds: string[];
  actorId: string;
  defaultColor: string;
  defaultStrokeRatio: number;
  arrowStyle: ReviewStrokeStyle;
  lineStyle: ReviewStrokeStyle;
  onSelect(ids: string[]): void;
  onTextRequest(position: { x: number; y: number; strokeWidth: number }): void;
  onTextEditRequest(annotation: ReviewAnnotation, caretIndex: number): void;
  onCreate(annotation: ReviewAnnotation): void;
  onUpdate(before: ReviewAnnotation, after: ReviewAnnotation): void;
};

function annotationAtPoint(
  tool: Exclude<ReviewTool, "select" | "hand">,
  actorId: string,
  x: number,
  y: number,
  strokeWidth: number,
  stroke: string,
  strokeStyle?: ReviewStrokeStyle,
): ReviewAnnotation {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    type: tool,
    x,
    y,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    points: tool === "arrow" || tool === "line" || tool === "pen" ? [0, 0] : undefined,
    text: tool === "text" ? "Text" : undefined,
    emoji: tool === "emoji" ? "👍" : undefined,
    stroke,
    strokeWidth,
    strokeStyle,
    createdBy: actorId,
  };
}

function createAnnotationNode(
  annotation: ReviewAnnotation,
  selectable: boolean,
) {
  const dash =
    annotation.strokeStyle === "dashed"
      ? [annotation.strokeWidth * 4, annotation.strokeWidth * 2.5]
      : annotation.strokeStyle === "dotted"
        ? [Math.max(0.01, annotation.strokeWidth * 0.1), annotation.strokeWidth * 2.2]
        : [];
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
      strokeScaleEnabled: false,
      dash,
      lineCap: "round",
      lineJoin: "round",
    });
  }
  if (annotation.type === "line") {
    return new Konva.Line({
      ...shared,
      points: annotation.points || [0, 0, annotation.width, annotation.height],
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
      strokeScaleEnabled: false,
      dash,
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
      strokeScaleEnabled: false,
    });
  }
  if (annotation.type === "circle") {
    return new Konva.Ellipse({
      ...shared,
      radiusX: Math.max(0, annotation.width / 2),
      radiusY: Math.max(0, annotation.height / 2),
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
      strokeScaleEnabled: false,
    });
  }
  if (annotation.type === "pen") {
    return new Konva.Line({
      ...shared,
      points: annotation.points || [],
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
      strokeScaleEnabled: false,
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
  const selectionLayerRef = React.useRef<Konva.Layer | null>(null);
  const transformerRef = React.useRef<Konva.Transformer | null>(null);
  const draftRef = React.useRef<ReviewAnnotation | null>(null);
  const draftNodeRef = React.useRef<Konva.Node | null>(null);
  const drawOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const selectionOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const selectionRectRef = React.useRef<Konva.Rect | null>(null);
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
    const selectionLayer = new Konva.Layer({ listening: false });
    stage.add(layer);
    stage.add(selectionLayer);
    stageRef.current = stage;
    layerRef.current = layer;
    selectionLayerRef.current = selectionLayer;

    const requestTextEdit = (annotation: ReviewAnnotation, node: Konva.Node) => {
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
      propsRef.current.onSelect([]);
      propsRef.current.onTextEditRequest(annotation, caretIndex);
    };

    const handleNativeDoubleClick = (event: MouseEvent) => {
      if (propsRef.current.activeTool !== "select") return;
      stage.setPointersPositions(event);
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const node = stage.getIntersection(pointer);
      if (!node) return;
      const annotation = propsRef.current.annotations.find(
        (item) => item.id === node.id() && item.type === "text",
      );
      if (!annotation) return;
      event.preventDefault();
      requestTextEdit(annotation, node);
    };
    stage.content.addEventListener("dblclick", handleNativeDoubleClick);

    const start = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const currentProps = propsRef.current;
      if (currentProps.activeTool === "hand") return;
      if (currentProps.activeTool === "select") {
        if (event.target === stage) {
          currentProps.onSelect([]);
          const current = pointInImage(stage);
          selectionOriginRef.current = current;
          selectionRectRef.current?.destroy();
          const rect = new Konva.Rect({
            x: current.x,
            y: current.y,
            width: 0,
            height: 0,
            fill: "rgba(37, 99, 235, 0.12)",
            stroke: "#2563eb",
            strokeWidth: Math.max(1, currentProps.imageWidth * 0.001),
            dash: [6, 4],
            strokeScaleEnabled: false,
            listening: false,
          });
          selectionRectRef.current = rect;
          selectionLayer.add(rect);
          selectionLayer.batchDraw();
        }
        return;
      }
      const current = pointInImage(stage);
      const strokeRatio =
        currentProps.activeTool === "text" ? 0.004 : currentProps.defaultStrokeRatio;
      const strokeWidth = Math.max(
        currentProps.activeTool === "text" ? 3 : 1,
        Math.max(currentProps.imageWidth, currentProps.imageHeight) * strokeRatio,
      );
      const next = annotationAtPoint(
        currentProps.activeTool,
        currentProps.actorId,
        current.x,
        current.y,
        strokeWidth,
        currentProps.defaultColor,
        currentProps.activeTool === "arrow"
          ? currentProps.arrowStyle
          : currentProps.activeTool === "line"
            ? currentProps.lineStyle
            : undefined,
      );
      if (currentProps.activeTool === "text") {
        currentProps.onSelect([]);
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
      const selectionOrigin = selectionOriginRef.current;
      const selectionRect = selectionRectRef.current;
      if (selectionOrigin && selectionRect) {
        const current = pointInImage(stage);
        selectionRect.setAttrs({
          x: Math.min(selectionOrigin.x, current.x),
          y: Math.min(selectionOrigin.y, current.y),
          width: Math.abs(current.x - selectionOrigin.x),
          height: Math.abs(current.y - selectionOrigin.y),
        });
        selectionLayer.batchDraw();
        return;
      }
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
          points:
            currentDraft.type === "arrow" || currentDraft.type === "line"
              ? [0, 0, dx, dy]
              : undefined,
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
      const selectionRect = selectionRectRef.current;
      if (selectionOriginRef.current && selectionRect) {
        const box = selectionRect.getClientRect({ relativeTo: selectionLayer });
        const selected =
          box.width > 2 && box.height > 2
            ? propsRef.current.annotations
                .filter((annotation) => {
                  const node = layer.findOne(`#${annotation.id}`);
                  return Boolean(
                    node &&
                      Konva.Util.haveIntersection(
                        box,
                        node.getClientRect({ relativeTo: layer }),
                      ),
                  );
                })
                .map((annotation) => annotation.id)
            : [];
        selectionOriginRef.current = null;
        selectionRectRef.current = null;
        selectionRect.destroy();
        selectionLayer.batchDraw();
        propsRef.current.onSelect(selected);
        return;
      }
      const current = draftRef.current;
      draftRef.current = null;
      drawOriginRef.current = null;
      draftNodeRef.current?.destroy();
      draftNodeRef.current = null;
      layer.batchDraw();
      if (!current) return;
      const linearPoints =
        current.type === "arrow" || current.type === "line"
          ? current.points || []
          : [];
      const valid =
        current.type === "pen"
          ? (current.points?.length || 0) >= 4
          : current.type === "arrow" || current.type === "line"
            ? linearPoints.length >= 4 &&
              Math.hypot(linearPoints[2], linearPoints[3]) > current.strokeWidth
            : current.width > current.strokeWidth &&
              current.height > current.strokeWidth;
      if (valid) propsRef.current.onCreate(current);
    };

    stage.on("mousedown touchstart", start);
    stage.on("mousemove touchmove", move);
    stage.on("mouseup touchend", finish);
    return () => {
      stage.content.removeEventListener("dblclick", handleNativeDoubleClick);
      stage.destroy();
      stageRef.current = null;
      layerRef.current = null;
      selectionLayerRef.current = null;
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
    const controlScale = Math.max(scaleX, scaleY) * props.viewportScale;
    layer.scale({ x: scaleX, y: scaleY });
    selectionLayerRef.current?.scale({ x: scaleX, y: scaleY });

    const selectedNodes: Konva.Node[] = [];
    for (const annotation of props.annotations) {
      const node = createAnnotationNode(annotation, props.activeTool === "select");
      node.on("click tap", (event) => {
        event.cancelBubble = true;
        if (propsRef.current.activeTool === "select") {
          propsRef.current.onSelect([annotation.id]);
        }
      });
      if (annotation.type === "text") {
        node.on("mouseenter", () => {
          stage.content.style.cursor = "text";
        });
        node.on("mouseleave", () => {
          stage.content.style.cursor = "";
        });
        node.on("dbltap", (event) => {
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
          propsRef.current.onSelect([]);
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
      if (props.selectedIds.includes(annotation.id)) selectedNodes.push(node);
    }

    const transformer = new Konva.Transformer({
      flipEnabled: false,
      keepRatio: false,
      rotateEnabled: true,
      rotateAnchorCursor: ROTATE_CURSOR,
      rotateAnchorOffset: 12 / controlScale,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 4,
      borderStroke: "#2563eb",
      anchorFill: "#ffffff",
      anchorStroke: "#2563eb",
      anchorSize: 2 / controlScale,
      anchorStyleFunc: (anchor) => {
        anchor.hitStrokeWidth(12 / controlScale);
        if (!anchor.hasName("rotater")) return;
        const size = 7 / controlScale;
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
    if (selectedNodes.length) transformer.nodes(selectedNodes);
    const rotateAnchor = transformer.findOne<Konva.Rect>(".rotater");
    rotateAnchor?.on("mouseenter", () => {
      stage.content.style.cursor = ROTATE_CURSOR;
    });
    rotateAnchor?.on("mouseleave", () => {
      stage.content.style.cursor = "";
    });
    layer.draw();
  }, [
    props.activeTool,
    props.annotations,
    props.arrowStyle,
    props.defaultColor,
    props.defaultStrokeRatio,
    props.height,
    props.imageHeight,
    props.imageWidth,
    props.lineStyle,
    props.selectedIds,
    props.viewportScale,
    props.width,
  ]);

  return <div ref={containerRef} className="h-full w-full" />;
}
