import {
  base64ToUrlSafe,
  hmacSha1,
  urlsafeBase64Encode,
} from "qiniu/qiniu/util.js";

export type QiniuStorageEnv = {
  QINIU_ACCESS_KEY?: string;
  QINIU_SECRET_KEY?: string;
  QINIU_BUCKET?: string;
  QINIU_UPLOAD_URL?: string;
  QINIU_DOWNLOAD_URL?: string;
};

export type QiniuUploadOptions = {
  expiresInSeconds?: number;
  maxFileSize?: number;
  mimeType?: string;
};

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured`);
  return normalized;
}

function normalizeObjectKey(objectKey: string) {
  const normalized = objectKey.trim().replace(/^\/+/, "");
  if (!normalized || normalized.length > 1024 || normalized.includes("\0")) {
    throw new Error("Invalid Qiniu object key");
  }
  return normalized;
}

export function createQiniuUploadCredential(
  env: QiniuStorageEnv,
  objectKey: string,
  options: QiniuUploadOptions = {},
) {
  const accessKey = requiredValue(env.QINIU_ACCESS_KEY, "QINIU_ACCESS_KEY");
  const secretKey = requiredValue(env.QINIU_SECRET_KEY, "QINIU_SECRET_KEY");
  const bucket = requiredValue(env.QINIU_BUCKET, "QINIU_BUCKET");
  const key = normalizeObjectKey(objectKey);
  const expires = Math.max(
    60,
    Math.min(3600, Math.floor(options.expiresInSeconds ?? 900)),
  );
  const maxFileSize = options.maxFileSize;
  const policy = {
    scope: `${bucket}:${key}`,
    insertOnly: 1,
    detectMime: 1,
    ...(typeof maxFileSize === "number" && Number.isSafeInteger(maxFileSize)
      ? { fsizeLimit: Math.max(1, maxFileSize) }
      : {}),
    ...(options.mimeType ? { mimeLimit: options.mimeType } : {}),
    returnBody:
      '{"key":"$(key)","hash":"$(etag)","size":$(fsize),"mimeType":"$(mimeType)"}',
    deadline: Math.floor(Date.now() / 1000) + expires,
  };
  const encodedPolicy = urlsafeBase64Encode(JSON.stringify(policy));
  const encodedSignature = base64ToUrlSafe(
    hmacSha1(encodedPolicy, secretKey),
  );
  return {
    key,
    uploadToken: `${accessKey}:${encodedSignature}:${encodedPolicy}`,
    uploadUrl:
      env.QINIU_UPLOAD_URL?.trim() || "https://upload.qiniup.com",
    expiresAt: Date.now() + expires * 1000,
  };
}
