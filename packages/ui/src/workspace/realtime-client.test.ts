import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  RealtimeFrame,
  RealtimePeer,
  RealtimePeerChannel,
  RealtimePeerCreateOptions,
  RealtimePeerEvent,
  RealtimeSocket,
  RealtimeSocketEvent,
} from "@picbind/shared";
import { RealtimeTransportError } from "@picbind/shared";
import { decodeBinaryRelay } from "./realtime-protocol";
import { WorkspaceRealtimeClient, type WorkspaceRealtimeIdentity } from "./realtime";

Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

class MockSocket implements RealtimeSocket {
  state = "open" as const;
  readonly frames: RealtimeFrame[] = [];
  closeCount = 0;
  private readonly listeners = new Set<(event: RealtimeSocketEvent) => void>();

  subscribe(listener: (event: RealtimeSocketEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async send(frame: RealtimeFrame) { this.frames.push(frame); }
  async close() { this.closeCount += 1; }
}

class MockPeer implements RealtimePeer {
  readonly sent: Array<{ channel: RealtimePeerChannel; frame: RealtimeFrame }> = [];
  readonly candidates: import("@picbind/shared").RealtimeIceCandidate[] = [];
  closeCount = 0;
  failSend = false;
  sendError: Error | null = null;
  private readonly listeners = new Set<(event: RealtimePeerEvent) => void>();

  constructor(readonly id: string) {}
  subscribe(listener: (event: RealtimePeerEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async createOffer() { return { type: "offer" as const, sdp: "offer-sdp" }; }
  async createAnswer() { return { type: "answer" as const, sdp: "answer-sdp" }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate(value: import("@picbind/shared").RealtimeIceCandidate) { this.candidates.push(value); }
  async send(channel: RealtimePeerChannel, frame: RealtimeFrame) {
    if (this.sendError) throw this.sendError;
    if (this.failSend) throw new Error("send failed");
    this.sent.push({ channel, frame });
  }
  async bufferedAmount() { return 0; }
  async close() { this.closeCount += 1; }
}

function identity(role: "owner" | "collaborator"): WorkspaceRealtimeIdentity {
  return {
    workspaceId: "workspace-1",
    role,
    shareToken: role === "collaborator" ? "share-1" : null,
    ownerCapability: role === "owner" ? "owner-1" : null,
  };
}

function harness(role: "owner" | "collaborator") {
  const socket = new MockSocket();
  const nativePeers = new Map<string, MockPeer>();
  const client = new WorkspaceRealtimeClient(identity(role), {
    socketFactory: { async connect() { return socket; } },
    peerFactory: {
      async create(options: RealtimePeerCreateOptions) {
        const peer = new MockPeer(options.peerId);
        nativePeers.set(options.peerId, peer);
        return peer;
      },
    },
  }, "client-1");
  type TestPeer = {
    peer: MockPeer;
    controlOpen: boolean;
    bulkOpen: boolean;
    localReadyEpoch: number;
    remoteReadyEpoch: number;
    primary: boolean;
  };
  const internals = client as unknown as {
    socket: RealtimeSocket;
    receive: (frame: RealtimeFrame, transport: "socket") => void;
    peers: Map<string, TestPeer>;
    promotePeer: (peer: TestPeer) => void;
  };
  internals.socket = socket;
  const receive = (value: Record<string, unknown>) => internals.receive({
    kind: "text",
    data: JSON.stringify(value),
  }, "socket");
  const textFrames = () => socket.frames
    .filter((frame): frame is Extract<RealtimeFrame, { kind: "text" }> => frame.kind === "text")
    .map((frame) => JSON.parse(frame.data) as Record<string, unknown>);
  return { client, socket, nativePeers, internals, receive, textFrames };
}

test("collaborator initiates RTC with Worker-compatible signal names", async () => {
  const { receive, textFrames } = harness("collaborator");
  receive({ type: "connected", role: "collaborator", ownerOnline: true });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const offer = textFrames()[0];
  assert.equal(offer?.type, "webrtcOffer");
  assert.equal(offer?.targetRole, "owner");
  assert.equal((offer?.description as { type: string }).type, "offer");
});

test("owner answers each collaborator with an independent peer", async () => {
  const { internals, receive, textFrames } = harness("owner");
  for (const userId of ["guest-1", "guest-2"]) {
    receive({ type: "memberJoined", role: "collaborator", userId });
    receive({
      type: "webrtcOffer",
      senderId: userId,
      description: { type: "offer", sdp: `${userId}-offer` },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual([...internals.peers.keys()].sort(), ["guest-1", "guest-2"]);
  assert.deepEqual(
    textFrames().map((frame) => frame.targetUserId).sort(),
    ["guest-1", "guest-2"],
  );
});

test("promoting RTC keeps the WebSocket signaling connection open", async () => {
  const { client, internals, receive, socket } = harness("owner");
  receive({
    type: "webrtcOffer",
    senderId: "guest-1",
    description: { type: "offer", sdp: "offer-sdp" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const peer = internals.peers.get("guest-1")!;
  peer.localReadyEpoch = 7;
  peer.remoteReadyEpoch = 7;
  internals.promotePeer(peer);

  assert.equal(peer.primary, true);
  assert.equal(socket.closeCount, 0);
  await client.close();
});

test("owner routes per collaborator over RTC or targeted WebSocket", async () => {
  const { client, internals, receive, textFrames } = harness("owner");
  for (const userId of ["guest-rtc", "guest-socket"]) {
    receive({ type: "memberJoined", role: "collaborator", userId });
    receive({
      type: "webrtcOffer",
      senderId: userId,
      description: { type: "offer", sdp: `${userId}-offer` },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rtcPeer = internals.peers.get("guest-rtc")!;
  rtcPeer.primary = true;
  rtcPeer.controlOpen = true;

  client.send("reaction", { emoji: "ok" }, { delivery: "ephemeral" });
  await Promise.resolve();

  assert.equal(rtcPeer.peer.sent.length, 1);
  const relays = textFrames().filter((frame) => frame.type === "workspaceRelay");
  assert.equal(relays.length, 1);
  assert.equal(relays[0]?.route, "user");
  assert.equal(relays[0]?.targetUserId, "guest-socket");
  await client.close();
});

test("one RTC send failure falls back only to that collaborator", async () => {
  const { client, internals, receive, textFrames } = harness("owner");
  for (const userId of ["guest-rtc", "guest-socket"]) {
    receive({ type: "memberJoined", role: "collaborator", userId });
    receive({
      type: "webrtcOffer",
      senderId: userId,
      description: { type: "offer", sdp: `${userId}-offer` },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rtcPeer = internals.peers.get("guest-rtc")!;
  rtcPeer.primary = true;
  rtcPeer.controlOpen = true;
  rtcPeer.peer.failSend = true;

  client.send("reaction", { emoji: "ok" }, { delivery: "ephemeral" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const relays = textFrames().filter((frame) => frame.type === "workspaceRelay");
  assert.equal(relays.length, 2);
  assert.deepEqual(relays.map((frame) => frame.targetUserId).sort(), ["guest-rtc", "guest-socket"]);
  assert.ok(relays.every((frame) => frame.route === "user"));
  await client.close();
});

test("RTC bulk backpressure spills only the current frame to WebSocket", async () => {
  const { client, internals, receive, socket } = harness("owner");
  receive({
    type: "webrtcOffer",
    senderId: "guest-rtc",
    description: { type: "offer", sdp: "offer-sdp" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const peer = internals.peers.get("guest-rtc")!;
  peer.primary = true;
  peer.controlOpen = true;
  peer.bulkOpen = true;
  client.send("sourceStart", { requestId: "request-1" }, {
    route: "user",
    targetUserId: "guest-rtc",
    delivery: "reliable",
    dataClass: "sourceOrCommit",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(peer.peer.sent[0]?.channel, "control");
  peer.peer.sendError = new RealtimeTransportError(
    "rtcBackpressure",
    "bulk channel is full",
    true,
  );

  client.sendBinary("sourceChunk", { requestId: "request-1", index: 0 },
    Uint8Array.from([1, 2, 3]).buffer,
    { route: "user", targetUserId: "guest-rtc", delivery: "bulk", dataClass: "sourceOrCommit" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(peer.primary, true);
  assert.equal(peer.peer.closeCount, 0);
  assert.equal(socket.frames.filter((frame) => frame.kind === "binary").length, 1);
  await client.close();
});

test("bulk events do not create gaps in the reliable event sequence", () => {
  const { client, socket } = harness("owner");
  client.send("sourceStart", { requestId: "request-1" }, { delivery: "reliable" });
  client.sendBinary("sourceChunk", { requestId: "request-1", index: 0 },
    Uint8Array.from([1]).buffer, { delivery: "bulk" });
  client.send("sourceComplete", { requestId: "request-1" }, { delivery: "reliable" });

  const reliableSequences = socket.frames.flatMap((frame) => {
    if (frame.kind === "text") {
      const relay = JSON.parse(frame.data) as { event?: { reliability?: string; sequence?: number } };
      return relay.event?.reliability === "reliable" ? [relay.event.sequence] : [];
    }
    const relay = decodeBinaryRelay(frame.data);
    return relay?.event.reliability === "reliable" ? [relay.event.sequence] : [];
  });
  assert.deepEqual(reliableSequences, [1, 2]);
});

test("queues trickle ICE that arrives before asynchronous peer creation", async () => {
  const { nativePeers, receive } = harness("owner");
  receive({
    type: "webrtcIceCandidate",
    senderId: "guest-1",
    candidate: { candidate: "candidate:1 1 UDP 1 127.0.0.1 9 typ host" },
  });
  receive({
    type: "webrtcOffer",
    senderId: "guest-1",
    description: { type: "offer", sdp: "offer-sdp" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(nativePeers.get("guest-1")?.candidates.length, 1);
});

test("ACK removes a reliable event and close is idempotent", async () => {
  const { client, internals, receive, socket } = harness("owner");
  const eventId = client.send("styleUpdated", { revision: 2 }, { delivery: "reliable" });
  const reliable = (client as unknown as { reliable: Map<string, unknown> }).reliable;
  assert.equal(reliable.has(eventId), true);
  receive({ type: "eventAck", eventId });
  assert.equal(reliable.has(eventId), false);

  await Promise.all([client.close(), client.close()]);
  assert.equal(socket.closeCount, 1);
  assert.equal(internals.peers.size, 0);
});
