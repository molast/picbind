import { NextRequest, NextResponse } from "next/server";
import { getTotalCompressedCount, incrementCompressedCount } from "@/server/metrics-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const totalCompressed = await getTotalCompressedCount();
    return NextResponse.json({ totalCompressed }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read metrics: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { delta?: number };
    const delta = Number(body.delta ?? 0);
    if (!Number.isFinite(delta) || delta <= 0) {
      return NextResponse.json({ error: "Invalid delta" }, { status: 400 });
    }

    const totalCompressed = await incrementCompressedCount(Math.floor(delta));
    return NextResponse.json({ totalCompressed }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to update metrics: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
