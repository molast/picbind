import assert from "node:assert/strict";
import { test } from "node:test";
import { REALTIME_LIMITS, type RealtimePeerEvent } from "@picbind/shared";
import { BrowserRealtimePeerFactory } from "./browser-peer";

class FakeDataChannel {
  binaryType = "blob";
  bufferedAmount = 0;
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: unknown[] = [];

  constructor(readonly label: string, readonly ordered: boolean) {}
  send(value: unknown) { this.sent.push(value); }
  close() { this.readyState = "closed"; this.onclose?.(); }
  open() { this.readyState = "open"; this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

class FakePeerConnection {
  static latest: FakePeerConnection;
  connectionState: RTCPeerConnectionState = "new";
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  readonly channels: FakeDataChannel[] = [];
  readonly candidates: RTCIceCandidateInit[] = [];

  constructor() { FakePeerConnection.latest = this; }
  createDataChannel(label: string, options?: RTCDataChannelInit) {
    const channel = new FakeDataChannel(label, options?.ordered !== false);
    this.channels.push(channel);
    return channel as unknown as RTCDataChannel;
  }
  async createOffer() { return { type: "offer" as const, sdp: "offer-sdp" }; }
  async createAnswer() { return { type: "answer" as const, sdp: "answer-sdp" }; }
  async setLocalDescription() {}
  async setRemoteDescription(value: RTCSessionDescriptionInit) { this.remoteDescription = value as RTCSessionDescription; }
  async addIceCandidate(value: RTCIceCandidateInit) { this.candidates.push(value); }
  close() { this.connectionState = "closed"; }
}

Object.defineProperty(globalThis, "RTCPeerConnection", {
  configurable: true,
  value: FakePeerConnection,
});

test("browser peer creates two ordered channels and keeps binary as ArrayBuffer", async () => {
  const peer = await new BrowserRealtimePeerFactory().create({
    sessionId: "session-1",
    peerId: "peer-1",
    iceServers: [],
    initiator: true,
  });
  const events: RealtimePeerEvent[] = [];
  peer.subscribe((event) => events.push(event));
  const [control, bulk] = FakePeerConnection.latest.channels;
  control.open();
  bulk.open();
  const incoming = Uint8Array.from([1, 2, 3]).buffer;
  bulk.message(incoming);
  await peer.send("bulk", { kind: "binary", data: Uint8Array.from([4, 5]).buffer });

  assert.deepEqual(FakePeerConnection.latest.channels.map((channel) => [channel.label, channel.ordered]), [
    ["workspace-control", true],
    ["workspace-bulk", true],
  ]);
  const message = events.find((event) => event.type === "message") as Extract<RealtimePeerEvent, { type: "message" }>;
  assert.equal(message.frame.kind === "binary" ? message.frame.data : null, incoming);
  assert.deepEqual([...new Uint8Array(bulk.sent[0] as ArrayBuffer)], [4, 5]);
  await peer.close();
});

test("browser peer queues ICE until the remote description is set", async () => {
  const peer = await new BrowserRealtimePeerFactory().create({
    sessionId: "session-1",
    peerId: "peer-2",
    iceServers: [],
    initiator: false,
  });
  await peer.addIceCandidate({ candidate: "candidate:1" });
  assert.equal(FakePeerConnection.latest.candidates.length, 0);
  await peer.setRemoteDescription({ type: "offer", sdp: "offer-sdp" });
  assert.equal(FakePeerConnection.latest.candidates.length, 1);
  await peer.close();
});

test("browser peer rejects oversized incoming DataChannel frames", async () => {
  const peer = await new BrowserRealtimePeerFactory().create({
    sessionId: "session-1",
    peerId: "peer-3",
    iceServers: [],
    initiator: true,
  });
  const events: RealtimePeerEvent[] = [];
  peer.subscribe((event) => events.push(event));
  const [control] = FakePeerConnection.latest.channels;
  control.open();
  control.message("x".repeat(REALTIME_LIMITS.maximumTextFrameBytes + 1));

  const error = events.at(-1) as Extract<RealtimePeerEvent, { type: "error" }>;
  assert.equal(error.type, "error");
  assert.equal(error.error.code, "invalidFrame");
  await peer.close();
});
