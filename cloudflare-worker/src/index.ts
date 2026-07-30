import {
  METRICS_SUMMARY_KEY,
  MetricsCounter,
  type MetricsCounterState,
} from "./metrics-counter";
import {
  handleCreateShareRoom,
  handleShareRoomRealtime,
  handleShareRoomSocket,
} from "./realtime/share-room";
import { ShareRoomObject } from "./realtime/share-room-object";
import { devError, isDevMode, type RuntimeLogEnv } from "./runtime-log";
import type { QiniuStorageEnv } from "./qiniu-storage";

type CompressionFormat = "jpeg" | "png" | "webp" | "avif";

type FormatMetrics = {
  count: number;
  totalSavedBytes: number;
};

type MetricsConfig = {
  showCompressedCount: boolean;
  updatedAt: string;
};

type Env = RuntimeLogEnv & QiniuStorageEnv & {
  LOCAL_RUNTIME?: string;
  METRICS_KV: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  METRICS_COUNTER: DurableObjectNamespace;
  REALTIME_ROOMS: DurableObjectNamespace;
  SHARE_IMAGES_R2: R2Bucket;
  GLOBAL_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  ROUTE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  ADMIN_KEY?: string;
  SITE_URL?: string;
  ROOM_URL?: string;
  ALLOWED_ORIGINS?: string;
  BAIDU_PUSH_SITE?: string;
  BAIDU_PUSH_TOKEN?: string;
  TURN_TOKEN_ID?: string;
  TURN_API_TOKEN?: string;
  FILE_TRANSFER_MODE?: string;
  MAX_IMAGE_TRANSFER_SIZE_MB?: string;
  R2_RTT_THRESHOLD_MS?: string;
  R2_FILE_TTL_SECONDS?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

const CONFIG_KEY = "metrics:config:v1";
const BAIDU_PUSH_ENDPOINT = "http://data.zz.baidu.com/urls";
const COUNTER_INSTANCE_NAME = "global";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

function createInitialConfig(): MetricsConfig {
  return {
    showCompressedCount: false,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeConfig(input: Partial<MetricsConfig> | null): MetricsConfig {
  const initial = createInitialConfig();
  return {
    showCompressedCount:
      typeof input?.showCompressedCount === "boolean"
        ? input.showCompressedCount
        : false,
    updatedAt: input?.updatedAt || initial.updatedAt,
  };
}

function createInitialCounterState(): MetricsCounterState {
  return {
    totalCompressed: 0,
    totalViews: 0,
    totalSavedBytes: 0,
    formatStats: {
      jpeg: { count: 0, totalSavedBytes: 0 },
      png: { count: 0, totalSavedBytes: 0 },
      webp: { count: 0, totalSavedBytes: 0 },
      avif: { count: 0, totalSavedBytes: 0 },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeCounterState(input: Partial<MetricsCounterState> | null): MetricsCounterState {
  const initial = createInitialCounterState();
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
    },
    updatedAt: input?.updatedAt || initial.updatedAt,
  };
}

async function readCounterSummaryFromKv(env: Env) {
  const raw = await env.METRICS_KV.get(METRICS_SUMMARY_KEY);
  if (!raw) {
    return null;
  }
  try {
    return normalizeCounterState(JSON.parse(raw) as Partial<MetricsCounterState>);
  } catch {
    return null;
  }
}

async function readConfig(env: Env) {
  const raw = await env.METRICS_KV.get(CONFIG_KEY);
  if (!raw) {
    return createInitialConfig();
  }
  try {
    return normalizeConfig(JSON.parse(raw) as Partial<MetricsConfig>);
  } catch {
    return createInitialConfig();
  }
}

async function writeConfig(env: Env, state: MetricsConfig) {
  await env.METRICS_KV.put(CONFIG_KEY, JSON.stringify(state));
}

function publicMetrics(counter: MetricsCounterState, config: MetricsConfig) {
  return {
    totalCompressed: counter.totalCompressed,
    totalSavedBytes: counter.totalSavedBytes,
    formatStats: counter.formatStats,
    showCompressedCount: config.showCompressedCount,
  };
}

function mergeCounterState(
  base: MetricsCounterState,
  incoming: MetricsCounterState,
): MetricsCounterState {
  return {
    totalCompressed: Math.max(base.totalCompressed, incoming.totalCompressed),
    totalViews: Math.max(base.totalViews, incoming.totalViews),
    totalSavedBytes: Math.max(base.totalSavedBytes, incoming.totalSavedBytes),
    formatStats: {
      jpeg: {
        count: Math.max(base.formatStats.jpeg.count, incoming.formatStats.jpeg.count),
        totalSavedBytes: Math.max(
          base.formatStats.jpeg.totalSavedBytes,
          incoming.formatStats.jpeg.totalSavedBytes,
        ),
      },
      png: {
        count: Math.max(base.formatStats.png.count, incoming.formatStats.png.count),
        totalSavedBytes: Math.max(
          base.formatStats.png.totalSavedBytes,
          incoming.formatStats.png.totalSavedBytes,
        ),
      },
      webp: {
        count: Math.max(base.formatStats.webp.count, incoming.formatStats.webp.count),
        totalSavedBytes: Math.max(
          base.formatStats.webp.totalSavedBytes,
          incoming.formatStats.webp.totalSavedBytes,
        ),
      },
      avif: {
        count: Math.max(base.formatStats.avif.count, incoming.formatStats.avif.count),
        totalSavedBytes: Math.max(
          base.formatStats.avif.totalSavedBytes,
          incoming.formatStats.avif.totalSavedBytes,
        ),
      },
    },
    updatedAt: new Date(
      Math.max(Date.parse(base.updatedAt) || 0, Date.parse(incoming.updatedAt) || 0),
    ).toISOString(),
  };
}

function getClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function isDevApiHost(request: Request) {
  return new URL(request.url).hostname === "api-dev.picbind.com";
}

function isLocalApiHost(request: Request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function allowedOrigins(env: Env, request: Request) {
  const values = new Set(
    (env.ALLOWED_ORIGINS || env.SITE_URL || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (env.ROOM_URL) {
    try {
      values.add(new URL(env.ROOM_URL).origin);
    } catch {
      // Invalid configuration remains excluded from CORS.
    }
  }
  values.add(new URL(request.url).origin);
  return values;
}

function corsHeaders(env: Env, request: Request) {
  if (isDevApiHost(request) || isLocalApiHost(request)) {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-admin-key",
      "access-control-expose-headers": "x-picbind-dev-mode",
      "access-control-max-age": "86400",
    };
  }

  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-key",
    "access-control-expose-headers": "x-picbind-dev-mode",
    "access-control-max-age": "86400",
  };
  if (origin && allowedOrigins(env, request).has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function withCors(response: Response, env: Env, request: Request) {
  if (response.status === 101) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("x-picbind-dev-mode", isDevMode(env) ? "1" : "0");
  for (const [key, value] of Object.entries(corsHeaders(env, request))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function hasMissingOrInvalidOrigin(env: Env, request: Request) {
  if (isDevApiHost(request) || isLocalApiHost(request)) {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  return !allowedOrigins(env, request).has(origin);
}

function getAdminKey(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("key") || request.headers.get("x-admin-key") || "";
}

function assertAdmin(env: Env, request: Request) {
  if (isDevApiHost(request)) {
    return true;
  }
  const expectedKey = (env.ADMIN_KEY || "").trim();
  const requestKey = getAdminKey(request).trim();
  return Boolean(expectedKey && requestKey && requestKey === expectedKey);
}

function buildLimiterIdentity(request: Request) {
  const ip = getClientIp(request);
  const key = getAdminKey(request).trim();
  return `${ip}:${key || "public"}`;
}

async function checkLimiter(
  env: Env,
  limiter: Env["GLOBAL_LIMITER"] | Env["ROUTE_LIMITER"] | undefined,
  key: string,
) {
  if (!limiter) {
    return true;
  }
  try {
    const result = await limiter.limit({ key });
    return result.success;
  } catch (error) {
    devError(env, "Rate limiter check failed:", error);
    return true;
  }
}

function getCounterStub(env: Env) {
  const id = env.METRICS_COUNTER.idFromName(COUNTER_INSTANCE_NAME);
  return env.METRICS_COUNTER.get(id);
}

async function counterFetch<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const stub = getCounterStub(env);
  const response = await stub.fetch(`https://metrics-counter${path}`, init);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) {
    const reason = payload?.error || `Counter request failed with ${response.status}`;
    throw new Error(reason);
  }
  return payload;
}

async function readCounterState(env: Env) {
  try {
    const state = await counterFetch<MetricsCounterState>(env, "/state", {
      method: "GET",
    });
    return normalizeCounterState(state);
  } catch (error) {
    devError(env, "Read counter state failed:", error);
    return createInitialCounterState();
  }
}

async function handleMetrics(request: Request, env: Env) {
  if (request.method === "GET") {
    const [summary, config] = await Promise.all([
      readCounterSummaryFromKv(env),
      readConfig(env),
    ]);
    let counter = summary ?? createInitialCounterState();
    const summaryLooksEmpty =
      !summary ||
      (summary.totalCompressed === 0 &&
        summary.totalViews === 0 &&
        summary.totalSavedBytes === 0);
    const summaryAgeMs =
      summary?.updatedAt ? Date.now() - (Date.parse(summary.updatedAt) || 0) : Infinity;
    const summaryStale = summaryAgeMs > 65_000;

    if (summaryLooksEmpty || summaryStale) {
      const live = await readCounterState(env);
      counter = mergeCounterState(counter, live);
    }

    const shouldRepairSummary =
      !summary ||
      counter.totalCompressed > summary.totalCompressed ||
      counter.totalViews > summary.totalViews ||
      counter.totalSavedBytes > summary.totalSavedBytes;

    if (shouldRepairSummary) {
      // Warm/repair summary cache when empty/stale.
      await env.METRICS_KV.put(METRICS_SUMMARY_KEY, JSON.stringify(counter));
    }

    return json(publicMetrics(counter, config));
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (hasMissingOrInvalidOrigin(env, request)) {
    return json({ error: "Invalid origin" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    delta?: number;
    events?: Array<{ format?: CompressionFormat; savedBytes?: number }>;
  };

  try {
    const counter = normalizeCounterState(
      await counterFetch<MetricsCounterState>(env, "/metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const config = await readConfig(env);
    return json(publicMetrics(counter, config));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid metrics payload";
    const status = message.toLowerCase().includes("invalid") ? 400 : 500;
    return json({ error: message }, { status });
  }
}

async function handlePageView(request: Request, env: Env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (hasMissingOrInvalidOrigin(env, request)) {
    return json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    const counter = normalizeCounterState(
      await counterFetch<MetricsCounterState>(env, "/view", {
        method: "POST",
      }),
    );
    return json({ totalViews: counter.totalViews });
  } catch (error) {
    devError(env, "Page view counter failed:", error);
    return json({ error: "Failed to update page view" }, { status: 500 });
  }
}

async function handleAdminState(request: Request, env: Env) {
  if (!assertAdmin(env, request)) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (url.searchParams.get("sync") === "1") {
      await counterFetch<MetricsCounterState>(env, "/sync-summary", {
        method: "POST",
      });
    }
    const [counter, config] = await Promise.all([
      readCounterState(env),
      readConfig(env),
    ]);
    return json({ ...counter, ...config });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    showCompressedCount?: boolean;
  };
  const config = await readConfig(env);
  if (typeof body.showCompressedCount === "boolean") {
    config.showCompressedCount = body.showCompressedCount;
  }
  config.updatedAt = new Date().toISOString();
  await writeConfig(env, config);

  const counter = await readCounterState(env);
  return json({ ...counter, ...config });
}

function configuredSite(env: Env) {
  return (env.BAIDU_PUSH_SITE || env.SITE_URL || "").trim().replace(/\/+$/, "");
}

async function handleBaiduPush(request: Request, env: Env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!assertAdmin(env, request)) {
    return json({ error: "Not found" }, { status: 404 });
  }
  const site = configuredSite(env);
  const token = (env.BAIDU_PUSH_TOKEN || "").trim();
  if (!site || !token) {
    return json({ error: "Baidu push is not configured" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { urls?: string[] };
  const urls = Array.from(
    new Set((body.urls?.length ? body.urls : [`${site}/`]).map((url) => String(url).trim())),
  ).filter((url) => url.startsWith(`${site}/`) || url === site);

  if (!urls.length) {
    return json({ error: "No valid URLs to push" }, { status: 400 });
  }

  const endpoint = `${BAIDU_PUSH_ENDPOINT}?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: urls.join("\n"),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    return json({ error: "Baidu push failed", detail: result }, { status: 502 });
  }
  return json({ site, submitted: urls.length, ...result });
}

const worker = {
  async fetch(request: Request, env: Env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env, request),
      });
    }

    const { pathname } = new URL(request.url);
    const limiterIdentity = buildLimiterIdentity(request);
    const globalRateKey = `global:${limiterIdentity}`;
    const routeRateKey = `route:${limiterIdentity}:${pathname}`;

    const globalAllowed = await checkLimiter(env, env.GLOBAL_LIMITER, globalRateKey);
    if (!globalAllowed) {
      return withCors(
        json({ error: "Too many requests (global limiter)" }, { status: 429 }),
        env,
        request,
      );
    }

    const routeAllowed = await checkLimiter(env, env.ROUTE_LIMITER, routeRateKey);
    if (!routeAllowed) {
      return withCors(
        json({ error: "Too many requests (route limiter)" }, { status: 429 }),
        env,
        request,
      );
    }

    try {
      let response: Response;

      if (pathname === "/api/metrics") {
        response = await handleMetrics(request, env);
      } else if (pathname === "/api/site/view") {
        response = await handlePageView(request, env);
      } else if (pathname === "/api/admin/state") {
        response = await handleAdminState(request, env);
      } else if (pathname === "/api/seo/baidu/push") {
        response = await handleBaiduPush(request, env);
      } else if (pathname === "/api/realtime/room/create") {
        response = hasMissingOrInvalidOrigin(env, request)
          ? json({ error: "Invalid origin" }, { status: 403 })
          : await handleCreateShareRoom(request, env);
      } else if (pathname.startsWith("/api/realtime/room/")) {
        response = hasMissingOrInvalidOrigin(env, request)
          ? json({ error: "Invalid origin" }, { status: 403 })
          : pathname === "/api/realtime/room/socket"
            ? await handleShareRoomSocket(request, env)
            : await handleShareRoomRealtime(request, env);
      } else {
        response = json({ error: "Not found" }, { status: 404 });
      }

      return withCors(response, env, request);
    } catch (error) {
      devError(env, "Worker request failed:", error);
      return withCors(
        json({ error: "Internal error" }, { status: 500 }),
        env,
        request,
      );
    }
  },
};

export default worker;
export { MetricsCounter, ShareRoomObject };
