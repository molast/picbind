import assert from "node:assert/strict";
import { test } from "node:test";
import { REALTIME_LIMITS } from "@picbind/shared";
import { BrowserRealtimeSocketFactory } from "./browser-socket";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static latest: FakeWebSocket;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  readonly sent: unknown[] = [];
  closeCount = 0;
  private readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(readonly url: string) { FakeWebSocket.latest = this; }
  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  send(value: unknown) { this.sent.push(value); }
  close(code: number, reason: string) {
    this.closeCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }
  open() { this.readyState = FakeWebSocket.OPEN; this.dispatch("open", {}); }
  message(data: unknown) { this.dispatch("message", { data }); }
  private dispatch(type: string, event: unknown) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });

test("browser socket preserves ArrayBuffer frames and closes idempotently", async () => {
  const socket = await new BrowserRealtimeSocketFactory().connect({ url: "wss://api.picbind.com/test" });
  const events: unknown[] = [];
  socket.subscribe((event) => events.push(event));
  FakeWebSocket.latest.open();
  const incoming = Uint8Array.from([1, 2, 3]).buffer;
  FakeWebSocket.latest.message(incoming);
  await socket.send({ kind: "binary", data: Uint8Array.from([4, 5]).buffer });
  await Promise.all([socket.close(), socket.close()]);

  assert.equal(FakeWebSocket.latest.binaryType, "arraybuffer");
  assert.equal((events[1] as { frame: { data: ArrayBuffer } }).frame.data, incoming);
  assert.deepEqual([...new Uint8Array(FakeWebSocket.latest.sent[0] as ArrayBuffer)], [4, 5]);
  assert.equal(FakeWebSocket.latest.closeCount, 1);
});

test("browser socket rejects oversized incoming text frames", async () => {
  const socket = await new BrowserRealtimeSocketFactory().connect({ url: "wss://api.picbind.com/test" });
  const events: Array<{ type: string; error?: { code: string } }> = [];
  socket.subscribe((event) => events.push(event));
  FakeWebSocket.latest.open();
  FakeWebSocket.latest.message("x".repeat(REALTIME_LIMITS.maximumTextFrameBytes + 1));

  assert.equal(events.at(-1)?.type, "error");
  assert.equal(events.at(-1)?.error?.code, "invalidFrame");
  await socket.close();
});
