import { NextRequest } from "next/server";
import { getSiteUrl } from "@/server/site-config";

function normalizeHost(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function hostFromHeader(value: string | null) {
  if (!value) {
    return null;
  }

  const host = value.split(",")[0]?.trim();
  if (!host) {
    return null;
  }

  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export function hasInvalidOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    const originHost = normalizeHost(new URL(origin).hostname);
    const allowedHosts = new Set<string>();

    const configuredSiteHost = normalizeHost(new URL(getSiteUrl()).hostname);
    allowedHosts.add(configuredSiteHost);

    const requestHost =
      hostFromHeader(request.headers.get("x-forwarded-host")) ||
      hostFromHeader(request.headers.get("host"));
    if (requestHost) {
      allowedHosts.add(normalizeHost(requestHost));
    }

    if (process.env.NODE_ENV !== "production") {
      allowedHosts.add("localhost");
      allowedHosts.add("127.0.0.1");
      allowedHosts.add("::1");
      allowedHosts.add("[::1]");
    }

    return !allowedHosts.has(originHost);
  } catch (error) {
    console.error("Error in hasInvalidOrigin:", error);
    return true;
  }
}

