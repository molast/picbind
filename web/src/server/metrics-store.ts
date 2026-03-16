import { promises as fs } from "fs";
import path from "path";

export type CompressionFormat = "jpeg" | "png" | "webp" | "avif";

type FormatMetrics = {
  count: number;
  totalSavedBytes: number;
};

type MetricsPayload = {
  totalCompressed: number;
  totalViews: number;
  totalSavedBytes: number;
  formatStats: Record<CompressionFormat, FormatMetrics>;
  showCompressedCount: boolean;
  showCompareSection: boolean;
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

function createInitialFormatStats(): Record<CompressionFormat, FormatMetrics> {
  return {
    jpeg: { count: 0, totalSavedBytes: 0 },
    png: { count: 0, totalSavedBytes: 0 },
    webp: { count: 0, totalSavedBytes: 0 },
    avif: { count: 0, totalSavedBytes: 0 },
  };
}

function createInitialPayload(): MetricsPayload {
  return {
    totalCompressed: 0,
    totalViews: 0,
    totalSavedBytes: 0,
    formatStats: createInitialFormatStats(),
    showCompressedCount: true,
    showCompareSection: true,
    updatedAt: new Date(0).toISOString(),
  };
}

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify(createInitialPayload(), null, 2),
      "utf8",
    );
  }
}

async function readPayload(): Promise<MetricsPayload> {
  await ensureFile();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<MetricsPayload>;
    const parsedStats = (parsed.formatStats || {}) as Partial<
      Record<CompressionFormat, Partial<FormatMetrics>>
    >;
    const initialStats = createInitialFormatStats();

    return {
      totalCompressed: Number(parsed.totalCompressed || 0),
      totalViews: Number(parsed.totalViews || 0),
      totalSavedBytes: Number(parsed.totalSavedBytes || 0),
      formatStats: {
        jpeg: {
          count: Number(parsedStats.jpeg?.count || initialStats.jpeg.count),
          totalSavedBytes: Number(
            parsedStats.jpeg?.totalSavedBytes || initialStats.jpeg.totalSavedBytes,
          ),
        },
        png: {
          count: Number(parsedStats.png?.count || initialStats.png.count),
          totalSavedBytes: Number(
            parsedStats.png?.totalSavedBytes || initialStats.png.totalSavedBytes,
          ),
        },
        webp: {
          count: Number(parsedStats.webp?.count || initialStats.webp.count),
          totalSavedBytes: Number(
            parsedStats.webp?.totalSavedBytes || initialStats.webp.totalSavedBytes,
          ),
        },
        avif: {
          count: Number(parsedStats.avif?.count || initialStats.avif.count),
          totalSavedBytes: Number(
            parsedStats.avif?.totalSavedBytes || initialStats.avif.totalSavedBytes,
          ),
        },
      },
      showCompressedCount:
        typeof parsed.showCompressedCount === "boolean"
          ? parsed.showCompressedCount
          : true,
      showCompareSection:
        typeof parsed.showCompareSection === "boolean"
          ? parsed.showCompareSection
          : true,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return createInitialPayload();
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
      ...current,
      totalCompressed: nextTotal,
      updatedAt: new Date().toISOString(),
    });
    return nextTotal;
  });
}

export async function recordCompressionEvents(
  events: Array<{ format: CompressionFormat; savedBytes: number }>,
) {
  const validEvents = events.filter(
    (event) =>
      ["jpeg", "png", "webp", "avif"].includes(event.format) &&
      Number.isFinite(event.savedBytes),
  ) as Array<{ format: CompressionFormat; savedBytes: number }>;

  if (!validEvents.length) {
    return getAdminDashboardState();
  }

  return withLock(async () => {
    const current = await readPayload();
    const nextStats: Record<CompressionFormat, FormatMetrics> = {
      jpeg: { ...current.formatStats.jpeg },
      png: { ...current.formatStats.png },
      webp: { ...current.formatStats.webp },
      avif: { ...current.formatStats.avif },
    };

    let totalSavedBytesDelta = 0;
    for (const event of validEvents) {
      nextStats[event.format] = {
        count: nextStats[event.format].count + 1,
        totalSavedBytes:
          nextStats[event.format].totalSavedBytes + Math.round(event.savedBytes),
      };
      totalSavedBytesDelta += Math.round(event.savedBytes);
    }

    const next: MetricsPayload = {
      ...current,
      totalCompressed: current.totalCompressed + validEvents.length,
      totalSavedBytes: current.totalSavedBytes + totalSavedBytesDelta,
      formatStats: nextStats,
      updatedAt: new Date().toISOString(),
    };

    await writePayload(next);
    return {
      totalCompressed: next.totalCompressed,
      totalViews: next.totalViews,
      totalSavedBytes: next.totalSavedBytes,
      formatStats: next.formatStats,
      showCompressedCount: next.showCompressedCount,
      showCompareSection: next.showCompareSection,
      updatedAt: next.updatedAt,
    };
  });
}

export async function getPageViewCount() {
  return withLock(async () => {
    const data = await readPayload();
    return data.totalViews;
  });
}

export async function incrementPageViewCount(delta = 1) {
  if (!Number.isFinite(delta) || delta <= 0) {
    return getPageViewCount();
  }

  return withLock(async () => {
    const current = await readPayload();
    const nextTotal = Math.max(0, Math.floor(current.totalViews + delta));
    await writePayload({
      ...current,
      totalViews: nextTotal,
      updatedAt: new Date().toISOString(),
    });
    return nextTotal;
  });
}

export async function getPublicUiConfig() {
  return withLock(async () => {
    const data = await readPayload();
    return {
      showCompressedCount: data.showCompressedCount,
      showCompareSection: data.showCompareSection,
    };
  });
}

export async function getAdminDashboardState() {
  return withLock(async () => {
    const data = await readPayload();
    return {
      totalCompressed: data.totalCompressed,
      totalViews: data.totalViews,
      totalSavedBytes: data.totalSavedBytes,
      formatStats: data.formatStats,
      showCompressedCount: data.showCompressedCount,
      showCompareSection: data.showCompareSection,
      updatedAt: data.updatedAt,
    };
  });
}

export async function updateUiConfig(config: {
  showCompressedCount?: boolean;
  showCompareSection?: boolean;
}) {
  return withLock(async () => {
    const current = await readPayload();
    const next: MetricsPayload = {
      ...current,
      showCompressedCount:
        typeof config.showCompressedCount === "boolean"
          ? config.showCompressedCount
          : current.showCompressedCount,
      showCompareSection:
        typeof config.showCompareSection === "boolean"
          ? config.showCompareSection
          : current.showCompareSection,
      updatedAt: new Date().toISOString(),
    };
    await writePayload(next);
    return {
      totalCompressed: next.totalCompressed,
      totalViews: next.totalViews,
      totalSavedBytes: next.totalSavedBytes,
      formatStats: next.formatStats,
      showCompressedCount: next.showCompressedCount,
      showCompareSection: next.showCompareSection,
      updatedAt: next.updatedAt,
    };
  });
}
