export type TurnCredentialEnv = {
  LOCAL_RUNTIME?: string;
  TURN_TOKEN_ID?: string;
  TURN_API_TOKEN?: string;
};

const FALLBACK_STUN_SERVERS: RTCIceServer[] = [{
  urls: ["stun:stun.cloudflare.com:3478"],
}];
const MAXIMUM_ICE_URLS = 4;

function iceUrlPriority(url: string) {
  const normalized = url.toLowerCase();
  if (normalized.startsWith("stun:")) return 0;
  if (normalized.startsWith("turn:") && normalized.includes("transport=udp")) return 1;
  if (normalized.startsWith("turns:") && normalized.includes(":443")) return 2;
  if (normalized.startsWith("turn:") && normalized.includes("transport=tcp")) return 3;
  if (normalized.startsWith("turns:")) return 4;
  return 5;
}

export function normalizeTurnIceServers(servers: RTCIceServer[]) {
  const seen = new Set<string>();
  return servers
    .flatMap((server, serverIndex) => {
      const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
      return urls.flatMap((url, urlIndex) => {
        const normalized = typeof url === "string" ? url.trim() : "";
        if (!normalized || seen.has(normalized)) return [];
        seen.add(normalized);
        return [{ server, url: normalized, order: serverIndex * 100 + urlIndex }];
      });
    })
    .sort((left, right) => iceUrlPriority(left.url) - iceUrlPriority(right.url)
      || left.order - right.order)
    .slice(0, MAXIMUM_ICE_URLS)
    .map(({ server, url }) => ({ ...server, urls: [url] }));
}

async function readJson<T>(response: Response, label: string) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} is not valid JSON: ${raw.slice(0, 240)}`);
  }
}

export async function generateTurnIceServers(env: TurnCredentialEnv) {
  if (env.LOCAL_RUNTIME?.trim() === "1") {
    return [];
  }
  if (!env.TURN_TOKEN_ID?.trim() || !env.TURN_API_TOKEN?.trim()) {
    return FALLBACK_STUN_SERVERS;
  }
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_TOKEN_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.TURN_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    const result = await readJson<{ iceServers?: RTCIceServer[] }>(
      response,
      `Cloudflare TURN credentials (${response.status})`,
    );
    if (response.ok && Array.isArray(result.iceServers) && result.iceServers.length > 0) {
      const iceServers = normalizeTurnIceServers(result.iceServers);
      if (iceServers.length > 0) return iceServers;
    }
  } catch {
    // STUN keeps direct peers available while temporary TURN issuance is unavailable.
  }
  return FALLBACK_STUN_SERVERS;
}
