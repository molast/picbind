import {
  AUTH_HANDOFF_TTL_SECONDS,
  isOriginBound,
} from "./realtime/workspace-v2-protocol";

export type AuthEnv = {
  USER_DB: D1Database;
};

type UserRow = {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
  last_seen_at: string;
};

type CredentialRow = {
  user_id: string;
  password_hash: string;
};

type AuthHandoffRow = {
  code_hash: string;
  user_id: string;
  session_id: string;
  return_origin: string;
  expires_at: string;
  consumed_at: string | null;
};

type DefaultWorkspaceRow = {
  id: string;
  share_id: string;
  name: string;
  owner_capability: string;
  created_at: string;
  updated_at: string;
};

const SESSION_COOKIE = "__Host-picbind_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 20;
const MAX_JSON_BODY_BYTES = 16_384;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_ALGORITHM = "pbkdf2-sha256-v1";

function requestId() {
  return crypto.randomUUID();
}

export function success(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify({ data, requestId: requestId() }), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

export function failure(code: string, message: string, status: number) {
  return new Response(
    JSON.stringify({ error: { code, message }, requestId: requestId() }),
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function randomToken(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function uuidV7() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationsText, saltText, expectedText] = encoded.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== PASSWORD_ALGORITHM || iterations !== PASSWORD_ITERATIONS || !saltText || !expectedText) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const expected = base64UrlToBytes(expectedText);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(saltText), iterations },
      key,
      expected.length * 8,
    );
    return constantTimeEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validEmail(email: string) {
  return email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function displayName(value: unknown, email: string) {
  const explicit = typeof value === "string" ? value.trim() : "";
  return (explicit || email.split("@")[0] || "PicBind User").slice(0, 80);
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicDefaultWorkspace(row: DefaultWorkspaceRow) {
  return {
    id: row.id,
    shareId: row.share_id,
    name: row.name,
    ownerCapability: row.owner_capability,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findDefaultWorkspace(env: AuthEnv, userId: string) {
  return env.USER_DB.prepare(
    `SELECT workspace.id, workspace.share_id, workspace.name,
            mapping.owner_capability, workspace.created_at, workspace.updated_at
     FROM user_default_workspaces mapping
     JOIN workspaces workspace ON workspace.id = mapping.workspace_id
     WHERE mapping.user_id = ?`,
  ).bind(userId).first<DefaultWorkspaceRow>();
}

export async function ensureDefaultWorkspace(env: AuthEnv, userId: string, now = new Date().toISOString()) {
  const existing = await findDefaultWorkspace(env, userId);
  if (existing) return publicDefaultWorkspace(existing);

  const workspaceId = uuidV7();
  const shareId = `share_${randomToken(24)}`;
  const ownerCapability = randomToken(32);
  try {
    await env.USER_DB.batch([
      env.USER_DB.prepare(
        "INSERT INTO workspaces (id, share_id, owner_capability_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(workspaceId, shareId, await sha256(ownerCapability), "My Workspace", now, now),
      env.USER_DB.prepare(
        "INSERT INTO user_default_workspaces (user_id, workspace_id, owner_capability, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(userId, workspaceId, ownerCapability, now, now),
    ]);
  } catch (error) {
    const concurrent = await findDefaultWorkspace(env, userId);
    if (concurrent) return publicDefaultWorkspace(concurrent);
    throw error;
  }

  return {
    id: workspaceId,
    shareId,
    name: "My Workspace",
    ownerCapability,
    createdAt: now,
    updatedAt: now,
  };
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const pair of cookies.split(";")) {
    const separator = pair.indexOf("=");
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return "";
}

function sessionToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return readCookie(request, SESSION_COOKIE);
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

export async function createSessionStatement(env: AuthEnv, userId: string, now: string) {
  const id = uuidV7();
  const token = randomToken(32);
  const expiresAt = new Date(Date.parse(now) + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  return {
    id,
    token,
    expiresAt,
    statement: env.USER_DB.prepare(
      "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, userId, await sha256(token), now, expiresAt, now),
  };
}

function requestOrigin(request: Request) {
  const value = request.headers.get("origin");
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export async function createAuthHandoffStatement(
  env: AuthEnv,
  userId: string,
  sessionId: string,
  returnTo: string,
  now: string,
) {
  const code = randomToken(32);
  const returnOrigin = new URL(returnTo).origin;
  const expiresAt = new Date(Date.parse(now) + AUTH_HANDOFF_TTL_SECONDS * 1000).toISOString();
  return {
    code,
    statement: env.USER_DB.prepare(
      "INSERT INTO auth_handoff_codes (code_hash, user_id, session_id, return_origin, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
    ).bind(await sha256(code), userId, sessionId, returnOrigin, now, expiresAt),
  };
}

export async function currentSession(request: Request, env: AuthEnv) {
  const token = sessionToken(request);
  if (!token) return null;
  const now = new Date().toISOString();
  const session = await env.USER_DB.prepare(
    "SELECT id, user_id, expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?",
  ).bind(await sha256(token), now).first<SessionRow>();
  if (!session) return null;
  if (Date.parse(now) - Date.parse(session.last_seen_at) >= SESSION_TOUCH_INTERVAL_MS) {
    await env.USER_DB.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?")
      .bind(now, session.id)
      .run();
  }
  return { ...session, token };
}

export async function userState(env: AuthEnv, userId: string) {
  const user = await env.USER_DB.prepare(
    "SELECT id, email, name, avatar, created_at, updated_at FROM users WHERE id = ?",
  ).bind(userId).first<UserRow>();
  if (!user) return null;
  const workspace = await ensureDefaultWorkspace(env, userId);
  return { user: publicUser(user), workspaces: [workspace] };
}

async function readLimitedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_JSON_BODY_BYTES || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function parseBody(request: Request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return null;
  }
  try {
    const text = await readLimitedBody(request);
    if (text === null) return null;
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function handleRegister(request: Request, env: AuthEnv) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const body = await parseBody(request);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!validEmail(email) || password.length < 8 || password.length > 1024) {
    return failure("invalid_input", "Invalid registration details", 400);
  }
  const existing = await env.USER_DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return failure("email_registered", "Email is already registered", 409);

  const now = new Date().toISOString();
  const userId = uuidV7();
  const passwordHash = await hashPassword(password);
  const session = await createSessionStatement(env, userId, now);
  try {
    await env.USER_DB.batch([
      env.USER_DB.prepare("INSERT INTO users (id, email, name, avatar, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
        .bind(userId, email, displayName(body?.name, email), now, now),
      env.USER_DB.prepare("INSERT INTO auth_credentials (user_id, password_hash, password_algorithm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, passwordHash, PASSWORD_ALGORITHM, now, now),
      session.statement,
    ]);
  } catch (error) {
    const concurrentUser = await env.USER_DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first();
    if (concurrentUser) {
      return failure("email_registered", "Email is already registered", 409);
    }
    throw error;
  }

  const state = await userState(env, userId);
  if (!state) throw new Error("Registration completed without a valid user");
  return success(
    { authenticated: true, ...state },
    { status: 201, headers: { "set-cookie": sessionCookie(session.token) } },
  );
}

export async function handleLogin(request: Request, env: AuthEnv) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const body = await parseBody(request);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!validEmail(email) || !password || password.length > 1024) {
    return failure("invalid_credentials", "Email or password is incorrect", 401);
  }
  const credential = await env.USER_DB.prepare(
    "SELECT c.user_id, c.password_hash FROM auth_credentials c JOIN users u ON u.id = c.user_id WHERE u.email = ?",
  ).bind(email).first<CredentialRow>();
  const passwordMatches = credential
    ? await verifyPassword(password, credential.password_hash)
    : (await hashPassword(password), false);
  if (!credential || !passwordMatches) {
    return failure("invalid_credentials", "Email or password is incorrect", 401);
  }
  const now = new Date().toISOString();
  const session = await createSessionStatement(env, credential.user_id, now);
  await env.USER_DB.batch([
    env.USER_DB.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= ?")
      .bind(credential.user_id, now),
    session.statement,
    env.USER_DB.prepare(
      "DELETE FROM auth_sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)",
    ).bind(credential.user_id, credential.user_id, MAX_SESSIONS_PER_USER),
  ]);
  const state = await userState(env, credential.user_id);
  if (!state) throw new Error("Authenticated user record is unavailable");
  return success(
    { authenticated: true, ...state },
    { headers: { "set-cookie": sessionCookie(session.token) } },
  );
}

export async function handleLogout(request: Request, env: AuthEnv) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const token = sessionToken(request);
  if (token) {
    await env.USER_DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  return success({ authenticated: false }, { headers: { "set-cookie": sessionCookie("", 0) } });
}

export async function handleSession(request: Request, env: AuthEnv) {
  if (request.method !== "GET") return failure("method_not_allowed", "Method not allowed", 405);
  const session = await currentSession(request, env);
  if (!session) return success({ authenticated: false });
  const state = await userState(env, session.user_id);
  if (!state) return success({ authenticated: false });
  return success({ authenticated: true, ...state });
}

export async function handleAuthExchange(request: Request, env: AuthEnv) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const origin = requestOrigin(request);
  if (!origin) return failure("auth_origin_mismatch", "Authentication origin does not match", 403);
  const body = await parseBody(request);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(code)) {
    return failure("auth_code_invalid", "Authentication code is invalid", 401);
  }
  const codeHash = await sha256(code);
  const stored = await env.USER_DB.prepare(
    "SELECT code_hash, user_id, session_id, return_origin, expires_at, consumed_at FROM auth_handoff_codes WHERE code_hash = ?",
  ).bind(codeHash).first<AuthHandoffRow>();
  if (!stored) return failure("auth_code_invalid", "Authentication code is invalid", 401);
  if (!isOriginBound(origin, stored.return_origin)) {
    return failure("auth_origin_mismatch", "Authentication origin does not match", 403);
  }
  if (stored.consumed_at !== null) {
    return failure("auth_code_used", "Authentication code was already used", 409);
  }
  const now = new Date().toISOString();
  if (Date.parse(now) >= Date.parse(stored.expires_at)) {
    return failure("auth_code_expired", "Authentication code has expired", 401);
  }
  const consumed = await env.USER_DB.prepare(
    "UPDATE auth_handoff_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
  ).bind(now, codeHash, now).run();
  if (consumed.meta.changes !== 1) {
    return failure("auth_code_used", "Authentication code was already used", 409);
  }
  const session = await env.USER_DB.prepare(
    "SELECT id FROM auth_sessions WHERE id = ? AND user_id = ? AND expires_at > ?",
  ).bind(stored.session_id, stored.user_id, now).first<{ id: string }>();
  if (!session) return failure("auth_code_invalid", "Authentication code is invalid", 401);
  const state = await userState(env, stored.user_id);
  if (!state) return failure("auth_code_invalid", "Authentication code is invalid", 401);
  return success({ authenticated: true, ...state });
}

export async function purgeExpiredAuthSessions(env: AuthEnv, now = new Date().toISOString()) {
  await env.USER_DB.batch([
    env.USER_DB.prepare("DELETE FROM auth_handoff_codes WHERE expires_at <= ?").bind(now),
    env.USER_DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now),
  ]);
}
