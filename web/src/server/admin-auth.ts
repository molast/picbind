import { NextRequest } from "next/server";

const ADMIN_KEY_ENV = "NANOIMG_ADMIN_KEY";

export function getConfiguredAdminKey() {
  return process.env[ADMIN_KEY_ENV]?.trim() || "";
}

export function isAdminKeyValid(key?: string | null) {
  const configuredKey = getConfiguredAdminKey();
  return Boolean(configuredKey && key && key === configuredKey);
}

export function getAdminKeyFromRequest(request: NextRequest) {
  return (
    request.nextUrl.searchParams.get("key") ||
    request.headers.get("x-admin-key") ||
    null
  );
}

export function isAdminConfigured() {
  return Boolean(getConfiguredAdminKey());
}
