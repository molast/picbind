import { NextRequest, NextResponse } from "next/server";
import {
  getAdminDashboardState,
  updateUiConfig,
} from "@/server/metrics-store";
import {
  getAdminKeyFromRequest,
  isAdminConfigured,
  isAdminKeyValid,
} from "@/server/admin-auth";

export const runtime = "nodejs";

function createNotFoundResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function assertAuthorized(request: NextRequest) {
  if (!isAdminConfigured()) {
    return createNotFoundResponse();
  }

  if (!isAdminKeyValid(getAdminKeyFromRequest(request))) {
    return createNotFoundResponse();
  }

  return null;
}

export async function GET(request: NextRequest) {
  const unauthorized = assertAuthorized(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const state = await getAdminDashboardState();
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to load admin state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = assertAuthorized(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as {
      showCompressedCount?: boolean;
      showCompareSection?: boolean;
    };

    const state = await updateUiConfig({
      showCompressedCount:
        typeof body.showCompressedCount === "boolean"
          ? body.showCompressedCount
          : undefined,
      showCompareSection:
        typeof body.showCompareSection === "boolean"
          ? body.showCompareSection
          : undefined,
    });

    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to update admin state: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
