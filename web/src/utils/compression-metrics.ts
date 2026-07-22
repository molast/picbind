"use client";

import { getMetricsApiPath } from "@/utils/api-endpoints";

const METRICS_API_PATH = getMetricsApiPath();
const HAS_EXPLICIT_METRICS_API = Boolean(
  process.env.NEXT_PUBLIC_METRICS_API_PATH ||
    process.env.NEXT_PUBLIC_API_BASE_URL,
);
const METRICS_ENABLED =
  Boolean(METRICS_API_PATH) &&
  (process.env.NODE_ENV !== "development" || HAS_EXPLICIT_METRICS_API) &&
  process.env.NEXT_PUBLIC_METRICS_ENABLED !== "false";
const MAX_DELTA_PER_REQUEST = 20;
const MAX_EVENTS_PER_REQUEST = 20;
const FLUSH_DELAY_MS = 1200;
const MAX_RETRY_DELAY_MS = 15_000;
const LOCAL_METRICS_KEY = "picbind-metrics-local-v1";
const LOCAL_SESSION_ID_KEY = "picbind-metrics-session-id-v1";

type LocalMetricsState = {
  sessionId: string;
  sessionBase: number;
  sessionDelta: number;
  lastDisplay: number;
};

let pendingCount = 0;
let pendingEvents: Array<{
  format: "jpeg" | "png" | "webp" | "avif";
  savedBytes: number;
}> = [];
let flushTimer: number | null = null;
let flushing = false;
let totalCompressedCache: number | null = null;
let retryDelayMs = FLUSH_DELAY_MS;

type MetricsReadResponse = {
  totalCompressed?: number;
  showCompressedCount?: boolean;
};

function makeSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSessionId() {
  if (typeof window === "undefined") {
    return "server";
  }
  const existing = window.sessionStorage.getItem(LOCAL_SESSION_ID_KEY);
  if (existing) {
    return existing;
  }
  const next = makeSessionId();
  window.sessionStorage.setItem(LOCAL_SESSION_ID_KEY, next);
  return next;
}

function readLocalMetricsState() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_METRICS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LocalMetricsState>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      sessionId: String(parsed.sessionId || ""),
      sessionBase: Number(parsed.sessionBase || 0),
      sessionDelta: Number(parsed.sessionDelta || 0),
      lastDisplay: Number(parsed.lastDisplay || 0),
    } as LocalMetricsState;
  } catch {
    return null;
  }
}

function writeLocalMetricsState(state: LocalMetricsState) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_METRICS_KEY, JSON.stringify(state));
  } catch {}
}

function getOrInitLocalMetricsState(remoteTotal: number) {
  const sessionId = getSessionId();
  const existing = readLocalMetricsState();
  if (!existing || existing.sessionId !== sessionId) {
    const next: LocalMetricsState = {
      sessionId,
      sessionBase: remoteTotal,
      sessionDelta: 0,
      lastDisplay: remoteTotal,
    };
    writeLocalMetricsState(next);
    return next;
  }
  return existing;
}

function getSessionExpectedTotal(state: LocalMetricsState) {
  return state.sessionBase + state.sessionDelta;
}

function recordLocalCompression() {
  if (typeof window === "undefined") {
    return;
  }
  const state = getOrInitLocalMetricsState(totalCompressedCache ?? 0);
  const nextExpected = getSessionExpectedTotal(state) + 1;
  const nextState: LocalMetricsState = {
    ...state,
    sessionDelta: state.sessionDelta + 1,
    lastDisplay: Math.max(state.lastDisplay, nextExpected),
  };
  writeLocalMetricsState(nextState);
  totalCompressedCache = Math.max(totalCompressedCache ?? 0, nextState.lastDisplay);
}

function mergeRemoteWithLocal(remoteTotal: number) {
  const state = getOrInitLocalMetricsState(remoteTotal);
  const expected = getSessionExpectedTotal(state);
  const display = Math.max(remoteTotal, expected, state.lastDisplay || 0);

  // If remote has caught up or exceeded local session expectation, rebase.
  if (remoteTotal >= expected) {
    const nextState: LocalMetricsState = {
      ...state,
      sessionBase: remoteTotal,
      sessionDelta: 0,
      lastDisplay: display,
    };
    writeLocalMetricsState(nextState);
  } else if (display !== state.lastDisplay) {
    writeLocalMetricsState({
      ...state,
      lastDisplay: display,
    });
  }

  return display;
}

function acknowledgeLocalCompression(ackCount: number, remoteTotal: number) {
  if (typeof window === "undefined" || ackCount <= 0) {
    return;
  }
  const state = getOrInitLocalMetricsState(remoteTotal);
  const remainingDelta = Math.max(0, state.sessionDelta - ackCount);
  const rebasedBase = Math.max(remoteTotal - remainingDelta, state.sessionBase);
  const display = Math.max(remoteTotal, rebasedBase + remainingDelta);
  const nextState: LocalMetricsState = {
    ...state,
    sessionBase: rebasedBase,
    sessionDelta: remainingDelta,
    lastDisplay: display,
  };
  writeLocalMetricsState(nextState);
  totalCompressedCache = display;
}

