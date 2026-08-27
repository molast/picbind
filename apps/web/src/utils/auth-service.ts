import { invoke, isTauri } from "@tauri-apps/api/core";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.picbind.com")
  .replace(/\/+$/, "");
const AUTH_CACHE_KEY = "picbind:auth-cache:v1";
const AVATAR_CACHE_KEY = "picbind:auth-avatar-cache:v1";
const LAST_PROVIDER_KEY = "picbind:last-oauth-provider";
const OAUTH_TIMEOUT_MS = 10 * 60 * 1000;
const WEB_OAUTH_CALLBACK_PATH = "/auth-callback.html";
const WEB_OAUTH_CHANNEL_PREFIX = "picbind:oauth:";
const WEB_OAUTH_WINDOW_PREFIX = "picbind-oauth:";
const WEB_OAUTH_MESSAGE_TYPE = "picbind:oauth-callback";

export type OAuthProvider = "google" | "github";

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthWorkspace = {
  id: string;
  shareId: string;
  name: string;
  ownerCapability: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthState = {
  authenticated: boolean;
  user: AuthUser | null;
  workspaces: AuthWorkspace[];
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

export class AuthServiceError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message || code);
  }
}

export const anonymousAuthState = (): AuthState => ({
  authenticated: false,
  user: null,
  workspaces: [],
});

export async function resolveAuthAvatar(avatar: string | null) {
  if (!avatar) return null;
  if (!isTauri()) return avatar;
  try {
    if (new URL(avatar).hostname === "api.picbind.com") return avatar;
  } catch {}
  try {
    const cached = JSON.parse(localStorage.getItem(AVATAR_CACHE_KEY) || "null") as {
      source?: string;
      dataUrl?: string;
    } | null;
    if (cached?.source === avatar && cached.dataUrl?.startsWith("data:image/")) {
      return cached.dataUrl;
    }
  } catch {}
  try {
    const dataUrl = await invoke<string>("desktop_auth_avatar_data_url", { url: avatar });
    try {
      localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({ source: avatar, dataUrl }));
    } catch {}
    return dataUrl;
  } catch {
    // The native HTTP client may not share the browser's system proxy.
    // A regular image request remains safe here and does not require CORS.
    return avatar;
  }
}

function normalizeState(value: Partial<AuthState> | null | undefined): AuthState {
  return value?.authenticated && value.user
    ? {
        authenticated: true,
        user: value.user,
        workspaces: Array.isArray(value.workspaces) ? value.workspaces : [],
      }
    : anonymousAuthState();
}

function readCache(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    return raw ? normalizeState(JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

function writeCache(state: AuthState) {
  try {
    localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(state));
  } catch {}
}

async function webRequest(path: string, method = "GET", body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new AuthServiceError("network_error", String(error));
  }
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<AuthState> | null;
  if (!response.ok || !payload?.data) {
    throw new AuthServiceError(
      payload?.error?.code || "invalid_response",
      payload?.error?.message || `Authentication returned ${response.status}`,
    );
  }
  return normalizeState(payload.data);
}

function tauriError(error: unknown) {
  const raw = String(error);
  const separator = raw.indexOf(":");
  return new AuthServiceError(
    separator > 0 ? raw.slice(0, separator) : "oauth_failed",
    separator > 0 ? raw.slice(separator + 1) : raw,
  );
}

type WebOAuthCallback = {
  type: typeof WEB_OAUTH_MESSAGE_TYPE;
  result: string;
  code: string | null;
};

function webOAuthRequestIdFromWindow() {
  return window.name.startsWith(WEB_OAUTH_WINDOW_PREFIX)
    ? window.name.slice(WEB_OAUTH_WINDOW_PREFIX.length)
    : null;
}

