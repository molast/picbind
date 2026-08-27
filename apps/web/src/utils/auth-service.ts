import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.picbind.com")
  .replace(/\/+$/, "");
const AUTH_CACHE_KEY = "picbind:auth-cache:v1";
const AVATAR_CACHE_KEY = "picbind:auth-avatar-cache:v1";
const LAST_PROVIDER_KEY = "picbind:last-oauth-provider";
const DESKTOP_OAUTH_EVENT = "picbind:auth-deep-link";
const DESKTOP_OAUTH_TIMEOUT_MS = 10 * 60 * 1000;

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

type DesktopOAuthObserver = {
  authenticated(state: AuthState): void;
  failed(error: AuthServiceError): void;
};

type DesktopOAuthWaiter = {
  resolve(state: AuthState): void;
  reject(error: AuthServiceError): void;
  timeout: ReturnType<typeof setTimeout>;
};

const desktopOAuthObservers = new Set<DesktopOAuthObserver>();
let desktopOAuthReady: Promise<void> | null = null;
let desktopOAuthWaiter: DesktopOAuthWaiter | null = null;
let desktopOAuthCallback: { url: string; result: Promise<AuthState> } | null = null;

function settleDesktopOAuth(state: AuthState | null, error: AuthServiceError | null) {
  const waiter = desktopOAuthWaiter;
  desktopOAuthWaiter = null;
  if (waiter) {
    clearTimeout(waiter.timeout);
    if (state) waiter.resolve(state);
    else waiter.reject(error || new AuthServiceError("oauth_failed"));
  }
  for (const observer of desktopOAuthObservers) {
    if (state) observer.authenticated(state);
    else observer.failed(error || new AuthServiceError("oauth_failed"));
  }
}

function completeDesktopOAuth(url: string) {
  if (desktopOAuthCallback?.url === url) return desktopOAuthCallback.result;
  const result = invoke<AuthState>("desktop_auth_exchange", { callbackUrl: url })
    .then((value) => {
      const state = normalizeState(value);
      writeCache(state);
      settleDesktopOAuth(state, null);
      return state;
    })
    .catch((error: unknown) => {
      const normalized = tauriError(error);
      settleDesktopOAuth(null, normalized);
      throw normalized;
    });
  desktopOAuthCallback = { url, result };
  void result.finally(() => {
    if (desktopOAuthCallback?.result === result) desktopOAuthCallback = null;
  }).catch(() => {});
  return result;
}

async function ensureDesktopOAuthListener() {
  if (!desktopOAuthReady) {
    desktopOAuthReady = listen<string>(DESKTOP_OAUTH_EVENT, (event) => {
      void invoke<string | null>("desktop_auth_take_deep_link").catch(() => null);
      void completeDesktopOAuth(event.payload).catch(() => {});
    }).then(() => undefined);
  }
  await desktopOAuthReady;
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
      await ensureDesktopOAuthListener();
      const callback = await invoke<string | null>("desktop_auth_take_deep_link")
        .catch(() => null);
      return callback
        ? await completeDesktopOAuth(callback)
        : readCache() || anonymousAuthState();
    }
    const url = new URL(window.location.href);
    const result = url.searchParams.get("auth_result");
    const code = url.searchParams.get("auth_code");
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
      await ensureDesktopOAuthListener();
      await invoke<string | null>("desktop_auth_take_deep_link").catch(() => null);
      if (desktopOAuthWaiter) {
        clearTimeout(desktopOAuthWaiter.timeout);
        desktopOAuthWaiter.reject(new AuthServiceError(
          "oauth_cancelled",
          "A newer OAuth login replaced this request",
        ));
      }
      const state = new Promise<AuthState>((resolve, reject) => {
        desktopOAuthWaiter = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            if (!desktopOAuthWaiter) return;
            desktopOAuthWaiter = null;
            reject(new AuthServiceError("oauth_cancelled", "OAuth login timed out"));
          }, DESKTOP_OAUTH_TIMEOUT_MS),
        };
      });
      try {
        await invoke<void>("desktop_auth_oauth", { provider });
      } catch (error) {
        const normalized = tauriError(error);
        settleDesktopOAuth(null, normalized);
        return await state;
      }
      return await state;
    }
    const returnTo = new URL(window.location.href);
    returnTo.searchParams.delete("auth_result");
    returnTo.searchParams.delete("auth_code");
    const destination = new URL(`${API_BASE}/api/auth/oauth/${provider}/start`);
    destination.searchParams.set("return_to", returnTo.href);
    window.location.assign(destination.href);
    return new Promise<AuthState>(() => {});
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
  observeDesktopOAuth(observer: DesktopOAuthObserver) {
    desktopOAuthObservers.add(observer);
    return () => desktopOAuthObservers.delete(observer);
  },
};
