import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkspaceRealtimeClient } from "./realtime";
import { defaultWorkspaceStyle, type WorkspaceIdentity } from "./types";

class MockDataChannel {
  binaryType = "blob";
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState: RTCDataChannelState = "connecting";
  readonly sent: unknown[] = [];

  constructor(readonly label: string) {}
  close() {}
  send(value: unknown) { this.sent.push(value); }
}

class MockPeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  remoteDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;

  addIceCandidate() { return Promise.resolve(); }
  close() {}
  createAnswer() { return Promise.resolve({ type: "answer", sdp: "answer-sdp" } as RTCSessionDescriptionInit); }
  createDataChannel(label: string) { return new MockDataChannel(label) as unknown as RTCDataChannel; }
  createOffer() { return Promise.resolve({ type: "offer", sdp: "offer-sdp" } as RTCSessionDescriptionInit); }
  setLocalDescription() { return Promise.resolve(); }
  setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription;
    return Promise.resolve();
  }
}

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "RTCPeerConnection", {
  configurable: true,
  value: MockPeerConnection,
});
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: class { static readonly OPEN = 1; },
});

function identity(role: "owner" | "collaborator"): WorkspaceIdentity {
  return {
    workspaceId: "workspace-1",
    name: "Workspace",
    role,
    shareToken: role === "collaborator" ? "share-1" : null,
    ownerCapability: role === "owner" ? "owner-1" : null,
    createdAt: 1,
    updatedAt: 1,
    style: defaultWorkspaceStyle(),
  };
}

function harness(role: "owner" | "collaborator") {
  const frames: Record<string, unknown>[] = [];
  let socketCloseCount = 0;
  const client = new WorkspaceRealtimeClient(identity(role));
  type TestPeer = {
    control: MockDataChannel | null;
    localReadyEpoch: number;
    remoteReadyEpoch: number;
    primary: boolean;
  };
  const internals = client as unknown as {
    socket: { readyState: number; send: (frame: string) => void; close: () => void };
    receive: (raw: string, transport: "socket") => void;
    peers: Map<string, TestPeer>;
    promotePeer: (peer: TestPeer) => void;
  };
  internals.socket = {
    readyState: 1,
    send: (frame) => frames.push(JSON.parse(frame) as Record<string, unknown>),
    close: () => { socketCloseCount += 1; },
  };
  return {
    client,
    frames,
    internals,
    receive: internals.receive.bind(client),
    socketCloseCount: () => socketCloseCount,
  };
}

test("collaborator initiates RTC with Worker-compatible signal names", async () => {
  const { frames, receive } = harness("collaborator");
  receive(JSON.stringify({ type: "connected", role: "collaborator", ownerOnline: true }), "socket");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(frames[0]?.type, "webrtcOffer");
  assert.equal(frames[0]?.targetRole, "owner");
  assert.equal((frames[0]?.description as RTCSessionDescriptionInit).type, "offer");
});

test("owner answers a single collaborator with Worker-compatible signal names", async () => {
  const { frames, receive } = harness("owner");
  receive(JSON.stringify({
    type: "memberJoined",
    role: "collaborator",
    userId: "guest-1",
  }), "socket");
  receive(JSON.stringify({
    type: "webrtcOffer",
    senderId: "guest-1",
    description: { type: "offer", sdp: "offer-sdp" },
  }), "socket");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(frames[0]?.type, "webrtcAnswer");
  assert.equal(frames[0]?.targetUserId, "guest-1");
  assert.equal((frames[0]?.description as RTCSessionDescriptionInit).type, "answer");
});

test("owner keeps an independent RTC peer for every collaborator", async () => {
  const { frames, internals, receive } = harness("owner");
  for (const userId of ["guest-1", "guest-2"]) {
    receive(JSON.stringify({ type: "memberJoined", role: "collaborator", userId }), "socket");
    receive(JSON.stringify({
      type: "webrtcOffer",
      senderId: userId,
      description: { type: "offer", sdp: `${userId}-offer` },
    }), "socket");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual([...internals.peers.keys()].sort(), ["guest-1", "guest-2"]);
  assert.deepEqual(frames.map((frame) => frame.targetUserId).sort(), ["guest-1", "guest-2"]);
});

test("promoting RTC keeps the WebSocket signaling connection open", () => {
  const { client, internals, receive, socketCloseCount } = harness("owner");
  receive(JSON.stringify({ type: "memberJoined", role: "collaborator", userId: "guest-1" }), "socket");
  receive(JSON.stringify({
    type: "webrtcOffer",
    senderId: "guest-1",
    description: { type: "offer", sdp: "offer-sdp" },
  }), "socket");
  const peer = internals.peers.get("guest-1")!;
  peer.localReadyEpoch = 7;
  peer.remoteReadyEpoch = 7;
  internals.promotePeer(peer);

  assert.equal(peer.primary, true);
  assert.equal(socketCloseCount(), 0);
  client.disconnect();
});

test("owner routes independently over RTC and targeted WebSocket per collaborator", async () => {
  const { client, frames, internals, receive } = harness("owner");
  for (const userId of ["guest-rtc", "guest-socket"]) {
    receive(JSON.stringify({ type: "memberJoined", role: "collaborator", userId }), "socket");
    receive(JSON.stringify({
      type: "webrtcOffer",
      senderId: userId,
      description: { type: "offer", sdp: `${userId}-offer` },
    }), "socket");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rtcPeer = internals.peers.get("guest-rtc")!;
  rtcPeer.primary = true;
  rtcPeer.control = new MockDataChannel("workspace-control");
  rtcPeer.control.readyState = "open";

  client.send("reaction", { emoji: "ok" }, { delivery: "ephemeral" });

  assert.equal(rtcPeer.control!.sent.length, 1);
  const relays = frames.filter((frame) => frame.type === "workspaceRelay");
  assert.equal(relays.length, 1);
  assert.equal(relays[0]?.route, "user");
  assert.equal(relays[0]?.targetUserId, "guest-socket");
  client.disconnect();
});
