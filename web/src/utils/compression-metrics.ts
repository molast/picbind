"use client";

const METRICS_ENABLED = process.env.NEXT_PUBLIC_METRICS_ENABLED !== "false";
const METRICS_API_PATH =
  process.env.NEXT_PUBLIC_METRICS_API_PATH || "/api/metrics";
const MAX_DELTA_PER_REQUEST = 20;
const MAX_EVENTS_PER_REQUEST = 20;
const FLUSH_DELAY_MS = 1200;
const MAX_RETRY_DELAY_MS = 15_000;

let pendingCount = 0;
let pendingEvents: Array<{
  format: "jpeg" | "png" | "webp" | "avif";
  savedBytes: number;
}> = [];
let flushTimer: number | null = null;
let flushing = false;
let totalCompressedCache: number | null = null;
let retryDelayMs = FLUSH_DELAY_MS;

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
  const response = await fetch(METRICS_API_PATH, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Metrics read failed with status ${response.status}`);
  }
  const data = (await response.json()) as { totalCompressed?: number };
  return Number(data.totalCompressed || 0);
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
        totalCompressedCache = total;
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
  if (!METRICS_ENABLED) {
    return;
  }

  if (!Number.isFinite(sourceSize) || !Number.isFinite(outputSize)) {
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
    totalCompressedCache = 0;
    return 0;
  }

  try {
    const total = await readTotalCount();
    totalCompressedCache = total;
    return total;
  } catch (error) {
    console.error("Compression metrics read failed:", error);
    return totalCompressedCache ?? 0;
  }
}
