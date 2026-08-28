import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@tauri-apps/plugin-websocket";
import {
  createTauriSocketConnector,
  TauriRealtimeSocketFactory,
  type TauriSocketBridge,
  type TauriSocketHandle,
} from "./tauri-socket";

class Handle implements TauriSocketHandle {
  readonly sent: Array<Message | string | number[]> = [];
  disconnects = 0;
  listener: ((message: Message) => void) | null = null;
  sendHook: ((message: Message | string | number[]) => Promise<void>) | null = null;

  addListener(listener: (message: Message) => void) {
    this.listener = listener;
    return () => { this.listener = null; };
  }
  async send(message: Message | string | number[]) {
    await this.sendHook?.(message);
    this.sent.push(message);
  }
  async disconnect() { this.disconnects += 1; }
}

test("Tauri socket preserves the Worker first frame emitted during connect", async () => {
  let channelListener: ((message: Message) => void) | null = null;
  let channelCloses = 0;
  const bridge: TauriSocketBridge = {
    channel(listener) {
      channelListener = listener;
      return { value: {}, close() { channelCloses += 1; } };
    },
    async invoke<T>(command: string) {
      if (command.endsWith("|connect")) {
        (channelListener as unknown as (message: Message) => void)({
          type: "Text",
          data: JSON.stringify({ type: "connected", role: "collaborator" }),
        });
        return 7 as T;
      }
      return undefined as T;
    },
  };
  const socket = await new TauriRealtimeSocketFactory(
    createTauriSocketConnector(bridge),
  ).connect({ url: "wss://api.picbind.com/test" });
  const messages: string[] = [];
  socket.subscribe((event) => {
    if (event.type === "message" && event.frame.kind === "text") {
      messages.push(event.frame.data);
    }
  });

  assert.deepEqual(messages.map((value) => JSON.parse(value).type), ["connected"]);
  await socket.close();
  assert.equal(channelCloses, 1);
});

test("Tauri socket binds its native handshake to the current page Origin", async () => {
  const handle = new Handle();
  let origin: string | null = null;
  const socket = await new TauriRealtimeSocketFactory(
    async (_url, config) => {
      origin = new Headers(config.headers).get("origin");
      return handle;
    },
    () => "http://localhost:3000",
  ).connect({ url: "wss://api.picbind.com/test" });

  assert.equal(origin, "http://localhost:3000");
  await socket.close();
});

test("Tauri socket converts binary only at the adapter boundary", async () => {
  const handle = new Handle();
  const socket = await new TauriRealtimeSocketFactory(async () => handle).connect({ url: "wss://api.picbind.com/test" });
  let bytes: number[] = [];
  socket.subscribe((event) => {
    if (event.type === "message" && event.frame.kind === "binary") {
      bytes = [...new Uint8Array(event.frame.data)];
    }
  });
  handle.listener?.({ type: "Binary", data: [1, 2, 3] });
  await socket.send({ kind: "binary", data: Uint8Array.from([4, 5]).buffer });

  assert.deepEqual(bytes, [1, 2, 3]);
  assert.deepEqual(handle.sent[0], [4, 5]);
});

test("Tauri socket close is idempotent", async () => {
  const handle = new Handle();
  const socket = await new TauriRealtimeSocketFactory(async () => handle).connect({ url: "wss://api.picbind.com/test" });
  await Promise.all([socket.close(), socket.close()]);
  assert.equal(handle.disconnects, 1);
});

test("Tauri socket tolerates the Worker winning the close race", async () => {
  const handle = new Handle();
  handle.sendHook = async () => {
    throw new Error("connection not found for the given id: 7");
  };
  const socket = await new TauriRealtimeSocketFactory(async () => handle)
    .connect({ url: "wss://api.picbind.com/test" });

  await socket.close(1000, "member-removed");

  assert.equal(socket.state, "closed");
});

test("Tauri socket drains accepted FIFO writes before closing", async () => {
  const handle = new Handle();
  let releaseFirst!: () => void;
  let first = true;
  const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  handle.sendHook = async () => {
    if (first) {
      first = false;
      await blocked;
    }
  };
  const socket = await new TauriRealtimeSocketFactory(async () => handle).connect({ url: "wss://api.picbind.com/test" });
  const firstWrite = socket.send({ kind: "text", data: "first" });
  const secondWrite = socket.send({ kind: "text", data: "second" });
  await Promise.resolve();
  const closing = socket.close();
  releaseFirst();
  await Promise.all([firstWrite, secondWrite, closing]);

  assert.deepEqual(handle.sent.slice(0, 2), ["first", "second"]);
  assert.equal(handle.disconnects, 1);
});
