import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeBinaryRelay, encodeBinaryRelay, WorkspaceEventGate } from "./realtime-protocol";
import type { WorkspaceEvent } from "./types";

function event(eventId: string, sequence: number): WorkspaceEvent {
  return { eventId, sequence, timestamp: 1, dataClass: "collaborationEvent", type: "futureEvent",
    reliability: "reliable", streamId: "workspace", senderId: "owner" };
}

test("binary relay preserves metadata and opaque bytes", () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  const frame = encodeBinaryRelay({ route: "workspace", delivery: "bulk", event: event("e1", 1),
    bytes: bytes.slice().buffer as ArrayBuffer });
  const decoded = decodeBinaryRelay(frame)!;
  assert.equal(decoded.event.type, "futureEvent");
  assert.deepEqual([...new Uint8Array(decoded.bytes)], [...bytes]);
});

test("binary relay rejects malformed and truncated frames", () => {
  assert.equal(decodeBinaryRelay(new Uint8Array([1, 2, 3]).buffer), null);
  const invalid = new Uint8Array(12);
  invalid.set([0x50, 0x42, 0x57, 0x31]);
  new DataView(invalid.buffer).setUint32(4, 32_769, false);
  assert.equal(decodeBinaryRelay(invalid.buffer), null);
});

test("event gate suppresses duplicates and detects reliable sequence gaps per stream", () => {
  const gate = new WorkspaceEventGate();
  assert.equal(gate.accept(event("e1", 1)), "apply");
  assert.equal(gate.accept(event("e1", 1)), "duplicate");
  assert.equal(gate.accept(event("e3", 3)), "sequenceGap");
  assert.equal(gate.accept({ ...event("other", 99), streamId: "owner" }), "apply");
  assert.equal(gate.accept({ ...event("ephemeral", 100), reliability: "ephemeral" }), "apply");
});
