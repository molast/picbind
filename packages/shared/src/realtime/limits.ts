export const REALTIME_LIMITS = Object.freeze({
  maximumTextFrameBytes: 96 * 1024,
  maximumBinaryFrameBytes: 4 * 1024 * 1024,
  maximumBinaryHeaderBytes: 32 * 1024,
  maximumReliableEvents: 1_024,
  maximumReliableBytes: 32 * 1024 * 1024,
  maximumSocketQueueBytes: 8 * 1024 * 1024,
  maximumRtcControlBufferedBytes: 256 * 1024,
  maximumRtcBulkBufferedBytes: 1024 * 1024,
  sourceChunkBytes: 48 * 1024,
  maximumConcurrentSourceTransfers: 4,
});

export const REALTIME_QUALITY = Object.freeze({
  requiredQualificationProbes: 3,
  maximumQualificationRttMs: 500,
  minimumStableMs: 2_000,
  healthIntervalMs: 2_000,
  probeTimeoutMs: 2_500,
  disconnectedFallbackMs: 3_000,
  degradedRttMs: 1_500,
  degradedWindowMs: 5_000,
  maximumLossRate: 0.3,
  healthWindowSize: 10,
  reconnectInitialDelayMs: 1_500,
  reconnectMaximumDelayMs: 15_000,
});

export function realtimeFrameBytes(frame: { kind: "text"; data: string } | { kind: "binary"; data: ArrayBuffer }) {
  return frame.kind === "binary"
    ? frame.data.byteLength
    : new TextEncoder().encode(frame.data).byteLength;
}
