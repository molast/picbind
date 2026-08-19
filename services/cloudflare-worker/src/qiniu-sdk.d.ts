declare module "qiniu/qiniu/util.js" {
  export function base64ToUrlSafe(value: string): string;
  export function hmacSha1(value: string, secretKey: string): string;
  export function urlsafeBase64Encode(value: string): string;
}
