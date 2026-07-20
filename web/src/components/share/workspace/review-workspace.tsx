"use client";

import React from "react";
import type { ShareRoomLabels } from "../share-room-labels";
import type { RoomImage } from "../share-room-types";
import type { RoomRole } from "@/utils/realtime-room";
import type {
  ReviewAnchor,
  ReviewAnnotation,
  ReviewCollaborationMessage,
  ReviewLaserEvent,
  ReviewMode,
  ReviewOperation,
  ReviewStrokeStyle,
  ReviewTool,
} from "@/utils/review-collaboration";
import ReviewCanvas, {
  type ReviewMagnifierPoint,
  type ReviewRemoteMagnifier,
  type ReviewRemoteLaserEvent,
  type ReviewViewportOffset,
} from "./review-canvas";
import ReviewStatusBar from "./review-status-bar";
import ReviewToolbar from "./review-toolbar";
import { useReviewHistory } from "./use-review-history";
import {
  loadReviewHistory,
  saveReviewHistory,
} from "@/utils/realtime-review-history-store";

type ReviewWorkspaceProps = {
  roomId: string;
  image: RoomImage;
  labels: ShareRoomLabels;
  actorId: string;
  role: RoomRole | null;
  subscribeMessages(
    listener: (event: {
      sequence: number;
      message: ReviewCollaborationMessage;
    }) => void,
  ): () => void;
  onSendMessage(message: ReviewCollaborationMessage): boolean;
  onReviewStatusChange(
    imageId: string,
    status: "in-review" | "approved" | undefined,
    anchorCount: number,
  ): void;
  onBack(): void;
};

type IncomingState = {
  total: number;
  cursor: number;
  operations: Array<
    Extract<ReviewCollaborationMessage, { type: "REVIEW_OPERATION" }>["operation"] | null
  >;
  anchors: Array<ReviewAnchor | null>;
};

function mergeReviewOperations(
  primary: ReviewOperation[],
  secondary: ReviewOperation[],
) {
  const ids = new Set(primary.map((operation) => operation.id));
  return [
    ...primary,
    ...secondary.filter((operation) => !ids.has(operation.id)),
  ];
}

function mergeReviewAnchors(primary: ReviewAnchor[], secondary: ReviewAnchor[]) {
  const anchors = new Map(primary.map((anchor) => [anchor.id, anchor]));
  secondary.forEach((anchor) => {
    const current = anchors.get(anchor.id);
    if (!current || anchor.updatedAt > current.updatedAt) anchors.set(anchor.id, anchor);
  });
  return [...anchors.values()];
}

