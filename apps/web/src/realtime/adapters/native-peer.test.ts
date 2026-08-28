import assert from "node:assert/strict";
import { test } from "node:test";
import { RealtimeTransportError, type RealtimePeerEvent } from "@picbind/shared";
import { NativeRealtimePeerFactory, type NativeRealtimeBridge } from "./native-peer";

function encodeEvent(header: Record<string, unknown>, payload: number[] = []) {
  const encodedHeader = new TextEncoder().encode(JSON.stringify(header));
  const value = new Uint8Array(4 + encodedHeader.length + payload.length);
  new DataView(value.buffer).setUint32(0, encodedHeader.length, true);
  value.set(encodedHeader, 4);
  value.set(payload, 4 + encodedHeader.length);
  return value.buffer;
}

test("native peer uses raw IPC for binary send and receive", async () => {
  let eventListener: ((value: ArrayBuffer) => void) | null = null;
  const rawCalls: Array<{ body: Uint8Array; headers: Record<string, string> }> = [];
  const bridge: NativeRealtimeBridge = {
    channel(listener) { eventListener = listener; return { value: {}, close() {} }; },
    async invoke<T>(command: string) {
      if (command.endsWith("buffered_amount")) return 0 as T;
      return undefined as T;
    },
    async invokeRaw(_command, body, headers) { rawCalls.push({ body, headers }); },
  };
  const peer = await new NativeRealtimePeerFactory(bridge).create({
    sessionId: "session-1",
    peerId: "peer-1",
    iceServers: [],
    initiator: true,
  });
  const events: RealtimePeerEvent[] = [];
  peer.subscribe((event) => events.push(event));

  await peer.send("bulk", { kind: "binary", data: Uint8Array.from([4, 5]).buffer });
  const notify = eventListener as unknown as (value: ArrayBuffer) => void;
  notify(encodeEvent({
    type: "message",
    sessionId: "session-1",
    peerId: "peer-1",
    sequence: 1,
    channel: "bulk",
    frameKind: "binary",
  }, [1, 2, 3]));

  assert.deepEqual([...rawCalls[0].body], [4, 5]);
  assert.equal(rawCalls[0].headers["x-picbind-frame-kind"], "binary");
  const message = events[0] as Extract<RealtimePeerEvent, { type: "message" }>;
  assert.deepEqual([...new Uint8Array(message.frame.kind === "binary" ? message.frame.data : new ArrayBuffer(0))], [1, 2, 3]);
});

test("native peer serializes raw IPC writes per DataChannel", async () => {
  let releaseFirst: (() => void) | null = null;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const started: number[] = [];
  const bridge: NativeRealtimeBridge = {
    channel() { return { value: {}, close() {} }; },
    async invoke<T>(command: string) {
      if (command.endsWith("buffered_amount")) return 0 as T;
      return undefined as T;
    },
    async invokeRaw(_command, body) {
      started.push(body[0]);
      if (body[0] === 1) await firstBlocked;
    },
  };
  const peer = await new NativeRealtimePeerFactory(bridge).create({
    sessionId: "session-1",
    peerId: "peer-fifo",
    iceServers: [],
    initiator: true,
  });

  const first = peer.send("bulk", { kind: "binary", data: Uint8Array.from([1]).buffer });
  const second = peer.send("bulk", { kind: "binary", data: Uint8Array.from([2]).buffer });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [1]);
  (releaseFirst as unknown as () => void)();
  await Promise.all([first, second]);
  assert.deepEqual(started, [1, 2]);
  await peer.close();
});

test("native peer maps Rust buffered amount rejection to RTC backpressure", async () => {
  const bridge: NativeRealtimeBridge = {
    channel() { return { value: {}, close() {} }; },
    async invoke<T>(command: string) {
      if (command.endsWith("buffered_amount")) return 0 as T;
      return undefined as T;
    },
    async invokeRaw() { throw new Error("native RTC bulk channel is backpressured"); },
  };
  const peer = await new NativeRealtimePeerFactory(bridge).create({
    sessionId: "session-1",
    peerId: "peer-backpressure",
    iceServers: [],
    initiator: true,
  });

  await assert.rejects(
    peer.send("bulk", { kind: "binary", data: Uint8Array.from([1]).buffer }),
    (error) => error instanceof RealtimeTransportError && error.code === "rtcBackpressure",
  );
  await peer.close();
});

test("native peer drops stale and out-of-order event sequences", async () => {
  let eventListener: ((value: ArrayBuffer) => void) | null = null;
  const bridge: NativeRealtimeBridge = {
    channel(listener) { eventListener = listener; return { value: {}, close() {} }; },
    async invoke<T>(command: string) {
      if (command.endsWith("buffered_amount")) return 0 as T;
      return undefined as T;
    },
    async invokeRaw() {},
  };
  const peer = await new NativeRealtimePeerFactory(bridge).create({
    sessionId: "session-1",
    peerId: "peer-sequence",
    iceServers: [],
    initiator: false,
  });
  const events: RealtimePeerEvent[] = [];
  peer.subscribe((event) => events.push(event));
  const notify = eventListener as unknown as (value: ArrayBuffer) => void;
  const header = (sequence: number, state: string) => encodeEvent({
    type: "connectionState",
    sessionId: "session-1",
    peerId: "peer-sequence",
    sequence,
    state,
  });
  notify(header(2, "connected"));
  notify(header(1, "failed"));
  notify(header(2, "closed"));

  assert.deepEqual(events, [{ type: "connectionState", state: "connected" }]);
  await peer.close();
});

test("native peer cleans up its event channel when initialization fails", async () => {
  let channelCloses = 0;
  let peerCloses = 0;
  const bridge: NativeRealtimeBridge = {
    channel() { return { value: {}, close() { channelCloses += 1; } }; },
    async invoke<T>(command: string) {
      if (command.endsWith("realtime_peer_create")) throw new Error("create failed");
      if (command.endsWith("realtime_peer_close")) peerCloses += 1;
      return undefined as T;
    },
    async invokeRaw() {},
  };
  const error = await new NativeRealtimePeerFactory(bridge).create({
    sessionId: "session-1",
    peerId: "peer-failed",
    iceServers: [],
    initiator: false,
  }).catch((value) => value);

  assert.ok(error instanceof RealtimeTransportError);
  assert.equal(error.code, "rtcUnavailable");
  assert.equal(peerCloses, 1);
  assert.equal(channelCloses, 1);
});
