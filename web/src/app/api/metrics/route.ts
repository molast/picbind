import { NextRequest, NextResponse } from "next/server";
import {
  getAdminDashboardState,
  incrementCompressedCount,
  recordCompressionEvents,
  type CompressionFormat,
} from "@/server/metrics-store";
import { getSiteUrl } from "@/server/site-config";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_POSTS = 30;
const DELTA_MAX = 20;
const EVENT_BATCH_MAX = 50;

const ipBuckets = new Map<string, number[]>();

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(ip: string) {
  const now = Date.now();
  const bucket = ipBuckets.get(ip) || [];
  const next = bucket.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (next.length >= RATE_LIMIT_MAX_POSTS) {
    ipBuckets.set(ip, next);
    return true;
  }
  next.push(now);
  ipBuckets.set(ip, next);
  return false;
}

function hasInvalidOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    const originUrl = new URL(origin);
    const originHostname = originUrl.hostname;
    
    // Get the configured site URL from environment variables
    const siteUrl = getSiteUrl();
    const siteUrlObj = new URL(siteUrl);
    const siteHostname = siteUrlObj.hostname;
    
    // Allow requests from the same domain or www subdomain
    const normalizedOriginHost = originHostname.replace(/^www\./, '');
    const normalizedSiteHost = siteHostname.replace(/^www\./, '');
    
    return normalizedOriginHost !== normalizedSiteHost;
  } catch (error) {
    console.error('Error in hasInvalidOrigin:', error);
    return true;
  }
}

export async function GET() {
  try {
    const state = await getAdminDashboardState();
    return NextResponse.json(
      {
        totalCompressed: state.totalCompressed,
        totalSavedBytes: state.totalSavedBytes,
        formatStats: state.formatStats,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to read metrics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (hasInvalidOrigin(request)) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Invalid content type" }, { status: 415 });
    }

    const clientIp = getClientIp(request);
    if (isRateLimited(clientIp)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await request.json()) as {
      delta?: number;
      events?: Array<{ format?: CompressionFormat; savedBytes?: number }>;
    };

    if (Array.isArray(body.events)) {
      if (!body.events.length || body.events.length > EVENT_BATCH_MAX) {
        return NextResponse.json({ error: "Invalid events" }, { status: 400 });
      }

      const state = await recordCompressionEvents(
        body.events.map((event) => ({
          format: event.format as CompressionFormat,
          savedBytes: Number(event.savedBytes ?? 0),
        })),
      );

      return NextResponse.json(
        {
          totalCompressed: state.totalCompressed,
          totalSavedBytes: state.totalSavedBytes,
          formatStats: state.formatStats,
        },
        { status: 200 },
      );
    }

    const delta = Number(body.delta ?? 0);
    if (!Number.isFinite(delta) || delta <= 0 || delta > DELTA_MAX) {
      return NextResponse.json({ error: "Invalid delta" }, { status: 400 });
    }

    const totalCompressed = await incrementCompressedCount(Math.floor(delta));
    return NextResponse.json({ totalCompressed }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to update metrics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