export default function ReviewWorkspace({
  roomId,
  image,
  labels,
  actorId,
  role,
  subscribeMessages,
  onSendMessage,
  onReviewStatusChange,
  onBack,
}: ReviewWorkspaceProps) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState<ReviewViewportOffset>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
  const [activeTool, setActiveTool] = React.useState<ReviewTool>("select");
  const [commentMode, setCommentMode] = React.useState(false);
  const [commentCleanupMode, setCommentCleanupMode] = React.useState(false);
  const [anchors, setAnchors] = React.useState<ReviewAnchor[]>([]);
  const [deletedAnchor, setDeletedAnchor] = React.useState<ReviewAnchor | null>(null);
  const visibleAnchors = React.useMemo(
    () => anchors.filter((anchor) => !anchor.deleted),
    [anchors],
  );
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [defaultColor, setDefaultColor] = React.useState("#000000");
  const [defaultFill, setDefaultFill] = React.useState<string | null>(null);
  const [defaultStrokeRatio, setDefaultStrokeRatio] = React.useState(0.0015);
  const [arrowStyle, setArrowStyle] = React.useState<ReviewStrokeStyle>("solid");
  const [lineStyle, setLineStyle] = React.useState<ReviewStrokeStyle>("solid");
  const [localMode, setLocalMode] = React.useState<ReviewMode>(null);
  const [remoteMode, setRemoteMode] = React.useState<ReviewMode>(null);
  const [remoteReviewActive, setRemoteReviewActive] = React.useState(false);
  const [remoteMagnifier, setRemoteMagnifier] =
    React.useState<ReviewRemoteMagnifier | null>(null);
  const [magnifierHighlightEnabled, setMagnifierHighlightEnabled] =
    React.useState(true);
  const [laserColor, setLaserColor] = React.useState("#eab308");
  const [remoteLaserEvent, setRemoteLaserEvent] =
    React.useState<ReviewRemoteLaserEvent | null>(null);
  const [incomingMessages, setIncomingMessages] = React.useState<
    Array<{ sequence: number; message: ReviewCollaborationMessage }>
  >([]);
  const [hydratedHistoryKey, setHydratedHistoryKey] = React.useState<string | null>(
    null,
  );
  const {
    operations,
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
  const magnifierFrameRef = React.useRef<number | null>(null);
  const pendingMagnifierRef = React.useRef<ReviewMagnifierPoint | null>(null);
  const laserFrameRef = React.useRef<number | null>(null);
  const pendingLaserRef = React.useRef<ReviewLaserEvent | null>(null);
  const anchorsRef = React.useRef(anchors);
  const undoDeleteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  anchorsRef.current = anchors;
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

  const sendMagnifier = React.useCallback(
    (position: ReviewMagnifierPoint | null) => {
      if (!position) {
        pendingMagnifierRef.current = null;
        if (magnifierFrameRef.current !== null) {
          window.cancelAnimationFrame(magnifierFrameRef.current);
          magnifierFrameRef.current = null;
        }
        onSendMessage({
          ...baseMessage(),
          type: "REVIEW_MAGNIFIER",
          active: false,
          x: 0,
          y: 0,
          highlight: magnifierHighlightEnabled,
        });
        return;
      }
      pendingMagnifierRef.current = position;
      if (magnifierFrameRef.current !== null) return;
      magnifierFrameRef.current = window.requestAnimationFrame(() => {
        magnifierFrameRef.current = null;
        const current = pendingMagnifierRef.current;
        if (!current) return;
        onSendMessage({
          ...baseMessage(),
          type: "REVIEW_MAGNIFIER",
          active: true,
          x: current.x,
          y: current.y,
          highlight: magnifierHighlightEnabled,
        });
      });
    },
    [baseMessage, magnifierHighlightEnabled, onSendMessage],
  );

  const sendLaser = React.useCallback(
    (event: ReviewLaserEvent) => {
      if (event.phase !== "move") {
        pendingLaserRef.current = null;
        if (laserFrameRef.current !== null) {
          window.cancelAnimationFrame(laserFrameRef.current);
          laserFrameRef.current = null;
        }
        onSendMessage({ ...baseMessage(), type: "REVIEW_LASER", event });
        return;
      }
      pendingLaserRef.current = event;
      if (laserFrameRef.current !== null) return;
      laserFrameRef.current = window.requestAnimationFrame(() => {
        laserFrameRef.current = null;
        const current = pendingLaserRef.current;
        if (!current) return;
        onSendMessage({
          ...baseMessage(),
          type: "REVIEW_LASER",
          event: current,
        });
      });
    },
    [baseMessage, onSendMessage],
  );

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
    const cacheKey = `${roomId}:${image.id}`;
    let cancelled = false;
    resetViewport();
    setDimensions({ width: 0, height: 0 });
    setSelectedIds([]);
    setActiveTool("select");
    setCommentMode(false);
    setCommentCleanupMode(false);
    setAnchors([]);
    setDeletedAnchor(null);
    if (undoDeleteTimerRef.current) clearTimeout(undoDeleteTimerRef.current);
    undoDeleteTimerRef.current = null;
    setLocalMode(null);
    setRemoteMode(null);
    setRemoteReviewActive(false);
    setRemoteMagnifier(null);
    setHydratedHistoryKey(null);
    replace([], 0);
    incomingStatesRef.current.clear();
    void (async () => {
      let cached: Awaited<ReturnType<typeof loadReviewHistory>> = null;
      try {
        cached = await loadReviewHistory(roomId, image.id);
      } catch {
        cached = null;
      }
      if (cancelled) return;
      if (cached) {
        const current = operationsRef.current;
        const merged = mergeReviewOperations(cached.operations, current);
        replace(merged, current.length ? merged.length : cached.cursor);
        setAnchors((currentAnchors) =>
          mergeReviewAnchors(currentAnchors, cached.anchors),
        );
      }
      setHydratedHistoryKey(cacheKey);
      onSendMessage({
        ...baseMessage(),
        type: "REVIEW_PRESENCE",
        active: true,
        request: true,
      });
      onSendMessage({ ...baseMessage(), type: "REVIEW_STATE_REQUEST" });
    })();
    return () => {
      cancelled = true;
      if (magnifierFrameRef.current !== null) {
        window.cancelAnimationFrame(magnifierFrameRef.current);
        magnifierFrameRef.current = null;
      }
      if (laserFrameRef.current !== null) {
        window.cancelAnimationFrame(laserFrameRef.current);
        laserFrameRef.current = null;
      }
      if (undoDeleteTimerRef.current) {
        clearTimeout(undoDeleteTimerRef.current);
        undoDeleteTimerRef.current = null;
      }
      onSendMessage({ ...baseMessage(), type: "REVIEW_MODE", mode: null });
      onSendMessage({
        ...baseMessage(),
        type: "REVIEW_PRESENCE",
        active: false,
        request: false,
      });
    };
  }, [
    baseMessage,
    image.id,
    onSendMessage,
    operationsRef,
    replace,
    resetViewport,
    roomId,
  ]);

  React.useEffect(() => {
    if (hydratedHistoryKey !== `${roomId}:${image.id}`) return;
    void saveReviewHistory(roomId, image.id, operations, cursor, anchors).catch(() => undefined);
  }, [anchors, cursor, hydratedHistoryKey, image.id, operations, roomId]);

  React.useEffect(() => {
    if (hydratedHistoryKey !== `${roomId}:${image.id}`) return;
    const status = visibleAnchors.length
      ? visibleAnchors.every((anchor) => anchor.resolved)
        ? "approved"
        : "in-review"
      : undefined;
    onReviewStatusChange(image.id, status, visibleAnchors.length);
  }, [hydratedHistoryKey, image.id, onReviewStatusChange, roomId, visibleAnchors]);

  React.useEffect(() => {
    if (localMode !== "present") return;
    const frame = window.requestAnimationFrame(sendViewport);
    return () => window.cancelAnimationFrame(frame);
  }, [canvasSize, dimensions, localMode, offset, scale, sendViewport]);

  React.useEffect(() => {
    if (!incomingMessages.length) return;
    const incomingMessage = incomingMessages[0];
    const message = incomingMessage.message;
    setIncomingMessages((current) => current.slice(1));
    if (message.imageId !== image.id || message.actorId === actorId) return;

    if (message.type === "REVIEW_PRESENCE") {
      setRemoteReviewActive(message.active);
      if (!message.active) {
        setRemoteMode(null);
        setRemoteMagnifier(null);
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
    if (message.type === "REVIEW_MAGNIFIER") {
      setRemoteMagnifier(
        message.active
          ? {
              x: message.x,
              y: message.y,
              highlight: message.highlight,
            }
          : null,
      );
      return;
    }
    if (message.type === "REVIEW_LASER") {
      setRemoteLaserEvent({
        sequence: incomingMessage.sequence,
        event: message.event,
      });
      return;
    }
    if (message.type === "REVIEW_ANCHOR_UPSERT") {
      setAnchors((current) => mergeReviewAnchors(current, [message.anchor]));
      return;
    }
    if (message.type === "REVIEW_ANCHOR_DELETE") {
      setAnchors((current) =>
        current.map((anchor) =>
          anchor.id === message.anchorId && message.deletedAt >= anchor.updatedAt
            ? { ...anchor, deleted: true, updatedAt: message.deletedAt }
            : anchor,
        ),
      );
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
        anchorTotal: anchorsRef.current.length,
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
      anchorsRef.current.forEach((anchor, index) => {
        onSendMessage({
          ...baseMessage(),
          type: "REVIEW_STATE_ANCHOR",
          transferId,
          index,
          anchor,
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
        anchors: Array.from({ length: message.anchorTotal }, () => null),
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
    if (message.type === "REVIEW_STATE_ANCHOR") {
      const state = incomingStatesRef.current.get(message.transferId);
      if (state && message.index >= 0 && message.index < state.anchors.length) {
        state.anchors[message.index] = message.anchor;
      }
      return;
    }
    if (message.type === "REVIEW_STATE_END") {
      const state = incomingStatesRef.current.get(message.transferId);
      incomingStatesRef.current.delete(message.transferId);
      if (state && state.operations.every(Boolean)) {
        const receivedOperations = state.operations.filter(
          (operation): operation is NonNullable<typeof operation> => Boolean(operation),
        );
        const current = operationsRef.current;
        if (receivedOperations.length) {
          const merged = mergeReviewOperations(current, receivedOperations);
          replace(
            merged,
            merged.length === receivedOperations.length ? state.cursor : merged.length,
          );
        } else if (!current.length) {
          replace([], 0);
        }
        if (state.anchors.every(Boolean)) {
          setAnchors((currentAnchors) =>
            mergeReviewAnchors(
              currentAnchors,
              state.anchors.filter(
                (anchor): anchor is ReviewAnchor => Boolean(anchor),
              ),
            ),
          );
        }
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

  const upsertAnchor = React.useCallback(
    (anchor: ReviewAnchor) => {
      setAnchors((current) => mergeReviewAnchors(current, [anchor]));
      onSendMessage({
        ...baseMessage(),
        type: "REVIEW_ANCHOR_UPSERT",
        anchor,
      });
    },
    [baseMessage, onSendMessage],
  );

  const deleteAnchor = React.useCallback(
    (anchor: ReviewAnchor) => {
      if (role !== "owner" && anchor.createdBy !== actorId) return;
      const deletedAt = Date.now();
      setAnchors((current) =>
        mergeReviewAnchors(current, [
          { ...anchor, deleted: true, updatedAt: deletedAt },
        ]),
      );
      onSendMessage({
        ...baseMessage(),
        type: "REVIEW_ANCHOR_DELETE",
        anchorId: anchor.id,
        deletedAt,
      });
      if (undoDeleteTimerRef.current) clearTimeout(undoDeleteTimerRef.current);
      setDeletedAnchor(anchor);
      undoDeleteTimerRef.current = setTimeout(() => {
        undoDeleteTimerRef.current = null;
        setDeletedAnchor(null);
      }, 3000);
    },
    [actorId, baseMessage, onSendMessage, role],
  );

  const undoDeleteAnchor = React.useCallback(() => {
    if (!deletedAnchor) return;
    if (undoDeleteTimerRef.current) clearTimeout(undoDeleteTimerRef.current);
    undoDeleteTimerRef.current = null;
    const restored = {
      ...deletedAnchor,
      deleted: false,
      updatedAt: Math.max(Date.now(), deletedAnchor.updatedAt + 1),
    };
    setDeletedAnchor(null);
    upsertAnchor(restored);
  }, [deletedAnchor, upsertAnchor]);

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
  const selectedFillAnnotations = selectedAnnotations.filter(
    (annotation) => annotation.type === "rectangle" || annotation.type === "circle",
  );
  const displayedFill =
    selectedFillAnnotations.length > 0 &&
    selectedFillAnnotations.every(
      (annotation) => annotation.fill === selectedFillAnnotations[0].fill,
    )
      ? selectedFillAnnotations[0].fill ?? null
      : defaultFill;
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

  const changeFillColor = React.useCallback(
    (fill: string | null) => {
      setDefaultFill(fill);
      selectedAnnotations
        .filter(
          (annotation) =>
            annotation.type === "rectangle" || annotation.type === "circle",
        )
        .forEach((annotation) => {
          commitUpdate(annotation, { ...annotation, fill });
        });
    },
    [commitUpdate, selectedAnnotations],
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

  const resetWorkspace = React.useCallback(() => {
    resetViewport();
    setSelectedIds([]);
    setActiveTool("select");
    annotations.forEach((annotation) => {
      const operation = commit("delete", annotation, null);
      onSendMessage({
        ...baseMessage(),
        ...geometryContext(),
        type: "REVIEW_OPERATION",
        operation,
      });
    });
  }, [annotations, baseMessage, commit, geometryContext, onSendMessage, resetViewport]);

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
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col bg-slate-100">
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
        commentMode={commentMode}
        commentCleanupMode={commentCleanupMode}
        annotationColor={displayedColor}
        fillColor={displayedFill}
        lineThickness={defaultStrokeRatio}
        lineThicknessDisabled={false}
        magnifierHighlightEnabled={magnifierHighlightEnabled}
        laserColor={laserColor}
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
        onFillColorChange={changeFillColor}
        onLineThicknessChange={changeLineThickness}
        onMagnifierHighlightChange={setMagnifierHighlightEnabled}
        onLaserColorChange={setLaserColor}
        onCommentModeChange={(enabled) => {
          setCommentMode(enabled);
          setCommentCleanupMode(false);
          setSelectedIds([]);
          if (enabled) setActiveTool("select");
        }}
        onCommentCleanupModeChange={setCommentCleanupMode}
        onArrowStyleChange={(style) => changeStrokeStyle("arrow", style)}
        onLineStyleChange={(style) => changeStrokeStyle("line", style)}
        onInsertEmoji={insertEmoji}
        onZoomIn={() => setScale((current) => Math.min(4, current + 0.25))}
        onZoomOut={() => setScale((current) => Math.max(0.25, current - 0.25))}
        onFit={resetViewport}
        onReset={resetWorkspace}
      />
      <ReviewCanvas
        image={image}
        labels={labels}
        scale={scale}
        offset={offset}
        activeTool={activeTool}
        annotations={annotations}
        selectedIds={selectedIds}
        actorId={actorId}
        canDeleteAnyAnchor={role === "owner"}
        defaultColor={defaultColor}
        defaultFill={defaultFill}
        defaultStrokeRatio={defaultStrokeRatio}
        arrowStyle={arrowStyle}
        lineStyle={lineStyle}
        interactionDisabled={localMode === "follow"}
        commentMode={commentMode}
        commentCleanupMode={commentCleanupMode}
        anchors={visibleAnchors}
        remoteMagnifier={localMode === "follow" ? remoteMagnifier : null}
        laserColor={laserColor}
        remoteLaserEvent={remoteLaserEvent}
        onScaleChange={setScale}
        onOffsetChange={setOffset}
        onDimensionsChange={setDimensions}
        onCanvasSizeChange={setCanvasSize}
        onSelect={setSelectedIds}
        onCreate={commitCreate}
        onUpdate={commitUpdate}
        onMagnifierChange={sendMagnifier}
        onLaserEvent={sendLaser}
        onAnchorUpsert={upsertAnchor}
        onAnchorDelete={deleteAnchor}
      />
      <ReviewStatusBar image={image} dimensions={dimensions.width ? dimensions : null} />
      {deletedAnchor ? (
        <div className="fixed bottom-6 left-1/2 z-[140] flex -translate-x-1/2 items-center gap-4 rounded-md bg-slate-950 px-4 py-3 text-sm text-white shadow-2xl">
          <span>{labels.anchorDeleted}</span>
          <button
            type="button"
            onClick={undoDeleteAnchor}
            className="font-semibold text-blue-300 hover:text-blue-200"
          >
            {labels.anchorUndo}
          </button>
        </div>
      ) : null}
    </div>
  );
}
