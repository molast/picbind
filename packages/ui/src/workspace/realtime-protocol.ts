import type { WorkspaceEvent } from "./types";

const BINARY_MAGIC = [0x50, 0x42, 0x57, 0x31] as const;
const MAX_BINARY_BYTES = 4 * 1024 * 1024;
const MAX_BINARY_HEADER_BYTES = 32 * 1024;

export type RelayRoute = "workspace" | "owner" | "user";
export type RelayDelivery = "ephemeral" | "reliable" | "bulk";

export function streamId(route: RelayRoute, targetUserId?: string) {
  return route === "user" ? `user:${targetUserId || "unknown"}` : route;
}

export function encodeBinaryRelay(input: {
  route: RelayRoute;
  targetUserId?: string;
  delivery: Exclude<RelayDelivery, "ephemeral">;
  event: WorkspaceEvent;
  bytes: ArrayBuffer;
}) {
  const header = new TextEncoder().encode(JSON.stringify({
    route: input.route,
    targetUserId: input.targetUserId,
    delivery: input.delivery,
    event: input.event,
  }));
  if (header.byteLength > MAX_BINARY_HEADER_BYTES
    || 8 + header.byteLength + input.bytes.byteLength > MAX_BINARY_BYTES) {
    throw new Error("Workspace binary event is too large");
  }
  const frame = new Uint8Array(8 + header.byteLength + input.bytes.byteLength);
  frame.set(BINARY_MAGIC, 0);
  new DataView(frame.buffer).setUint32(4, header.byteLength, false);
  frame.set(header, 8);
  frame.set(new Uint8Array(input.bytes), 8 + header.byteLength);
  return frame.buffer;
}

export function decodeBinaryRelay(frame: ArrayBuffer) {
  if (frame.byteLength < 9 || frame.byteLength > MAX_BINARY_BYTES) return null;
  const bytes = new Uint8Array(frame);
  if (BINARY_MAGIC.some((value, index) => bytes[index] !== value)) return null;
  const headerLength = new DataView(frame).getUint32(4, false);
  if (headerLength < 2
    || headerLength > MAX_BINARY_HEADER_BYTES
    || 8 + headerLength >= frame.byteLength) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes.slice(8, 8 + headerLength))) as {
      event?: WorkspaceEvent;
    };
    const event = header.event;
    if (!event
      || typeof event.type !== "string"
      || !event.type
      || typeof event.eventId !== "string"
      || !event.eventId
      || !Number.isSafeInteger(event.sequence)
      || event.sequence < 0) return null;
    return { event, bytes: frame.slice(8 + headerLength) };
  } catch {
    return null;
  }
}

export type EventDisposition = "apply" | "duplicate" | "sequenceGap";

export class WorkspaceEventGate {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly sequenceByStream = new Map<string, number>();

  accept(event: WorkspaceEvent): EventDisposition {
    if (this.seen.has(event.eventId)) return "duplicate";
    this.seen.add(event.eventId);
    this.order.push(event.eventId);
    if (this.order.length > 4_096) this.seen.delete(this.order.shift()!);
    if (event.reliability !== "reliable" || typeof event.streamId !== "string") return "apply";
    const key = `${String(event.senderId || "peer")}:${event.streamId}`;
    const previous = this.sequenceByStream.get(key);
    this.sequenceByStream.set(key, Math.max(previous || 0, event.sequence));
    return previous !== undefined && event.sequence > previous + 1 ? "sequenceGap" : "apply";
  }

  clearSequences() { this.sequenceByStream.clear(); }
}