function validWebOAuthRequestId(value: string | null) {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function relayWebOAuthCallback(url: URL) {
  const requestId = webOAuthRequestIdFromWindow();
  const result = url.searchParams.get("auth_result");
  if (!validWebOAuthRequestId(requestId) || !result) return false;
  const channel = new BroadcastChannel(`${WEB_OAUTH_CHANNEL_PREFIX}${requestId}`);
  channel.postMessage({
    type: WEB_OAUTH_MESSAGE_TYPE,
    result,
    code: url.searchParams.get("auth_code"),
  } satisfies WebOAuthCallback);
  url.searchParams.delete("auth_result");
  url.searchParams.delete("auth_code");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.setTimeout(() => {
    channel.close();
    window.close();
  }, 100);
  return true;
}

function webOAuth(provider: OAuthProvider) {
  if (typeof BroadcastChannel === "undefined") {
    throw new AuthServiceError("oauth_unavailable", "OAuth popups are not supported");
  }
  const requestId = crypto.randomUUID();
  const channel = new BroadcastChannel(`${WEB_OAUTH_CHANNEL_PREFIX}${requestId}`);
  const returnTo = new URL(WEB_OAUTH_CALLBACK_PATH, window.location.origin);
  returnTo.searchParams.set("request_id", requestId);
  const destination = new URL(`${API_BASE}/api/auth/oauth/${provider}/start`);
  destination.searchParams.set("return_to", returnTo.href);

  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(
    "about:blank",
    `${WEB_OAUTH_WINDOW_PREFIX}${requestId}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!popup) {
    channel.close();
    throw new AuthServiceError("oauth_popup_blocked", "OAuth popup was blocked");
  }
  try {
    popup.opener = null;
  } catch {}

  return new Promise<AuthState>((resolve, reject) => {
    let exchanging = false;
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      channel.close();
    };
    const fail = (error: AuthServiceError) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        popup.close();
      } catch {}
      reject(error);
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (settled || exchanging || !event.data || typeof event.data !== "object") return;
      const callback = event.data as Partial<WebOAuthCallback>;
      if (callback.type !== WEB_OAUTH_MESSAGE_TYPE || typeof callback.result !== "string") return;
      if (callback.result !== "success") {
        fail(new AuthServiceError(
          callback.result.replace(/^error:/, "") || "oauth_failed",
        ));
        return;
      }
      if (typeof callback.code !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(callback.code)) {
        fail(new AuthServiceError("oauth_invalid_state", "OAuth callback did not include a valid code"));
        return;
      }
      exchanging = true;
      try {
        popup.close();
      } catch {}
      void webRequest("auth/exchange", "POST", { code: callback.code })
        .then((state) => {
          if (settled) return;
          settled = true;
          cleanup();
          writeCache(state);
          resolve(state);
        })
        .catch((error) => fail(error instanceof AuthServiceError
          ? error
          : new AuthServiceError("oauth_failed", String(error))));
    };
    const timeout = window.setTimeout(() => {
      fail(new AuthServiceError("oauth_cancelled", "OAuth login timed out"));
    }, OAUTH_TIMEOUT_MS);
    popup.location.replace(destination.href);
  });
}

export const authService = {
  cachedState: readCache,
  cacheState: writeCache,
  lastProvider(): OAuthProvider | null {
    try {
      const value = localStorage.getItem(LAST_PROVIDER_KEY);
      return value === "google" || value === "github" ? value : null;
    } catch {
      return null;
    }
  },
  rememberProvider(provider: OAuthProvider) {
    try {
      localStorage.setItem(LAST_PROVIDER_KEY, provider);
    } catch {}
  },
  clearProvider() {
    try {
      localStorage.removeItem(LAST_PROVIDER_KEY);
    } catch {}
  },
  async restore() {
    if (isTauri()) {
      return readCache() || anonymousAuthState();
    }
    const url = new URL(window.location.href);
    const result = url.searchParams.get("auth_result");
    const code = url.searchParams.get("auth_code");
    if (result && relayWebOAuthCallback(url)) {
      return readCache() || anonymousAuthState();
    }
    if (result) {
      url.searchParams.delete("auth_result");
      url.searchParams.delete("auth_code");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      if (result !== "success" || !code) {
        throw new AuthServiceError(result.replace(/^error:/, "") || "oauth_failed");
      }
      const state = await webRequest("auth/exchange", "POST", { code });
      writeCache(state);
      return state;
    }
    try {
      const state = await webRequest("auth/session");
      const cached = readCache();
      if (!state.authenticated && cached?.authenticated) return cached;
      writeCache(state);
      return state;
    } catch {
      return readCache() || anonymousAuthState();
    }
  },
  async login(email: string, password: string) {
    const state = isTauri()
      ? await invoke<AuthState>("desktop_auth_login", { email, password }).catch((error) => {
          throw tauriError(error);
        })
      : await webRequest("auth/login", "POST", { email, password });
    writeCache(state);
    authService.clearProvider();
    return state;
  },
  async register(name: string, email: string, password: string) {
    const state = isTauri()
      ? await invoke<AuthState>("desktop_auth_register", { name, email, password }).catch((error) => {
          throw tauriError(error);
        })
      : await webRequest("auth/register", "POST", { name, email, password });
    writeCache(state);
    authService.clearProvider();
    return state;
  },
  async oauth(provider: OAuthProvider) {
    this.rememberProvider(provider);
    if (isTauri()) {
      const state = await invoke<AuthState>("desktop_auth_oauth", { provider }).catch((error) => {
        throw tauriError(error);
      });
      const normalized = normalizeState(state);
      writeCache(normalized);
      return normalized;
    }
    return await webOAuth(provider);
  },
  async logout() {
    if (!isTauri()) {
      try {
        await webRequest("auth/logout", "POST");
      } catch {}
    }
    const state = anonymousAuthState();
    writeCache(state);
    try {
      localStorage.removeItem(AVATAR_CACHE_KEY);
    } catch {}
    return state;
  },
};
