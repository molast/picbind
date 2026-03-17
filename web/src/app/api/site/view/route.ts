import { NextRequest, NextResponse } from "next/server";
import { incrementPageViewCount } from "@/server/metrics-store";
import { getSiteUrl } from "@/server/site-config";

export const runtime = "nodejs";

function hasInvalidOrigin(request: NextRequest) {
  // Temporarily disable origin check for debugging
  return false;
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
