import { createR2PresignedUrl, type R2PresignEnv } from "../r2-presign";

export type FileTransferMode = "p2p" | "r2" | "auto";

export type ShareRoomR2Env = R2PresignEnv & {
  SHARE_IMAGES_R2: R2Bucket;
  FILE_TRANSFER_MODE?: string;
  R2_RTT_THRESHOLD_MS?: string;
  R2_FILE_TTL_SECONDS?: string;
};

export type R2ImageMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
};

function randomBase64Url(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function configuredMode(env: ShareRoomR2Env): FileTransferMode {
  const mode = env.FILE_TRANSFER_MODE?.trim().toLowerCase();
  return mode === "p2p" || mode === "r2" || mode === "auto" ? mode : "auto";
}

export function decideFileTransferMode(
  env: ShareRoomR2Env,
  rttMs: number | null,
  weakNetwork?: boolean,
) {
  const mode = configuredMode(env);
  if (mode !== "auto") return mode;
  if (typeof weakNetwork === "boolean") {
    return weakNetwork ? "r2" : "p2p";
  }
  const threshold = Number(env.R2_RTT_THRESHOLD_MS || 200);
  return rttMs !== null && Number.isFinite(rttMs) && rttMs > threshold
    ? "r2"
    : "p2p";
}

export function r2FileExpiresAt(env: ShareRoomR2Env, roomExpiresAt: string) {
  const ttlSeconds = Math.max(
    60,
    Math.min(86_400, Number(env.R2_FILE_TTL_SECONDS || 1800)),
  );
  return Math.min(Date.parse(roomExpiresAt), Date.now() + ttlSeconds * 1000);
}

export async function prepareR2Upload(
  env: ShareRoomR2Env,
  roomId: string,
  image: R2ImageMetadata,
  roomExpiresAt: string,
) {
  const objectKey = `${roomId}/${image.id}/${randomBase64Url(18)}`;
  const expiresAt = r2FileExpiresAt(env, roomExpiresAt);
  return {
    objectKey,
    expiresAt,
    uploadUrl: await createR2PresignedUrl(env, "PUT", objectKey, 900),
  };
}

export async function verifyR2Upload(
  env: ShareRoomR2Env,
  objectKey: string,
  image: R2ImageMetadata,
) {
  const object = await env.SHARE_IMAGES_R2.head(objectKey);
  if (!object || object.size !== image.size) {
    throw new Error("R2 upload could not be verified");
  }
  const contentType = object.httpMetadata?.contentType;
  if (contentType && contentType !== image.type) {
    throw new Error("R2 upload content type does not match");
  }
}

export function createR2DownloadUrl(
  env: ShareRoomR2Env,
  objectKey: string,
  expiresAt: number,
) {
  const remainingSeconds = Math.max(
    1,
    Math.min(900, Math.floor((expiresAt - Date.now()) / 1000)),
  );
  return createR2PresignedUrl(env, "GET", objectKey, remainingSeconds);
}
