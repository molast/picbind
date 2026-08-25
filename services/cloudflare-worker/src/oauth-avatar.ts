import { failure } from "./auth";

export type OAuthAvatarEnv = {
  SHARE_IMAGES_R2: R2Bucket;
  OAUTH_CALLBACK_ORIGIN?: string;
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";
const AVATAR_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const AVATAR_HOSTS = new Set(["avatars.githubusercontent.com", "lh3.googleusercontent.com"]);

function avatarKey(userId: string) {
  return `auth/avatars/${userId}`;
}

function allowedProviderAvatar(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:"
      && AVATAR_HOSTS.has(url.hostname)
      && !url.port
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function publicAvatarOrigin(env: OAuthAvatarEnv, requestOrigin: string) {
  try {
    return new URL(env.OAUTH_CALLBACK_ORIGIN?.trim() || requestOrigin).origin;
  } catch {
    return requestOrigin;
  }
}

export async function cacheOAuthAvatar(
  env: OAuthAvatarEnv,
  requestOrigin: string,
  userId: string,
  sourceUrl: string | null,
) {
  if (!sourceUrl || !allowedProviderAvatar(sourceUrl)) return null;
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "PicBind-Worker" },
    redirect: "follow",
  });
  if (!response.ok || !allowedProviderAvatar(response.url || sourceUrl)) return null;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_AVATAR_BYTES) return null;
  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!AVATAR_TYPES.has(contentType)) return null;
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_AVATAR_BYTES) return null;

  await env.SHARE_IMAGES_R2.put(avatarKey(userId), bytes, {
    httpMetadata: {
      contentType,
      cacheControl: AVATAR_CACHE_CONTROL,
    },
  });
  return `${publicAvatarOrigin(env, requestOrigin)}/api/auth/avatars/${encodeURIComponent(userId)}`;
}

export async function handleOAuthAvatar(
  request: Request,
  env: OAuthAvatarEnv,
  userId: string,
) {
  if (request.method !== "GET") return failure("method_not_allowed", "Method not allowed", 405);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
    return failure("avatar_not_found", "Avatar not found", 404);
  }
  const object = await env.SHARE_IMAGES_R2.get(avatarKey(userId));
  if (!object) return failure("avatar_not_found", "Avatar not found", 404);

  const headers = new Headers({
    "cache-control": object.httpMetadata?.cacheControl || AVATAR_CACHE_CONTROL,
    etag: object.httpEtag,
  });
  if (object.httpMetadata?.contentType) {
    headers.set("content-type", object.httpMetadata.contentType);
  }
  return new Response(object.body, { headers });
}
