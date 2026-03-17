import { NextRequest, NextResponse } from "next/server";
import { incrementPageViewCount } from "@/server/metrics-store";

export const runtime = "nodejs";

function hasInvalidOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    const originHost = new URL(origin).host;
    const requestHost = request.nextUrl.host;
    
    // Allow requests from the same domain or www subdomain
    const normalizedOriginHost = originHost.replace(/^www\./, '');
    const normalizedRequestHost = requestHost.replace(/^www\./, '');
    
    return normalizedOriginHost !== normalizedRequestHost;
  } catch {
    return true;
  }
}

export async function POST(request: NextRequest) {
  if (hasInvalidOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  try {
    const totalViews = await incrementPageViewCount(1);
    return NextResponse.json({ totalViews }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to record page view: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
