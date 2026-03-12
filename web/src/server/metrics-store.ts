import { promises as fs } from "fs";
import path from "path";

type MetricsPayload = {
  totalCompressed: number;
  updatedAt: string;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "metrics.json");

let lock: Promise<void> = Promise.resolve();

function withLock<T>(work: () => Promise<T>): Promise<T> {
  const next = lock.then(work, work);
  lock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    const initial: MetricsPayload = {
      totalCompressed: 0,
      updatedAt: new Date(0).toISOString(),
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function readPayload(): Promise<MetricsPayload> {
  await ensureFile();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<MetricsPayload>;
    return {
      totalCompressed: Number(parsed.totalCompressed || 0),
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return {
      totalCompressed: 0,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

async function writePayload(payload: MetricsPayload) {
  await ensureFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export async function getTotalCompressedCount() {
  return withLock(async () => {
    const data = await readPayload();
    return data.totalCompressed;
  });
}

export async function incrementCompressedCount(delta: number) {
  if (!Number.isFinite(delta) || delta <= 0) {
    return getTotalCompressedCount();
  }

  return withLock(async () => {
    const current = await readPayload();
    const nextTotal = Math.max(0, Math.floor(current.totalCompressed + delta));
    await writePayload({
      totalCompressed: nextTotal,
      updatedAt: new Date().toISOString(),
    });
    return nextTotal;
  });
}
