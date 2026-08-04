export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const ILINK_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8);
const CHANNEL_VERSION = "2.2.0";

type JsonRecord = Record<string, unknown>;

function randomWechatUin() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return btoa(String(value));
}

function requestHeaders(body?: string, token?: string): HeadersInit {
  const headers: Record<string, string> = {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers.AuthorizationType = "ilink_bot_token";
    headers["X-WECHAT-UIN"] = randomWechatUin();
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJson(response: Response) {
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`iLink HTTP ${response.status}: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw) as JsonRecord;
}

async function get(baseUrl: string, endpoint: string) {
  return readJson(await fetch(`${baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    headers: requestHeaders(),
  }));
}

async function post(
  baseUrl: string,
  endpoint: string,
  payload: JsonRecord,
  token: string,
) {
  const body = JSON.stringify({
    ...payload,
    base_info: { channel_version: CHANNEL_VERSION },
  });
  return readJson(await fetch(`${baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    method: "POST",
    headers: requestHeaders(body, token),
    body,
  }));
}

export type IlinkQrCode = {
  value: string;
  scanData: string;
};

export type IlinkQrStatus = {
  status: "wait" | "scaned" | "scaned_but_redirect" | "expired" | "confirmed";
  redirectHost?: string;
  accountId?: string;
  token?: string;
  baseUrl?: string;
  userId?: string;
};

export async function requestQrCode(): Promise<IlinkQrCode> {
  const response = await get(
    ILINK_BASE_URL,
    "ilink/bot/get_bot_qrcode?bot_type=3",
  );
  const value = String(response.qrcode || "");
  const scanData = String(response.qrcode_img_content || value);
  if (!value || !scanData) throw new Error("iLink QR response is incomplete");
  return { value, scanData };
}

export async function requestQrStatus(
  qrcode: string,
  baseUrl = ILINK_BASE_URL,
): Promise<IlinkQrStatus> {
  const response = await get(
    baseUrl,
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
  );
  return {
    status: String(response.status || "wait") as IlinkQrStatus["status"],
    redirectHost: response.redirect_host
      ? String(response.redirect_host)
      : undefined,
    accountId: response.ilink_bot_id
      ? String(response.ilink_bot_id)
      : undefined,
    token: response.bot_token ? String(response.bot_token) : undefined,
    baseUrl: response.baseurl ? String(response.baseurl) : undefined,
    userId: response.ilink_user_id
      ? String(response.ilink_user_id)
      : undefined,
  };
}

export function getUpdates(
  baseUrl: string,
  token: string,
  syncBuffer: string,
) {
  return post(
    baseUrl,
    "ilink/bot/getupdates",
    { get_updates_buf: syncBuffer },
    token,
  );
}

export function sendTextMessage(
  baseUrl: string,
  token: string,
  toUserId: string,
  text: string,
  contextToken?: string,
) {
  const message: JsonRecord = {
    from_user_id: "",
    to_user_id: toUserId,
    client_id: `picbind-${crypto.randomUUID()}`,
    message_type: 2,
    message_state: 2,
    item_list: [{ type: 1, text_item: { text } }],
  };
  if (contextToken) message.context_token = contextToken;
  return post(baseUrl, "ilink/bot/sendmessage", { msg: message }, token);
}

export type IlinkImageUploadRequest = {
  fileKey: string;
  rawSize: number;
  rawMd5: string;
  encryptedSize: number;
  aesKeyHex: string;
};

export function requestImageUpload(
  baseUrl: string,
  token: string,
  toUserId: string,
  image: IlinkImageUploadRequest,
) {
  return post(baseUrl, "ilink/bot/getuploadurl", {
    filekey: image.fileKey,
    media_type: 1,
    to_user_id: toUserId,
    rawsize: image.rawSize,
    rawfilemd5: image.rawMd5,
    filesize: image.encryptedSize,
    no_need_thumb: true,
    aeskey: image.aesKeyHex,
  }, token);
}

export function sendImageMessage(
  baseUrl: string,
  token: string,
  toUserId: string,
  encryptedQueryParam: string,
  aesKeyForApi: string,
  encryptedSize: number,
  contextToken?: string,
) {
  const message: JsonRecord = {
    from_user_id: "",
    to_user_id: toUserId,
    client_id: `picbind-${crypto.randomUUID()}`,
    message_type: 2,
    message_state: 2,
    item_list: [{
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: encryptedQueryParam,
          aes_key: aesKeyForApi,
          encrypt_type: 1,
        },
        mid_size: encryptedSize,
      },
    }],
  };
  if (contextToken) message.context_token = contextToken;
  return post(baseUrl, "ilink/bot/sendmessage", { msg: message }, token);
}
