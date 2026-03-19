import { NextRequest, NextResponse } from "next/server";
import { incrementPageViewCount } from "@/server/metrics-store";
import { hasInvalidOrigin } from "@/server/origin-check";

export const runtime = "nodejs";

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
