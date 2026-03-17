import { NextRequest, NextResponse } from "next/server";
import { incrementPageViewCount } from "@/server/metrics-store";
import { getSiteUrl } from "@/server/site-config";

export const runtime = "nodejs";

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