async function writeMetrics(
  payload:
    | { delta: number }
    | {
        events: Array<{
          format: "jpeg" | "png" | "webp" | "avif";
          savedBytes: number;
        }>;
      },
) {
  if (!METRICS_API_PATH) {
    return 0;
  }
  const response = await fetch(METRICS_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Metrics write failed with status ${response.status}`);
  }

  const data = (await response.json()) as { totalCompressed?: number };
  return Number(data.totalCompressed || 0);
}

async function readTotalCount() {
  if (!METRICS_API_PATH) {
    return {
      totalCompressed: 0,
      showCompressedCount: false,
    };
  }
  const response = await fetch(METRICS_API_PATH, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Metrics read failed with status ${response.status}`);
  }
  return (await response.json()) as MetricsReadResponse;
}

async function flushPending() {
  if (flushing) {
    return;
  }
  flushing = true;

  try {
    while (pendingEvents.length > 0 || pendingCount > 0) {
      const events = pendingEvents.slice(0, MAX_EVENTS_PER_REQUEST);
      const delta = events.length
        ? 0
        : Math.min(pendingCount, MAX_DELTA_PER_REQUEST);

      if (events.length) {
        pendingEvents = pendingEvents.slice(events.length);
      } else {
        pendingCount -= delta;
      }

      try {
        const total = await writeMetrics(
          events.length ? { events } : { delta },
        );
        const ackCount = events.length || delta;
        acknowledgeLocalCompression(ackCount, total);
        totalCompressedCache = Math.max(totalCompressedCache ?? 0, total);
        retryDelayMs = FLUSH_DELAY_MS;
      } catch (error) {
        if (events.length) {
          pendingEvents = [...events, ...pendingEvents];
        } else {
          pendingCount += delta;
        }
        console.error("Compression metrics write failed:", error);
        if (!flushTimer) {
          const waitMs = retryDelayMs;
          flushTimer = window.setTimeout(async () => {
            flushTimer = null;
            await flushPending();
          }, waitMs);
          retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

function ensureFlushTimer() {
  if (flushTimer) {
    return;
  }

  flushTimer = window.setTimeout(async () => {
    flushTimer = null;
    await flushPending();
  }, FLUSH_DELAY_MS);
}

export function reportCompressedCount(delta = 1) {
  if (!METRICS_ENABLED || delta <= 0) {
    return;
  }

  pendingCount += delta;
  ensureFlushTimer();
}

export function reportCompressionResult(
  format: "jpeg" | "png" | "webp" | "avif",
  sourceSize: number,
  outputSize: number,
) {
  if (!Number.isFinite(sourceSize) || !Number.isFinite(outputSize)) {
    return;
  }

  recordLocalCompression();

  if (!METRICS_ENABLED) {
    return;
  }

  pendingEvents.push({
    format,
    savedBytes: Math.round(sourceSize - outputSize),
  });
  ensureFlushTimer();
}

export async function flushCompressedCountNow() {
  if (!METRICS_ENABLED) {
    return;
  }
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushPending();
}

export async function loadTotalCompressedCount() {
  if (!METRICS_ENABLED) {
    const localState = readLocalMetricsState();
    const localValue = localState
      ? Math.max(
          getSessionExpectedTotal(localState),
          Number(localState.lastDisplay || 0),
        )
      : 0;
    totalCompressedCache = localValue;
    return localValue;
  }

  try {
    const data = await readTotalCount();
    const remoteTotal = Number(data.totalCompressed || 0);
    const merged = mergeRemoteWithLocal(remoteTotal);
    totalCompressedCache = merged;
    return merged;
  } catch (error) {
    console.error("Compression metrics read failed:", error);
    const localState = readLocalMetricsState();
    const localValue = localState
      ? Math.max(
          getSessionExpectedTotal(localState),
          Number(localState.lastDisplay || 0),
        )
      : 0;
    const fallback = Math.max(totalCompressedCache ?? 0, localValue);
    totalCompressedCache = fallback;
    return fallback;
  }
}

export async function loadHomeDisplayConfig(defaults: {
  showCompressedCount: boolean;
}) {
  if (!METRICS_ENABLED || !METRICS_API_PATH) {
    return defaults;
  }

  try {
    const data = await readTotalCount();
    return {
      showCompressedCount:
        typeof data.showCompressedCount === "boolean"
          ? data.showCompressedCount
          : defaults.showCompressedCount,
    };
  } catch (error) {
    console.error("Home display config read failed:", error);
    return defaults;
  }
}
