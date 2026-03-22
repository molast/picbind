import { NextRequest, NextResponse } from "next/server";
import {
  getAdminKeyFromRequest,
  isAdminConfigured,
  isAdminKeyValid,
} from "@/server/admin-auth";
import {
  getDefaultPushUrls,
  isBaiduPushConfigured,
  pushUrlsToBaidu,
} from "@/server/baidu-push";

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

export async function POST(request: NextRequest) {
  const unauthorized = assertAuthorized(request);
  if (unauthorized) {
    return unauthorized;
  }

  if (!isBaiduPushConfigured()) {
    return NextResponse.json(
      { error: "Baidu push is not configured" },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      urls?: string[];
    };

    const inputUrls =
      Array.isArray(body.urls) && body.urls.length
        ? body.urls.map((value) => String(value))
        : getDefaultPushUrls();

    const result = await pushUrlsToBaidu(inputUrls);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to push URLs to Baidu: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}

