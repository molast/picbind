const DEFAULT_SITE_URL = "https://molast.com";

export function getSiteUrl() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    DEFAULT_SITE_URL;

  return raw.replace(/\/+$/, "");
}

export function toAbsoluteUrl(pathname = "/") {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getSiteUrl()}${normalizedPath}`;
}
