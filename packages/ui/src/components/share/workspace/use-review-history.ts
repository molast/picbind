"use client";

import React from "react";
import {
  reviewAnnotationsAtCursor,
  type ReviewAnnotation,
  type ReviewOperation,
} from "../../../utils/review-collaboration";

export function useReviewHistory(actorId: string) {
  const [operations, setOperations] = React.useState<ReviewOperation[]>([]);
  const [cursor, setCursor] = React.useState(0);
  const operationsRef = React.useRef(operations);
  const cursorRef = React.useRef(cursor);
  operationsRef.current = operations;
  cursorRef.current = cursor;

  const replace = React.useCallback((next: ReviewOperation[], nextCursor: number) => {
    const safeCursor = Math.max(0, Math.min(next.length, nextCursor));
    operationsRef.current = next;
    cursorRef.current = safeCursor;
    setOperations(next);
    setCursor(safeCursor);
  }, []);

  const commit = React.useCallback(
    (
      kind: ReviewOperation["kind"],
      before: ReviewAnnotation | null,
      after: ReviewAnnotation | null,
    ) => {
      const operation: ReviewOperation = {
        id: crypto.randomUUID().replace(/-/g, ""),
        actorId,
        kind,
        annotationId: (after || before)!.id,
        before,
        after,
        createdAt: Date.now(),
      };
      const next = [
        ...operationsRef.current.slice(0, cursorRef.current),
        operation,
      ];
      replace(next, next.length);
      return operation;
    },
    [actorId, replace],
  );

  const applyRemoteOperation = React.useCallback(
    (operation: ReviewOperation) => {
      if (operationsRef.current.some((item) => item.id === operation.id)) return;
      const next = [
        ...operationsRef.current.slice(0, cursorRef.current),
        operation,
      ];
      replace(next, next.length);
    },
    [replace],
  );

  const moveCursor = React.useCallback(
    (nextCursor: number) => {
      replace(operationsRef.current, nextCursor);
    },
    [replace],
  );

  return {
    operations,
    cursor,
    operationsRef,
    cursorRef,
    annotations: React.useMemo(
      () => reviewAnnotationsAtCursor(operations, cursor),
      [cursor, operations],
    ),
    canUndo: cursor > 0,
    canRedo: cursor < operations.length,
    commit,
    applyRemoteOperation,
    moveCursor,
    replace,
  };
}
