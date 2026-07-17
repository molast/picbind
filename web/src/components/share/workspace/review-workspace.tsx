"use client";

import React from "react";
import type { ShareRoomLabels } from "../share-room-labels";
import type { RoomImage } from "../share-room-types";
import type {
  ReviewAnnotation,
  ReviewCollaborationMessage,
  ReviewMode,
  ReviewStrokeStyle,
  ReviewTool,
} from "@/utils/review-collaboration";
import ReviewCanvas, { type ReviewViewportOffset } from "./review-canvas";
import ReviewStatusBar from "./review-status-bar";
import ReviewToolbar from "./review-toolbar";
import { useReviewHistory } from "./use-review-history";

type ReviewWorkspaceProps = {
  image: RoomImage;
  labels: ShareRoomLabels;
  actorId: string;
  subscribeMessages(
    listener: (event: {
      sequence: number;
      message: ReviewCollaborationMessage;
    }) => void,
  ): () => void;
  onSendMessage(message: ReviewCollaborationMessage): boolean;
  onBack(): void;
};

type IncomingState = {
  total: number;
  cursor: number;
  operations: Array<
    Extract<ReviewCollaborationMessage, { type: "REVIEW_OPERATION" }>["operation"] | null
  >;
};

export default function ReviewWorkspace({
  image,
  labels,
  actorId,
  subscribeMessages,
  onSendMessage,
  onBack,
}: ReviewWorkspaceProps) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState<ReviewViewportOffset>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
  const [activeTool, setActiveTool] = React.useState<ReviewTool>("select");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [defaultColor, setDefaultColor] = React.useState("#000000");
  const [defaultStrokeRatio, setDefaultStrokeRatio] = React.useState(0.0015);
  const [arrowStyle, setArrowStyle] = React.useState<ReviewStrokeStyle>("solid");
  const [lineStyle, setLineStyle] = React.useState<ReviewStrokeStyle>("solid");
  const [localMode, setLocalMode] = React.useState<ReviewMode>(null);
  const [remoteMode, setRemoteMode] = React.useState<ReviewMode>(null);
  const [remoteReviewActive, setRemoteReviewActive] = React.useState(false);
  const [incomingMessages, setIncomingMessages] = React.useState<
    Array<{ sequence: number; message: ReviewCollaborationMessage }>
  >([]);
  const {
    operationsRef,
    cursorRef,
    annotations,
    cursor,
    canUndo,
    canRedo,
    commit,
    applyRemoteOperation,
    moveCursor,
    replace,
  } = useReviewHistory(actorId);
  const incomingStatesRef = React.useRef(new Map<string, IncomingState>());
  const viewportRef = React.useRef({ scale, offset, dimensions, canvasSize });
  viewportRef.current = { scale, offset, dimensions, canvasSize };

  React.useEffect(
    () =>
      subscribeMessages((event) => {
        setIncomingMessages((current) => [...current, event]);
      }),
    [subscribeMessages],
  );

  const baseMessage = React.useCallback(
    () => ({ imageId: image.id, actorId }),
    [actorId, image.id],
  );

  const geometryContext = React.useCallback(() => {
    const current = viewportRef.current;
    return {
      imageWidth: Math.max(1, current.dimensions.width),
      imageHeight: Math.max(1, current.dimensions.height),
      canvasWidth: Math.max(1, current.canvasSize.width),
      canvasHeight: Math.max(1, current.canvasSize.height),
    };
  }, []);

  const sendViewport = React.useCallback(() => {
    const current = viewportRef.current;
    if (
      !current.dimensions.width ||
      !current.dimensions.height ||
      !current.canvasSize.width ||
      !current.canvasSize.height
    ) {
      return;
    }
    onSendMessage({
      ...baseMessage(),
      type: "REVIEW_VIEWPORT",
      scale: current.scale,
      offsetX: current.offset.x,
      offsetY: current.offset.y,
      imageWidth: current.dimensions.width,
      imageHeight: current.dimensions.height,
      canvasWidth: current.canvasSize.width,
      canvasHeight: current.canvasSize.height,
    });
  }, [baseMessage, onSendMessage]);

  const resetViewport = React.useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    resetViewport();
    setDimensions({ width: 0, height: 0 });
    setSelectedIds([]);
    setActiveTool("select");
    setLocalMode(null);
    setRemoteMode(null);
    setRemoteReviewActive(false);
    replace([], 0);
    incomingStatesRef.current.clear();
    onSendMessage({
      ...baseMessage(),
      type: "REVIEW_PRESENCE",
      active: true,
      request: true,
    });
    onSendMessage({ ...baseMessage(), type: "REVIEW_STATE_REQUEST" });
    return () => {
      onSendMessage({ ...baseMessage(), type: "REVIEW_MODE", mode: null });
      onSendMessage({
        ...baseMessage(),
        type: "REVIEW_PRESENCE",
        active: false,
        request: false,
      });
    };
  }, [baseMessage, onSendMessage, replace, resetViewport]);

  React.useEffect(() => {
    if (localMode !== "present") return;
    const frame = window.requestAnimationFrame(sendViewport);
    return () => window.cancelAnimationFrame(frame);
  }, [canvasSize, dimensions, localMode, offset, scale, sendViewport]);

  React.useEffect(() => {
    if (!incomingMessages.length) return;
    const message = incomingMessages[0].message;
    setIncomingMessages((current) => current.slice(1));
    if (message.imageId !== image.id || message.actorId === actorId) return;

    if (message.type === "REVIEW_PRESENCE") {
      setRemoteReviewActive(message.active);
      if (!message.active) {
        setRemoteMode(null);
        if (localMode) {
          setLocalMode(null);
          onSendMessage({ ...baseMessage(), type: "REVIEW_MODE", mode: null });
        }
      } else if (message.request) {
        onSendMessage({
          ...baseMessage(),
          type: "REVIEW_PRESENCE",
          active: true,
          request: false,
        });
      }
      return;
    }

    if (message.type === "REVIEW_MODE") {
      setRemoteMode(message.mode);
      if (message.mode && message.mode === localMode) {
        setLocalMode(null);
        onSendMessage({ ...baseMessage(), type: "REVIEW_MODE", mode: null });
      }
      if (message.mode === "follow" && localMode === "present") sendViewport();
      return;
    }
    if (message.type === "REVIEW_OPERATION") {
      applyRemoteOperation(message.operation);
      return;
    }
    if (message.type === "REVIEW_CURSOR") {
      moveCursor(message.cursor);
      return;
    }
    if (message.type === "REVIEW_STATE_REQUEST") {
      const transferId = crypto.randomUUID().replace(/-/g, "");
      onSendMessage({
        ...baseMessage(),
        ...geometryContext(),
        type: "REVIEW_STATE_BEGIN",
        transferId,
        total: operationsRef.current.length,
        cursor: cursorRef.current,
      });
      operationsRef.current.forEach((operation, index) => {
        onSendMessage({
          ...baseMessage(),
          type: "REVIEW_STATE_OPERATION",
          transferId,
          index,
          operation,
        });
      });
      onSendMessage({
        ...baseMessage(),
        type: "REVIEW_STATE_END",
        transferId,
      });
      onSendMessage({ ...baseMessage(), type: "REVIEW_MODE", mode: localMode });
      if (localMode === "present") sendViewport();
      return;
    }
    if (message.type === "REVIEW_STATE_BEGIN") {
      incomingStatesRef.current.set(message.transferId, {
        total: message.total,
        cursor: message.cursor,
        operations: Array.from({ length: message.total }, () => null),
      });
      return;
    }
    if (message.type === "REVIEW_STATE_OPERATION") {
      const state = incomingStatesRef.current.get(message.transferId);
      if (state && message.index >= 0 && message.index < state.total) {
        state.operations[message.index] = message.operation;
      }
      return;
    }
    if (message.type === "REVIEW_STATE_END") {
      const state = incomingStatesRef.current.get(message.transferId);
      incomingStatesRef.current.delete(message.transferId);
      if (state && state.operations.every(Boolean)) {
        replace(
          state.operations.filter(
            (operation): operation is NonNullable<typeof operation> => Boolean(operation),
          ),
          state.cursor,
        );
      }
      return;
    }
    if (message.type === "REVIEW_VIEWPORT" && localMode === "follow") {
      const currentCanvas = viewportRef.current.canvasSize;
      setScale(Math.max(0.25, Math.min(4, message.scale)));
      setOffset({
        x:
          message.canvasWidth > 0
            ? message.offsetX * (currentCanvas.width / message.canvasWidth)
            : 0,
        y:
          message.canvasHeight > 0
            ? message.offsetY * (currentCanvas.height / message.canvasHeight)
            : 0,
      });
    }
  }, [
    applyRemoteOperation,
    actorId,
    baseMessage,
    geometryContext,
    image.id,
    incomingMessages,
    localMode,
    moveCursor,
    onSendMessage,
    operationsRef,
    replace,
    sendViewport,
    cursorRef,
  ]);

  const commitCreate = React.useCallback(
    (annotation: ReviewAnnotation) => {
      const operation = commit("create", null, annotation);
      setSelectedIds([annotation.id]);
      setActiveTool("select");
      onSendMessage({
        ...baseMessage(),
        ...geometryContext(),
        type: "REVIEW_OPERATION",
        operation,
      });
    },
    [baseMessage, commit, geometryContext, onSendMessage],
  );

  const commitUpdate = React.useCallback(
    (before: ReviewAnnotation, after: ReviewAnnotation) => {
      const operation = commit("update", before, after);
      onSendMessage({
        ...baseMessage(),
        ...geometryContext(),
        type: "REVIEW_OPERATION",
        operation,
      });
    },
    [baseMessage, commit, geometryContext, onSendMessage],
  );

  const selectedAnnotations = React.useMemo(
    () => annotations.filter((annotation) => selectedIds.includes(annotation.id)),
    [annotations, selectedIds],
  );

  const displayedTool =
    selectedAnnotations.length > 0 &&
    selectedAnnotations.every(
      (annotation) => annotation.type === selectedAnnotations[0].type,
    )
      ? selectedAnnotations[0].type
      : activeTool;
  const displayedColor =
    selectedAnnotations.length > 0 &&
    selectedAnnotations.every(
      (annotation) => annotation.stroke === selectedAnnotations[0].stroke,
    )
      ? selectedAnnotations[0].stroke
      : defaultColor;
  const changeAnnotationColor = React.useCallback(
    (color: string) => {
      if (selectedAnnotations.length) {
        selectedAnnotations.forEach((annotation) => {
          commitUpdate(annotation, { ...annotation, stroke: color });
        });
        return;
      }
      setDefaultColor(color);
    },
    [commitUpdate, selectedAnnotations],
  );

  const changeLineThickness = React.useCallback(
    (ratio: number) => {
      setDefaultStrokeRatio(ratio);
      const lineAnnotations = selectedAnnotations.filter(
        (annotation) => annotation.type !== "text" && annotation.type !== "emoji",
      );
      if (lineAnnotations.length && dimensions.width && dimensions.height) {
        const strokeWidth = Math.max(
          1,
          Math.max(dimensions.width, dimensions.height) * ratio,
        );
        lineAnnotations.forEach((annotation) => {
          commitUpdate(annotation, { ...annotation, strokeWidth });
        });
      }
    },
    [commitUpdate, dimensions, selectedAnnotations],
  );

  const changeStrokeStyle = React.useCallback(
    (type: "arrow" | "line", style: ReviewStrokeStyle) => {
      if (type === "arrow") setArrowStyle(style);
      else setLineStyle(style);
      selectedAnnotations
        .filter((annotation) => annotation.type === type)
        .forEach((annotation) => {
          commitUpdate(annotation, { ...annotation, strokeStyle: style });
        });
    },
    [commitUpdate, selectedAnnotations],
  );

  const insertEmoji = React.useCallback(
    (emoji: string) => {
      if (!dimensions.width || !dimensions.height || localMode === "follow") return;
      const size = Math.max(
        36,
        Math.max(dimensions.width, dimensions.height) * 0.065,
      );
      commitCreate({
        id: crypto.randomUUID().replace(/-/g, ""),
        type: "emoji",
        x: dimensions.width / 2 - size / 2,
        y: dimensions.height / 2 - size / 2,
        width: size,
        height: size,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        emoji,
        stroke: defaultColor,
        strokeWidth: Math.max(2, size * 0.06),
        createdBy: actorId,
      });
    },
    [actorId, commitCreate, defaultColor, dimensions, localMode],
  );

  const moveHistoryCursor = React.useCallback(
    (nextCursor: number) => {
      moveCursor(nextCursor);
      setSelectedIds([]);
      onSendMessage({ ...baseMessage(), type: "REVIEW_CURSOR", cursor: nextCursor });
    },
    [baseMessage, moveCursor, onSendMessage],
  );

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (localMode === "follow") return;
        event.preventDefault();
        if (event.shiftKey) {
          if (canRedo) moveHistoryCursor(cursor + 1);
        } else if (canUndo) {
          moveHistoryCursor(cursor - 1);
        }
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
        if (localMode === "follow") return;
        const selected = annotations.filter((item) => selectedIds.includes(item.id));
        if (!selected.length) return;
        event.preventDefault();
        selected.forEach((annotation) => {
          const operation = commit("delete", annotation, null);
          onSendMessage({
            ...baseMessage(),
            ...geometryContext(),
            type: "REVIEW_OPERATION",
            operation,
          });
        });
        setSelectedIds([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    baseMessage,
    annotations,
    moveHistoryCursor,
    onSendMessage,
    canRedo,
    canUndo,
    commit,
    cursor,
    geometryContext,
    localMode,
    selectedIds,
  ]);

  const changeMode = (mode: ReviewMode) => {
    if (!remoteReviewActive) return;
    setLocalMode(mode);
    if (mode === "follow") {
      setActiveTool("select");
      setSelectedIds([]);
    }
    onSendMessage({ ...baseMessage(), type: "REVIEW_MODE", mode });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <ReviewToolbar
        imageName={image.name}
        zoomPercent={Math.round(scale * 100)}
        labels={labels}
        activeTool={displayedTool}
        canUndo={canUndo}
        canRedo={canRedo}
        localMode={localMode}
        remoteMode={remoteMode}
        remoteReviewActive={remoteReviewActive}
        workspaceLocked={localMode === "follow"}
        annotationColor={displayedColor}
        lineThickness={defaultStrokeRatio}
        lineThicknessDisabled={false}
        arrowStyle={
          selectedAnnotations.find((annotation) => annotation.type === "arrow")
            ?.strokeStyle ?? arrowStyle
        }
        lineStyle={
          selectedAnnotations.find((annotation) => annotation.type === "line")
            ?.strokeStyle ?? lineStyle
        }
        hasSelection={selectedAnnotations.length > 0}
        onBack={onBack}
        onToolChange={(tool) => {
          setSelectedIds([]);
          setActiveTool(tool);
        }}
        onUndo={() => moveHistoryCursor(cursor - 1)}
        onRedo={() => moveHistoryCursor(cursor + 1)}
        onModeChange={changeMode}
        onColorChange={changeAnnotationColor}
        onLineThicknessChange={changeLineThickness}
        onArrowStyleChange={(style) => changeStrokeStyle("arrow", style)}
        onLineStyleChange={(style) => changeStrokeStyle("line", style)}
        onInsertEmoji={insertEmoji}
        onZoomIn={() => setScale((current) => Math.min(4, current + 0.25))}
        onZoomOut={() => setScale((current) => Math.max(0.25, current - 0.25))}
        onFit={resetViewport}
        onReset={resetViewport}
      />
      <ReviewCanvas
        image={image}
        scale={scale}
        offset={offset}
        activeTool={activeTool}
        annotations={annotations}
        selectedIds={selectedIds}
        actorId={actorId}
        defaultColor={defaultColor}
        defaultStrokeRatio={defaultStrokeRatio}
        arrowStyle={arrowStyle}
        lineStyle={lineStyle}
        interactionDisabled={localMode === "follow"}
        onScaleChange={setScale}
        onOffsetChange={setOffset}
        onDimensionsChange={setDimensions}
        onCanvasSizeChange={setCanvasSize}
        onSelect={setSelectedIds}
        onCreate={commitCreate}
        onUpdate={commitUpdate}
      />
      <ReviewStatusBar image={image} dimensions={dimensions.width ? dimensions : null} />
    </div>
  );
}
