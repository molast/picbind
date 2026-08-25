import {
  MAX_SESSIONS_PER_USER,
  type AuthEnv,
  createAuthHandoffStatement,
  createSessionStatement,
  ensureDefaultWorkspace,
  randomToken,
  sessionCookie,
  sha256,
  uuidV7,
} from "./auth";

export type OAuthEnv = AuthEnv & {
  SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  OAUTH_CALLBACK_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

export type OAuthProvider = "google" | "github";

type OAuthStateRow = {
  state_hash: string;
  provider: OAuthProvider;
  return_to: string;
  code_verifier: string;
  expires_at: string;
};

type OAuthIdentityRow = {
  user_id: string;
};

export type OAuthProfile = {
  providerUserId: string;
  name: string;
  avatar: string | null;
};

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function oauthConfig(env: OAuthEnv, provider: OAuthProvider) {
  const clientId = (provider === "google" ? env.GOOGLE_CLIENT_ID : env.GITHUB_CLIENT_ID)?.trim();
  const clientSecret = (provider === "google" ? env.GOOGLE_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function defaultReturnTo(env: OAuthEnv) {
  const value = env.SITE_URL?.trim() || "https://picbind.com";
  try {
    return new URL(value).toString();
  } catch {
    return "https://picbind.com/";
  }
}

function allowedOrigins(env: OAuthEnv) {
  const values = [env.SITE_URL, ...(env.ALLOWED_ORIGINS || "").split(",")];
  const origins = new Set<string>();
  for (const value of values) {
    try {
      if (value?.trim()) origins.add(new URL(value.trim()).origin);
    } catch {
      // Invalid configured origins are ignored instead of widening redirects.
    }
  }
  return origins;
}

export function isDesktopLoopbackReturnTo(url: URL) {
  return url.protocol === "http:"
    && url.hostname === "127.0.0.1"
    && url.port !== ""
    && url.pathname === "/picbind/oauth/callback"
    && !url.username
    && !url.password;
}

function safeReturnTo(env: OAuthEnv, raw: string | null) {
  if (!raw || raw.length > 2048) return defaultReturnTo(env);
  try {
    const url = new URL(raw);
    if (isDesktopLoopbackReturnTo(url)) {
      return url.toString();
    }
    return allowedOrigins(env).has(url.origin) ? url.toString() : defaultReturnTo(env);
  } catch {
    return defaultReturnTo(env);
  }
}

function callbackUrl(request: Request, env: OAuthEnv, provider: OAuthProvider) {
  let origin = new URL(request.url).origin;
  const configured = env.OAUTH_CALLBACK_ORIGIN?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Invalid OAUTH_CALLBACK_ORIGIN protocol");
    }
    origin = url.origin;
  }
  return `${origin}/api/auth/oauth/${provider}/callback`;
}

function redirectToApp(returnTo: string, result: string, cookie?: string, authCode?: string) {
  const destination = new URL(returnTo);
  destination.searchParams.set("auth_result", result);
  if (authCode) destination.searchParams.set("auth_code", authCode);
  const headers = new Headers({
    location: destination.toString(),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function providerAuthorizationUrl(
  provider: OAuthProvider,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
) {
  const url = new URL(provider === "google"
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : "https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", provider === "google" ? "openid profile" : "read:user");
  if (provider === "google") url.searchParams.set("prompt", "select_account");
  return url.toString();
}

async function responseJson(response: Response) {
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== "object") {
    throw new Error(`OAuth provider request failed with status ${response.status}`);
  }
  return value as Record<string, unknown>;
}

async function exchangeGoogle(
  config: { clientId: string; clientSecret: string },
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const token = await responseJson(await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  }));
  if (typeof token.access_token !== "string") throw new Error("Google did not return an access token");
  const profile = await responseJson(await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
  }));
  if (typeof profile.sub !== "string") throw new Error("Google account does not expose a stable subject");
  return {
    providerUserId: profile.sub,
    name: typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim().slice(0, 80)
      : "Google User",
    avatar: typeof profile.picture === "string" ? profile.picture.slice(0, 2048) : null,
  };
}

