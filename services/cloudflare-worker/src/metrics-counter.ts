type CompressionFormat = "jpeg" | "png" | "webp" | "avif" | "jxl";

type FormatMetrics = {
  count: number;
  totalSavedBytes: number;
};

export type MetricsCounterState = {
  totalCompressed: number;
  totalViews: number;
  totalSavedBytes: number;
  formatStats: Record<CompressionFormat, FormatMetrics>;
  updatedAt: string;
};

const STATE_KEY = "metrics:counter:v1";
const PENDING_SYNC_KEY = "metrics:pending-sync:v1";
const LAST_SYNC_KEY = "metrics:last-sync-at:v1";
export const METRICS_SUMMARY_KEY = "metrics:summary:v1";
const DELTA_MAX = 20;
const EVENT_BATCH_MAX = 50;
const SYNC_PENDING_THRESHOLD = 100;
const SYNC_INTERVAL_MS = 60_000;

type DurableEnv = {
  METRICS_KV: {
    put(key: string, value: string): Promise<void>;
  };
};

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

function createInitialFormatStats(): Record<CompressionFormat, FormatMetrics> {
  return {
    jpeg: { count: 0, totalSavedBytes: 0 },
    png: { count: 0, totalSavedBytes: 0 },
    webp: { count: 0, totalSavedBytes: 0 },
    avif: { count: 0, totalSavedBytes: 0 },
    jxl: { count: 0, totalSavedBytes: 0 },
  };
}

function createInitialState(): MetricsCounterState {
  return {
    totalCompressed: 0,
    totalViews: 0,
    totalSavedBytes: 0,
    formatStats: createInitialFormatStats(),
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeState(input: Partial<MetricsCounterState> | null): MetricsCounterState {
  const initial = createInitialState();
  const stats = input?.formatStats || initial.formatStats;
  return {
    totalCompressed: Number(input?.totalCompressed || 0),
    totalViews: Number(input?.totalViews || 0),
    totalSavedBytes: Number(input?.totalSavedBytes || 0),
    formatStats: {
      jpeg: {
        count: Number(stats.jpeg?.count || 0),
        totalSavedBytes: Number(stats.jpeg?.totalSavedBytes || 0),
      },
      png: {
        count: Number(stats.png?.count || 0),
        totalSavedBytes: Number(stats.png?.totalSavedBytes || 0),
      },
      webp: {
        count: Number(stats.webp?.count || 0),
        totalSavedBytes: Number(stats.webp?.totalSavedBytes || 0),
      },
      avif: {
        count: Number(stats.avif?.count || 0),
        totalSavedBytes: Number(stats.avif?.totalSavedBytes || 0),
      },
      jxl: {
        count: Number(stats.jxl?.count || 0),
        totalSavedBytes: Number(stats.jxl?.totalSavedBytes || 0),
      },
    },
    updatedAt: input?.updatedAt || initial.updatedAt,
  };
}

async function parseBody<T extends object>(request: Request): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}

export class MetricsCounter {
  private readonly env: DurableEnv;

  constructor(private readonly state: DurableObjectState, env: DurableEnv) {
    this.env = env;
  }

  private async readState() {
    const raw = await this.state.storage.get<string>(STATE_KEY);
    if (!raw) {
      return createInitialState();
    }
    try {
      return normalizeState(JSON.parse(raw) as Partial<MetricsCounterState>);
    } catch {
      return createInitialState();
    }
  }

  private async writeState(next: MetricsCounterState) {
    await this.state.storage.put(STATE_KEY, JSON.stringify(next));
  }

  private async syncSummaryToKv(
    env: DurableEnv,
    summary: MetricsCounterState,
    force = false,
  ) {
    const now = Date.now();
    const lastSync =
      (await this.state.storage.get<number>(LAST_SYNC_KEY)) ?? 0;
    const pending =
      (await this.state.storage.get<number>(PENDING_SYNC_KEY)) ?? 0;

    const nextPending = pending + 1;
    const shouldSync =
      force ||
      nextPending >= SYNC_PENDING_THRESHOLD ||
      now - lastSync >= SYNC_INTERVAL_MS;

    if (!shouldSync) {
      await this.state.storage.put(PENDING_SYNC_KEY, nextPending);
      return;
    }

    await env.METRICS_KV.put(METRICS_SUMMARY_KEY, JSON.stringify(summary));
    await this.state.storage.put(PENDING_SYNC_KEY, 0);
    await this.state.storage.put(LAST_SYNC_KEY, now);
  }

  private async handleMetrics(request: Request) {
    if (request.method === "GET") {
      return json(await this.readState());
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await parseBody<{
      delta?: number;
      events?: Array<{ format?: CompressionFormat; savedBytes?: number }>;
    }>(request);
    const counter = await this.readState();

    if (Array.isArray(body.events)) {
      if (!body.events.length || body.events.length > EVENT_BATCH_MAX) {
        return json({ error: "Invalid events" }, { status: 400 });
      }

      let totalSavedBytesDelta = 0;
      for (const event of body.events) {
        if (!event.format || !["jpeg", "png", "webp", "avif", "jxl"].includes(event.format)) {
          continue;
        }
        const savedBytes = Math.round(Number(event.savedBytes || 0));
        counter.formatStats[event.format].count += 1;
        counter.formatStats[event.format].totalSavedBytes += savedBytes;
        counter.totalCompressed += 1;
        totalSavedBytesDelta += savedBytes;
      }

      counter.totalSavedBytes += totalSavedBytesDelta;
      counter.updatedAt = new Date().toISOString();
      await this.writeState(counter);
      await this.syncSummaryToKv(this.env, counter);
      return json(counter);
    }

    const delta = Number(body.delta || 0);
    if (Number.isFinite(delta) && delta > 0 && delta <= DELTA_MAX) {
      // Keep backward compatibility for old clients but disable delta-based
      // increments to avoid duplicate counting with event-based reporting.
      return json(counter);
    }

    return json({ error: "Invalid metrics payload" }, { status: 400 });
  }

  private async handleView(request: Request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }
    const counter = await this.readState();
    counter.totalViews += 1;
    counter.updatedAt = new Date().toISOString();
    await this.writeState(counter);
    await this.syncSummaryToKv(this.env, counter);
    return json(counter);
  }

  private async handleSyncSummary(request: Request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }
    const counter = await this.readState();
    await this.syncSummaryToKv(this.env, counter, true);
    return json(counter);
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/state") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, { status: 405 });
      }
      return json(await this.readState());
    }

    if (pathname === "/metrics") {
      return this.handleMetrics(request);
    }

    if (pathname === "/view") {
      return this.handleView(request);
    }

    if (pathname === "/sync-summary") {
      return this.handleSyncSummary(request);
    }

    return json({ error: "Not found" }, { status: 404 });
  }
}
