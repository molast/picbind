type CompressionFormat = "jpeg" | "png" | "webp" | "avif";

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

type Env = {
  METRICS_KV: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  GLOBAL_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  ROUTE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  ADMIN_KEY?: string;
  SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  BAIDU_PUSH_SITE?: string;
  BAIDU_PUSH_TOKEN?: string;
};

const METRICS_KEY = "metrics:v1";
const BAIDU_PUSH_ENDPOINT = "http://data.zz.baidu.com/urls";
const DELTA_MAX = 20;
const EVENT_BATCH_MAX = 50;

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
  };
}

function createInitialPayload(): MetricsPayload {
  return {
    totalCompressed: 0,
    totalViews: 0,
    totalSavedBytes: 0,
    formatStats: createInitialFormatStats(),
    showCompressedCount: false,
    showCompareSection: false,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizePayload(input: Partial<MetricsPayload> | null): MetricsPayload {
  const initial = createInitialPayload();
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
    showCompressedCount:
      typeof input?.showCompressedCount === "boolean"
        ? input.showCompressedCount
        : false,
    showCompareSection:
      typeof input?.showCompareSection === "boolean"
        ? input.showCompareSection
        : false,
    updatedAt: input?.updatedAt || initial.updatedAt,
  };
}

async function readState(env: Env) {
  const raw = await env.METRICS_KV.get(METRICS_KEY);
  if (!raw) {
    return createInitialPayload();
  }
  try {
    return normalizePayload(JSON.parse(raw) as Partial<MetricsPayload>);
  } catch {
    return createInitialPayload();
  }
}

async function writeState(env: Env, state: MetricsPayload) {
  await env.METRICS_KV.put(METRICS_KEY, JSON.stringify(state));
}

function publicMetrics(state: MetricsPayload) {
  return {
    totalCompressed: state.totalCompressed,
    totalSavedBytes: state.totalSavedBytes,
    formatStats: state.formatStats,
    showCompressedCount: state.showCompressedCount,
    showCompareSection: state.showCompareSection,
  };
}

function getClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function allowedOrigins(env: Env, request: Request) {
  const values = new Set(
    (env.ALLOWED_ORIGINS || env.SITE_URL || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(new URL(request.url).origin);
  return values;
}

function corsHeaders(env: Env, request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-key",
    "access-control-max-age": "86400",
  };
  if (origin && allowedOrigins(env, request).has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function withCors(response: Response, env: Env, request: Request) {
  const headers = new Headers(response.headers);
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
    console.error("Rate limiter check failed:", error);
    return true;
  }
}

async function handleMetrics(request: Request, env: Env) {
  if (request.method === "GET") {
    return json(publicMetrics(await readState(env)));
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
  const state = await readState(env);

  if (Array.isArray(body.events)) {
    if (!body.events.length || body.events.length > EVENT_BATCH_MAX) {
      return json({ error: "Invalid events" }, { status: 400 });
    }

    let totalSavedBytesDelta = 0;
    for (const event of body.events) {
      if (!event.format || !["jpeg", "png", "webp", "avif"].includes(event.format)) {
        continue;
      }
      const savedBytes = Math.round(Number(event.savedBytes || 0));
      state.formatStats[event.format].count += 1;
      state.formatStats[event.format].totalSavedBytes += savedBytes;
      state.totalCompressed += 1;
      totalSavedBytesDelta += savedBytes;
    }
    state.totalSavedBytes += totalSavedBytesDelta;
    state.updatedAt = new Date().toISOString();
    await writeState(env, state);
    return json(publicMetrics(state));
  }

  const delta = Number(body.delta || 0);
  if (!Number.isFinite(delta) || delta <= 0 || delta > DELTA_MAX) {
    return json({ error: "Invalid delta" }, { status: 400 });
  }

  state.totalCompressed += Math.floor(delta);
  state.updatedAt = new Date().toISOString();
  await writeState(env, state);
  return json({ totalCompressed: state.totalCompressed });
}

async function handlePageView(request: Request, env: Env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  if (hasMissingOrInvalidOrigin(env, request)) {
    return json({ error: "Invalid origin" }, { status: 403 });
  }
  const state = await readState(env);
  state.totalViews += 1;
  state.updatedAt = new Date().toISOString();
  await writeState(env, state);
  return json({ totalViews: state.totalViews });
}

async function handleAdminState(request: Request, env: Env) {
  if (!assertAdmin(env, request)) {
    return json({ error: "Not found" }, { status: 404 });
  }

  if (request.method === "GET") {
    return json(await readState(env));
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    showCompressedCount?: boolean;
    showCompareSection?: boolean;
  };
  const state = await readState(env);
  if (typeof body.showCompressedCount === "boolean") {
    state.showCompressedCount = body.showCompressedCount;
  }
  if (typeof body.showCompareSection === "boolean") {
    state.showCompareSection = body.showCompareSection;
  }
  state.updatedAt = new Date().toISOString();
  await writeState(env, state);
  return json(state);
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

export default {
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

    const globalAllowed = await checkLimiter(env.GLOBAL_LIMITER, globalRateKey);
    if (!globalAllowed) {
      return withCors(
        json({ error: "Too many requests (global limiter)" }, { status: 429 }),
        env,
        request,
      );
    }

    const routeAllowed = await checkLimiter(env.ROUTE_LIMITER, routeRateKey);
    if (!routeAllowed) {
      return withCors(
        json({ error: "Too many requests (route limiter)" }, { status: 429 }),
        env,
        request,
      );
    }

    let response: Response;

    if (pathname === "/api/metrics") {
      response = await handleMetrics(request, env);
    } else if (pathname === "/api/site/view") {
      response = await handlePageView(request, env);
    } else if (pathname === "/api/admin/state") {
      response = await handleAdminState(request, env);
    } else if (pathname === "/api/seo/baidu/push") {
      response = await handleBaiduPush(request, env);
    } else {
      response = json({ error: "Not found" }, { status: 404 });
    }

    return withCors(response, env, request);
  },
};
