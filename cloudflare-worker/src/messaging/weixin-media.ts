import { Buffer } from "node:buffer";
import { createDecipheriv } from "node:crypto";
import { ILINK_CDN_BASE_URL } from "./ilink-client";

type JsonRecord = Record<string, unknown>;

const CDN_HOSTS = new Set([
  "novac2c.cdn.weixin.qq.com",
  "ilinkai.weixin.qq.com",
  "wx.qlogo.cn",
  "thirdwx.qlogo.cn",
  "res.wx.qq.com",
  "mmbiz.qpic.cn",
  "mmbiz.qlogo.cn",
]);

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function parseKey(value: string) {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  if (
    decoded.length === 32 &&
    /^[0-9a-f]{32}$/i.test(decoded.toString("ascii"))
  ) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error(`Unexpected Weixin AES key format (${decoded.length} bytes)`);
}

function decrypt(ciphertext: Uint8Array, key: Uint8Array) {
  if (ciphertext.byteLength % 16 !== 0) {
    throw new Error("Encrypted media is not AES block aligned");
  }
  // Workers' Node compatibility layer cannot normalize a null ECB IV.
  const decipher = createDecipheriv("aes-128-ecb", key, Buffer.alloc(0));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  if (!padded.length) return padded;
  const padding = padded[padded.length - 1];
  if (padding >= 1 && padding <= 16) {
    const suffix = padded.subarray(padded.length - padding);
    if (suffix.every((value) => value === padding)) {
      return padded.subarray(0, padded.length - padding);
    }
  }
  return padded;
}

function imageType(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  if (
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (data.subarray(4, 12).toString("ascii").includes("ftypavif")) {
    return { mimeType: "image/avif", extension: "avif" };
  }
  throw new Error("Downloaded Weixin media is not a supported image");
}

async function download(url: string, maxSize: number) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !CDN_HOSTS.has(parsed.hostname)) {
    throw new Error("Refusing to download media from an untrusted host");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Weixin CDN HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxSize) {
    throw new Error("Weixin image exceeds the media size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Weixin CDN response has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxSize) {
      await reader.cancel();
      throw new Error("Weixin image exceeds the media size limit");
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks);
}

export async function receiveWeixinImage(
  itemValue: unknown,
  maxSize: number,
) {
  const item = record(itemValue);
  const imageItem = record(item.image_item);
  const media = record(imageItem.media);
  const encryptedQuery = String(media.encrypt_query_param || "").trim();
  const fullUrl = String(media.full_url || "").trim();
  const url = encryptedQuery
    ? `${ILINK_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptedQuery)}`
    : fullUrl;
  if (!url) throw new Error("Weixin image has no download reference");

  let data: Uint8Array = await download(url, maxSize);
  const legacyHexKey = String(imageItem.aeskey || "").trim();
  const mediaKey = String(media.aes_key || "").trim();
  if (legacyHexKey) {
    if (!/^[0-9a-f]{32}$/i.test(legacyHexKey)) {
      throw new Error("Invalid Weixin image aeskey");
    }
    data = decrypt(data, Buffer.from(legacyHexKey, "hex"));
  } else if (mediaKey) {
    data = decrypt(data, parseKey(mediaKey));
  }
  const detected = imageType(data);
  return {
    data,
    ...detected,
    fileName: `wechat-image-${Date.now()}.${detected.extension}`,
  };
}