async function exchangeGithub(
  config: { clientId: string; clientSecret: string },
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const token = await responseJson(await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "PicBind-Worker",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  }));
  if (typeof token.access_token !== "string") throw new Error("GitHub did not return an access token");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token.access_token}`,
    "user-agent": "PicBind-Worker",
    "x-github-api-version": "2022-11-28",
  };
  const profile = await responseJson(await fetch("https://api.github.com/user", { headers }));
  if (typeof profile.id !== "number" && typeof profile.id !== "string") {
    throw new Error("GitHub account does not expose a stable user ID");
  }
  const login = typeof profile.login === "string" ? profile.login : "GitHub User";
  return {
    providerUserId: String(profile.id),
    name: typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim().slice(0, 80)
      : login.slice(0, 80),
    avatar: typeof profile.avatar_url === "string" ? profile.avatar_url.slice(0, 2048) : null,
  };
}

async function findIdentity(env: OAuthEnv, provider: OAuthProvider, providerUserId: string) {
  return env.USER_DB.prepare(
    "SELECT user_id FROM auth_identities WHERE provider = ? AND provider_user_id = ?",
  ).bind(provider, providerUserId).first<OAuthIdentityRow>();
}

async function updateOAuthAvatar(
  env: OAuthEnv,
  userId: string,
  avatar: string | null,
  now: string,
) {
  await env.USER_DB.prepare(
    "UPDATE users SET avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ?",
  ).bind(avatar, now, userId).run();
}

export async function ensureOAuthUser(
  env: OAuthEnv,
  provider: OAuthProvider,
  profile: OAuthProfile,
  now: string,
) {
  const identity = await findIdentity(env, provider, profile.providerUserId);
  if (identity) {
    await ensureDefaultWorkspace(env, identity.user_id, now);
    return identity.user_id;
  }

  const userId = uuidV7();
  try {
    await env.USER_DB.batch([
      env.USER_DB.prepare(
        "INSERT INTO users (id, email, name, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(userId, null, profile.name, profile.avatar, now, now),
      env.USER_DB.prepare(
        "INSERT INTO auth_identities (provider, provider_user_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(provider, profile.providerUserId, userId, now, now),
    ]);
    await ensureDefaultWorkspace(env, userId, now);
    return userId;
  } catch (error) {
    const concurrentIdentity = await findIdentity(env, provider, profile.providerUserId);
    if (concurrentIdentity) {
      await ensureDefaultWorkspace(env, concurrentIdentity.user_id, now);
      return concurrentIdentity.user_id;
    }
    throw error;
  }
}

export async function handleOAuthStart(request: Request, env: OAuthEnv, provider: OAuthProvider) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnTo(env, requestUrl.searchParams.get("return_to"));
  const config = oauthConfig(env, provider);
  if (!config) return redirectToApp(returnTo, "error:oauth_unavailable");

  const state = randomToken(32);
  const verifier = randomToken(48);
  const now = new Date();
  await env.USER_DB.batch([
    env.USER_DB.prepare("DELETE FROM auth_oauth_states WHERE expires_at <= ?").bind(now.toISOString()),
    env.USER_DB.prepare(
      "INSERT INTO auth_oauth_states (state_hash, provider, return_to, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      await sha256(state),
      provider,
      returnTo,
      verifier,
      now.toISOString(),
      new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString(),
    ),
  ]);
  const location = providerAuthorizationUrl(
    provider,
    config.clientId,
    callbackUrl(request, env, provider),
    state,
    await sha256(verifier),
  );
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

export async function handleOAuthCallback(request: Request, env: OAuthEnv, provider: OAuthProvider) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state") || "";
  const fallback = defaultReturnTo(env);
  if (!state || state.length > 512) return redirectToApp(fallback, "error:oauth_invalid_state");

  const stateHash = await sha256(state);
  const now = new Date().toISOString();
  const stored = await env.USER_DB.prepare(
    "SELECT state_hash, provider, return_to, code_verifier, expires_at FROM auth_oauth_states WHERE state_hash = ? AND provider = ? AND expires_at > ?",
  ).bind(stateHash, provider, now).first<OAuthStateRow>();
  if (!stored) return redirectToApp(fallback, "error:oauth_invalid_state");
  const consumed = await env.USER_DB.prepare("DELETE FROM auth_oauth_states WHERE state_hash = ?")
    .bind(stateHash)
    .run();
  if (consumed.meta.changes !== 1) return redirectToApp(fallback, "error:oauth_invalid_state");
  if (requestUrl.searchParams.has("error")) {
    return redirectToApp(stored.return_to, "error:oauth_cancelled");
  }
  const code = requestUrl.searchParams.get("code") || "";
  const config = oauthConfig(env, provider);
  if (!config || !code || code.length > 4096) {
    return redirectToApp(stored.return_to, "error:oauth_failed");
  }

  try {
    const profile = provider === "google"
      ? await exchangeGoogle(config, code, stored.code_verifier, callbackUrl(request, env, provider))
      : await exchangeGithub(config, code, stored.code_verifier, callbackUrl(request, env, provider));
    const userId = await ensureOAuthUser(env, provider, profile, now);
    await updateOAuthAvatar(env, userId, profile.avatar, now);
    const session = await createSessionStatement(env, userId, now);
    const handoff = await createAuthHandoffStatement(
      env,
      userId,
      session.id,
      stored.return_to,
      now,
    );
    await env.USER_DB.batch([
      env.USER_DB.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= ?")
        .bind(userId, now),
      session.statement,
      handoff.statement,
      env.USER_DB.prepare(
        "DELETE FROM auth_sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)",
      ).bind(userId, userId, MAX_SESSIONS_PER_USER),
    ]);
    return redirectToApp(stored.return_to, "success", sessionCookie(session.token), handoff.code);
  } catch (error) {
    return redirectToApp(stored.return_to, "error:oauth_failed");
  }
}
