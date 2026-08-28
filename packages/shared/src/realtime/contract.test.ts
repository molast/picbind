import assert from "node:assert/strict";
import { test } from "node:test";
import { RealtimeFifoQueue, RealtimeTransportError } from "./index";

test("bounded realtime FIFO preserves asynchronous send order", async () => {
  const queue = new RealtimeFifoQueue(32);
  const order: number[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = queue.enqueue(8, async () => {
    order.push(1);
    await firstBlocked;
    order.push(2);
  });
  const second = queue.enqueue(8, async () => { order.push(3); });

  await Promise.resolve();
  assert.deepEqual(order, [1]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(queue.queuedBytes, 0);
});

test("bounded realtime FIFO rejects overflow without dropping accepted writes", async () => {
  const queue = new RealtimeFifoQueue(4);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const accepted = queue.enqueue(4, () => blocked);
  const rejected = await queue.enqueue(1, async () => undefined).catch((error) => error);

  assert.ok(rejected instanceof RealtimeTransportError);
  assert.equal(rejected.code, "socketQueueFull");
  release();
  await accepted;
});

test("closed realtime FIFO rejects new writes with a stable error", async () => {
  const queue = new RealtimeFifoQueue(4);
  await queue.close();
  const error = await queue.enqueue(1, async () => undefined).catch((value) => value);
  assert.ok(error instanceof RealtimeTransportError);
  assert.equal(error.code, "socketClosed");
});
