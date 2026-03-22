import { getSiteUrl } from "@/server/site-config";

const BAIDU_PUSH_ENDPOINT = "http://data.zz.baidu.com/urls";

type BaiduPushResponse = {
  remain?: number;
  success?: number;
  not_same_site?: string[];
  not_valid?: string[];
  error?: number;
  message?: string;
};

function normalizeUrl(input: string) {
  return input.trim();
}

function dedupeUrls(urls: string[]) {
  return Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)));
}

function getConfiguredSite() {
  return (process.env.BAIDU_PUSH_SITE || getSiteUrl()).trim().replace(/\/+$/, "");
}

function getConfiguredToken() {
  return (process.env.BAIDU_PUSH_TOKEN || "").trim();
}

function isAllowedSiteUrl(candidate: string, site: string) {
  try {
    const candidateUrl = new URL(candidate);
    const siteUrl = new URL(site);
    return (
      candidateUrl.protocol === siteUrl.protocol &&
      candidateUrl.hostname === siteUrl.hostname
    );
  } catch {
    return false;
  }
}

export function isBaiduPushConfigured() {
  return Boolean(getConfiguredSite() && getConfiguredToken());
}

export function getDefaultPushUrls() {
  const site = getConfiguredSite();
  return [`${site}/`];
}

export function sanitizeBaiduPushUrls(urls: string[]) {
  const site = getConfiguredSite();
  return dedupeUrls(urls).filter((url) => isAllowedSiteUrl(url, site));
}

export async function pushUrlsToBaidu(inputUrls: string[]) {
  const site = getConfiguredSite();
  const token = getConfiguredToken();
  if (!token) {
    throw new Error("BAIDU_PUSH_TOKEN is not configured");
  }

  const urls = sanitizeBaiduPushUrls(inputUrls);
  if (!urls.length) {
    throw new Error("No valid URLs to push");
  }

  const endpoint = `${BAIDU_PUSH_ENDPOINT}?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: urls.join("\n"),
    cache: "no-store",
  });

  let payload: BaiduPushResponse | null = null;
  try {
    payload = (await response.json()) as BaiduPushResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.message
        ? `Baidu push failed: ${payload.message}`
        : `Baidu push failed with status ${response.status}`,
    );
  }

  if (payload?.error) {
    throw new Error(payload.message || `Baidu push error code: ${payload.error}`);
  }

  return {
    site,
    endpoint: BAIDU_PUSH_ENDPOINT,
    submitted: urls.length,
    remain: payload?.remain ?? null,
    success: payload?.success ?? null,
    notSameSite: payload?.not_same_site ?? [],
    notValid: payload?.not_valid ?? [],
  };
}

