use std::{collections::HashMap, error::Error as _};

use super::models::{MessagingMessage, MessagingMessageType, MessagingPayload};
use aes::Aes128;
use base64::{engine::general_purpose::STANDARD, Engine};
use ecb::cipher::{
    block_padding::{NoPadding, Pkcs7},
    BlockDecryptMut, BlockEncryptMut, KeyInit,
};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;

const ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const ILINK_CDN_BASE_URL: &str = "https://novac2c.cdn.weixin.qq.com/c2c";
const APP_CLIENT_VERSION: u32 = (2 << 16) | (2 << 8);
const CHANNEL_VERSION: &str = "2.2.0";
const MAX_MEDIA_SIZE: usize = 20 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Account {
    pub account_id: String,
    pub token: String,
    pub base_url: String,
    pub user_id: Option<String>,
    #[serde(default)]
    pub sync_buffer: String,
    #[serde(default)]
    pub context_tokens: HashMap<String, String>,
}

#[derive(Clone, Debug)]
pub(super) struct QrCode {
    pub value: String,
    pub scan_data: String,
}

#[derive(Clone, Debug)]
pub(super) struct QrStatus {
    pub status: String,
    pub redirect_host: Option<String>,
    pub account_id: Option<String>,
    pub token: Option<String>,
    pub base_url: Option<String>,
    pub user_id: Option<String>,
}

pub(super) struct UpdateBatch {
    pub sync_buffer: String,
    pub messages: Vec<Value>,
    pub long_poll_timeout: Option<std::time::Duration>,
}

pub(super) struct ReceivedImage {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub file_name: String,
}

pub(super) async fn request_qr_code(client: &reqwest::Client) -> Result<QrCode, String> {
    let value = get(
        client,
        ILINK_BASE_URL,
        "ilink/bot/get_bot_qrcode?bot_type=3",
    )
    .await?;
    let code = string(&value, "qrcode");
    let scan_data = non_empty(&value, "qrcode_img_content").unwrap_or_else(|| code.clone());
    if code.is_empty() || scan_data.is_empty() {
        return Err("iLink QR response is incomplete".into());
    }
    Ok(QrCode {
        value: code,
        scan_data,
    })
}

pub(super) async fn request_qr_status(
    client: &reqwest::Client,
    base_url: &str,
    qrcode: &str,
) -> Result<QrStatus, String> {
    let value = get(
        client,
        base_url,
        &format!(
            "ilink/bot/get_qrcode_status?qrcode={}",
            urlencoding::encode(qrcode)
        ),
    )
    .await?;
    Ok(QrStatus {
        status: string(&value, "status"),
        redirect_host: non_empty(&value, "redirect_host"),
        account_id: non_empty(&value, "ilink_bot_id"),
        token: non_empty(&value, "bot_token"),
        base_url: non_empty(&value, "baseurl"),
        user_id: non_empty(&value, "ilink_user_id"),
    })
}

pub(super) async fn get_updates(
    client: &reqwest::Client,
    account: &Account,
    timeout: std::time::Duration,
) -> Result<UpdateBatch, String> {
    let request = post(
        client,
        &account.base_url,
        "ilink/bot/getupdates",
        json!({ "get_updates_buf": account.sync_buffer }),
        &account.token,
    );
    let value = match tokio::time::timeout(timeout, request).await {
        Ok(result) => result?,
        Err(_) => {
            return Ok(UpdateBatch {
                sync_buffer: account.sync_buffer.clone(),
                messages: Vec::new(),
                long_poll_timeout: None,
            });
        }
    };
    check_ret(&value, "getupdates")?;
    Ok(UpdateBatch {
        sync_buffer: non_empty(&value, "get_updates_buf").unwrap_or_default(),
        messages: value
            .get("msgs")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        long_poll_timeout: value
            .get("longpolling_timeout_ms")
            .and_then(Value::as_u64)
            .filter(|millis| *millis > 0)
            .map(std::time::Duration::from_millis),
    })
}

pub(super) async fn send_text(
    client: &reqwest::Client,
    account: &Account,
    recipient_id: &str,
    text: &str,
) -> Result<String, String> {
    let client_id = format!("picbind-{}", uuid::Uuid::new_v4());
    let mut context_token = account.context_tokens.get(recipient_id).cloned();
    let mut last_error = None;
    for attempt in 0..3 {
        let mut message = json!({
            "from_user_id": "",
            "to_user_id": recipient_id,
            "client_id": client_id,
            "message_type": 2,
            "message_state": 2,
            "item_list": [{ "type": 1, "text_item": { "text": text } }]
        });
        if let Some(context) = context_token.as_ref() {
            message["context_token"] = Value::String(context.clone());
        }
        match post(
            client,
            &account.base_url,
            "ilink/bot/sendmessage",
            json!({ "msg": message }),
            &account.token,
        )
        .await
        {
            Ok(value) if is_stale_session(&value) && context_token.is_some() => {
                context_token = None;
                last_error = Some("iLink context token expired".to_string());
            }
            Ok(value) => {
                check_ret(&value, "sendmessage")?;
                return Ok(non_empty(&value, "message_id").unwrap_or(client_id));
            }
            Err(error) => last_error = Some(error),
        }
        if attempt < 2 {
            tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt + 1))).await;
        }
    }
    Err(last_error.unwrap_or_else(|| "iLink sendmessage failed".into()))
}

pub(super) async fn send_image(
    client: &reqwest::Client,
    account: &Account,
    recipient_id: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<String, String> {
    if mime_type == "image/avif" {
        return Err("Weixin does not support sending AVIF images; convert the image first".into());
    }
    if !matches!(
        mime_type,
        "image/jpeg" | "image/png" | "image/webp" | "image/gif"
    ) {
        return Err("Unsupported image type".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_MEDIA_SIZE {
        return Err("Image exceeds the messaging size limit".into());
    }
    let key = random_16();
    let key_hex = hex(&key);
    let encrypted =
        ecb::Encryptor::<Aes128>::new(&key.into()).encrypt_padded_vec_mut::<Pkcs7>(bytes);
    let file_key = hex(&random_16());
    let raw_md5 = format!("{:x}", Md5::digest(bytes));
    let prepared = post(
        client,
        &account.base_url,
        "ilink/bot/getuploadurl",
        json!({
            "filekey": file_key,
            "media_type": 1,
            "to_user_id": recipient_id,
            "rawsize": bytes.len(),
            "rawfilemd5": raw_md5,
            "filesize": encrypted.len(),
            "no_need_thumb": true,
            "aeskey": key_hex,
        }),
        &account.token,
    )
    .await?;
    check_ret(&prepared, "getuploadurl")?;
    let full_url = non_empty(&prepared, "upload_full_url");
    let upload_param = non_empty(&prepared, "upload_param");
    let upload_url = full_url
        .or_else(|| {
            upload_param.map(|value| {
                format!(
                    "{ILINK_CDN_BASE_URL}/upload?encrypted_query_param={}&filekey={}",
                    urlencoding::encode(&value),
                    urlencoding::encode(&file_key)
                )
            })
        })
        .ok_or("iLink did not return an image upload URL")?;
    validate_cdn_url(&upload_url)?;
    let response = client
        .post(upload_url)
        .header("content-type", "application/octet-stream")
        .body(encrypted.clone())
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|error| format!("Weixin CDN upload failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Weixin CDN upload failed ({})", response.status()));
    }
    let encrypted_query = response
        .headers()
        .get("x-encrypted-param")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or("Weixin CDN response is missing x-encrypted-param")?
        .to_string();
    let mut message = json!({
        "from_user_id": "",
        "to_user_id": recipient_id,
        "client_id": format!("picbind-{}", uuid::Uuid::new_v4()),
        "message_type": 2,
        "message_state": 2,
        "item_list": [{
            "type": 2,
            "image_item": {
                "media": {
                    "encrypt_query_param": encrypted_query,
                    "aes_key": STANDARD.encode(key_hex.as_bytes()),
                    "encrypt_type": 1
                },
                "mid_size": encrypted.len()
            }
        }]
    });
    apply_context(&mut message, account, recipient_id);
    let sent = post(
        client,
        &account.base_url,
        "ilink/bot/sendmessage",
        json!({ "msg": message }),
        &account.token,
    )
    .await?;
    check_ret(&sent, "sendmessage")?;
    Ok(non_empty(&sent, "message_id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
}

pub(super) fn normalize_message(value: &Value, account: &mut Account) -> Vec<MessagingMessage> {
    let sender_id = string(value, "from_user_id");
    if sender_id.is_empty() || sender_id == account.account_id {
        return Vec::new();
    }
    if let Some(context) = non_empty(value, "context_token") {
        account.context_tokens.insert(sender_id.clone(), context);
    }
    let conversation_id = non_empty(value, "group_id").unwrap_or_else(|| sender_id.clone());
    let timestamp = normalized_timestamp(value);
    let message_id = message_identity(value);
    let mut messages = Vec::new();
    for (index, item) in value
        .get("item_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        match item.get("type").and_then(Value::as_i64) {
            Some(1) => {
                let text = item
                    .pointer("/text_item/text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                if !text.is_empty() {
                    messages.push(MessagingMessage {
                        id: message_id.clone(),
                        channel: "wechat".into(),
                        sender_id: sender_id.clone(),
                        conversation_id: conversation_id.clone(),
                        r#type: MessagingMessageType::Text,
                        payload: MessagingPayload {
                            text: Some(text.into()),
                            ..Default::default()
                        },
                        timestamp,
                    });
                }
            }
            Some(2) => messages.push(MessagingMessage {
                id: format!("{message_id}-image-{index}"),
                channel: "wechat".into(),
                sender_id: sender_id.clone(),
                conversation_id: conversation_id.clone(),
                r#type: MessagingMessageType::Image,
                payload: MessagingPayload {
                    file_id: Some(format!("{message_id}-{index}")),
                    download_url: Some(format!("ilink-image://{message_id}/{index}")),
                    file_name: Some("Weixin image".into()),
                    ..Default::default()
                },
                timestamp,
            }),
            _ => {}
        }
    }
    messages
}

pub(super) async fn receive_image(
    client: &reqwest::Client,
    item: &Value,
) -> Result<ReceivedImage, String> {
    let media = item.pointer("/image_item/media").unwrap_or(&Value::Null);
    let encrypted_query = string(media, "encrypt_query_param");
    let full_url = string(media, "full_url");
    let url = if !encrypted_query.is_empty() {
        format!(
            "{ILINK_CDN_BASE_URL}/download?encrypted_query_param={}",
            urlencoding::encode(&encrypted_query)
        )
    } else {
        full_url
    };
    validate_cdn_url(&url)?;
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("Weixin CDN download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Weixin CDN HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_MEDIA_SIZE as u64)
    {
        return Err("Weixin image exceeds the media size limit".into());
    }
    let mut bytes = response
        .bytes()
        .await
        .map_err(|error| error.to_string())?
        .to_vec();
    if bytes.len() > MAX_MEDIA_SIZE {
        return Err("Weixin image exceeds the media size limit".into());
    }
    let legacy_key = item
        .pointer("/image_item/aeskey")
        .and_then(Value::as_str)
        .unwrap_or("");
    let media_key = string(media, "aes_key");
    let key = if !legacy_key.is_empty() {
        decode_hex_16(legacy_key)?
    } else if !media_key.is_empty() {
        decode_media_key(&media_key)?
    } else {
        return detect_image(bytes);
    };
    bytes = ecb::Decryptor::<Aes128>::new(&key.into())
        .decrypt_padded_vec_mut::<NoPadding>(&bytes)
        .map_err(|_| "Unable to decrypt Weixin image".to_string())?;
    strip_pkcs7_if_present(&mut bytes);
    detect_image(bytes)
}

pub(super) fn image_items(value: &Value) -> Vec<Value> {
    value
        .get("item_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_i64) == Some(2))
        .cloned()
        .collect()
}

pub(super) fn message_identity(value: &Value) -> String {
    non_empty(value, "message_id").unwrap_or_else(|| {
        let encoded = serde_json::to_vec(value).unwrap_or_default();
        hex(&Sha256::digest(encoded)[..12])
    })
}

fn apply_context(message: &mut Value, account: &Account, recipient_id: &str) {
    if let Some(context) = account.context_tokens.get(recipient_id) {
        message["context_token"] = Value::String(context.clone());
    }
}

async fn get(client: &reqwest::Client, base_url: &str, endpoint: &str) -> Result<Value, String> {
    read_json(
        client
            .get(format!("{}/{endpoint}", base_url.trim_end_matches('/')))
            .headers(headers(None)?)
            .send()
            .await,
    )
    .await
}

async fn post(
    client: &reqwest::Client,
    base_url: &str,
    endpoint: &str,
    payload: Value,
    token: &str,
) -> Result<Value, String> {
    let mut body = payload.as_object().cloned().unwrap_or_default();
    body.insert(
        "base_info".into(),
        json!({ "channel_version": CHANNEL_VERSION }),
    );
    read_json(
        client
            .post(format!("{}/{endpoint}", base_url.trim_end_matches('/')))
            .headers(headers(Some(token))?)
            .json(&body)
            .send()
            .await,
    )
    .await
}

fn headers(token: Option<&str>) -> Result<reqwest::header::HeaderMap, String> {
    use reqwest::header::{HeaderMap, HeaderValue};
    let mut headers = HeaderMap::new();
    headers.insert("iLink-App-Id", HeaderValue::from_static("bot"));
    headers.insert(
        "iLink-App-ClientVersion",
        HeaderValue::from_str(&APP_CLIENT_VERSION.to_string()).map_err(|e| e.to_string())?,
    );
    if let Some(token) = token {
        headers.insert(
            "AuthorizationType",
            HeaderValue::from_static("ilink_bot_token"),
        );
        let random_uin = u32::from_ne_bytes(
            uuid::Uuid::new_v4().as_bytes()[..4]
                .try_into()
                .expect("UUID prefix is four bytes"),
        );
        headers.insert(
            "X-WECHAT-UIN",
            HeaderValue::from_str(&STANDARD.encode(random_uin.to_string()))
                .map_err(|e| e.to_string())?,
        );
        headers.insert(
            reqwest::header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|e| e.to_string())?,
        );
    }
    Ok(headers)
}

async fn read_json(result: Result<reqwest::Response, reqwest::Error>) -> Result<Value, String> {
    let response = result.map_err(format_request_error)?;
    let status = response.status();
    let raw = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "iLink HTTP {status}: {}",
            raw.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&raw).map_err(|error| format!("iLink returned invalid JSON: {error}"))
}

fn format_request_error(error: reqwest::Error) -> String {
    let category = if error.is_timeout() {
        "timed out"
    } else if error.is_connect() {
        "connection failed"
    } else if error.is_request() {
        "request could not be sent"
    } else if error.is_body() {
        "response body failed"
    } else {
        "request failed"
    };
    let mut causes = Vec::new();
    let mut source = error.source();
    while let Some(current) = source {
        let cause = current.to_string();
        if !cause.is_empty() {
            causes.push(cause);
        }
        source = current.source();
    }
    if causes.is_empty() {
        format!("iLink {category}: {error}")
    } else {
        format!("iLink {category}: {error}; cause: {}", causes.join("; "))
    }
}

fn check_ret(value: &Value, operation: &str) -> Result<(), String> {
    let ret = value.get("ret").and_then(Value::as_i64).unwrap_or(0);
    let errcode = value.get("errcode").and_then(Value::as_i64).unwrap_or(0);
    if ret == 0 && errcode == 0 {
        return Ok(());
    }
    let message = string(value, "errmsg");
    if is_stale_session(value) {
        Err("iLink session expired; scan the QR code again".into())
    } else {
        let code = if errcode != 0 { errcode } else { ret };
        Err(format!(
            "iLink {operation} failed: {}",
            if message.is_empty() {
                code.to_string()
            } else {
                message
            }
        ))
    }
}

fn is_stale_session(value: &Value) -> bool {
    let ret = value.get("ret").and_then(Value::as_i64).unwrap_or(0);
    let errcode = value.get("errcode").and_then(Value::as_i64).unwrap_or(0);
    let message = string(value, "errmsg");
    ret == -14
        || errcode == -14
        || ((ret == -2 || errcode == -2) && message.eq_ignore_ascii_case("unknown error"))
}

fn string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}
fn non_empty(value: &Value, key: &str) -> Option<String> {
    let value = string(value, key);
    (!value.is_empty()).then_some(value)
}
fn normalized_timestamp(value: &Value) -> u64 {
    let now = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let value = value
        .get("create_time_ms")
        .or_else(|| value.get("create_time"))
        .and_then(Value::as_u64)
        .unwrap_or(now);
    if value < 1_000_000_000_000 {
        value * 1000
    } else {
        value
    }
}
fn random_16() -> [u8; 16] {
    *uuid::Uuid::new_v4().as_bytes()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn decode_hex_16(value: &str) -> Result<[u8; 16], String> {
    if value.len() != 32 {
        return Err("Invalid Weixin image AES key".into());
    }
    let mut out = [0; 16];
    for (i, part) in value.as_bytes().chunks_exact(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(part).map_err(|e| e.to_string())?, 16)
            .map_err(|_| "Invalid Weixin image AES key")?;
    }
    Ok(out)
}
fn decode_media_key(value: &str) -> Result<[u8; 16], String> {
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| "Invalid Weixin image AES key")?;
    if decoded.len() == 16 {
        return decoded
            .try_into()
            .map_err(|_| "Invalid Weixin image AES key".into());
    }
    if decoded.len() == 32 {
        return decode_hex_16(
            std::str::from_utf8(&decoded).map_err(|_| "Invalid Weixin image AES key")?,
        );
    }
    Err("Invalid Weixin image AES key".into())
}
fn strip_pkcs7_if_present(bytes: &mut Vec<u8>) {
    let Some(&padding) = bytes.last() else {
        return;
    };
    let padding = padding as usize;
    if (1..=16).contains(&padding)
        && bytes.len() >= padding
        && bytes[bytes.len() - padding..]
            .iter()
            .all(|value| *value as usize == padding)
    {
        bytes.truncate(bytes.len() - padding);
    }
}
fn validate_cdn_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid Weixin CDN URL")?;
    let trusted = matches!(
        url.host_str(),
        Some(
            "novac2c.cdn.weixin.qq.com"
                | "ilinkai.weixin.qq.com"
                | "wx.qlogo.cn"
                | "thirdwx.qlogo.cn"
                | "res.wx.qq.com"
                | "mmbiz.qpic.cn"
                | "mmbiz.qlogo.cn"
        )
    );
    if url.scheme() == "https" && trusted {
        Ok(())
    } else {
        Err("Refusing to access an untrusted Weixin media URL".into())
    }
}
fn detect_image(bytes: Vec<u8>) -> Result<ReceivedImage, String> {
    let (mime, ext) = if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        ("image/jpeg", "jpg")
    } else if bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) {
        ("image/png", "png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        ("image/gif", "gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        ("image/webp", "webp")
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && matches!(&bytes[8..12], b"avif" | b"avis")
    {
        ("image/avif", "avif")
    } else {
        return Err("Downloaded Weixin media is not a supported image".into());
    };
    Ok(ReceivedImage {
        bytes,
        mime_type: mime.into(),
        file_name: format!(
            "wechat-image-{}.{}",
            chrono::Utc::now().timestamp_millis(),
            ext
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account() -> Account {
        Account {
            account_id: "bot-id".into(),
            token: "token".into(),
            base_url: ILINK_BASE_URL.into(),
            user_id: Some("owner-id".into()),
            sync_buffer: String::new(),
            context_tokens: HashMap::new(),
        }
    }

    #[test]
    fn normalizes_text_and_image_items() {
        let raw = json!({
            "message_id": "message-1",
            "from_user_id": "sender-1",
            "create_time": 123,
            "context_token": "context-1",
            "item_list": [
                { "type": 1, "text_item": { "text": " hello " } },
                { "type": 2, "image_item": { "media": { "full_url": "https://mmbiz.qpic.cn/image" } } }
            ]
        });
        let mut account = account();
        let messages = normalize_message(&raw, &mut account);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].payload.text.as_deref(), Some("hello"));
        assert_eq!(messages[0].timestamp, 123_000);
        assert_eq!(messages[1].r#type, MessagingMessageType::Image);
        assert_eq!(
            account.context_tokens.get("sender-1").map(String::as_str),
            Some("context-1")
        );
    }

    #[test]
    fn ignores_messages_sent_by_the_bot_account() {
        let raw = json!({
            "message_id": "message-1",
            "from_user_id": "bot-id",
            "item_list": [{ "type": 1, "text_item": { "text": "echo" } }]
        });
        assert!(normalize_message(&raw, &mut account()).is_empty());
    }

    #[test]
    fn messages_without_an_id_have_a_stable_content_identity() {
        let first = json!({ "from_user_id": "sender", "item_list": [] });
        let same = first.clone();
        let other = json!({ "from_user_id": "other", "item_list": [] });
        assert_eq!(message_identity(&first), message_identity(&same));
        assert_ne!(message_identity(&first), message_identity(&other));
    }

    #[test]
    fn rejects_non_zero_errcode_even_when_ret_is_zero() {
        let response = json!({ "ret": 0, "errcode": 1001, "errmsg": "rejected" });
        assert_eq!(
            check_ret(&response, "sendmessage").unwrap_err(),
            "iLink sendmessage failed: rejected"
        );
    }

    #[test]
    fn recognizes_stale_context_token_responses() {
        assert!(is_stale_session(
            &json!({ "ret": 0, "errcode": -14, "errmsg": "expired" })
        ));
        assert!(is_stale_session(
            &json!({ "ret": -2, "errcode": 0, "errmsg": "unknown error" })
        ));
        assert!(!is_stale_session(
            &json!({ "ret": -2, "errcode": 0, "errmsg": "frequency limit" })
        ));
    }

    #[test]
    fn decodes_both_supported_media_key_shapes() {
        let key = [7_u8; 16];
        assert_eq!(decode_media_key(&STANDARD.encode(key)).unwrap(), key);
        assert_eq!(decode_media_key(&STANDARD.encode(hex(&key))).unwrap(), key);
    }

    #[test]
    fn detects_supported_image_types_and_rejects_unknown_data() {
        assert_eq!(
            detect_image(vec![0xff, 0xd8, 0xff]).unwrap().mime_type,
            "image/jpeg"
        );
        assert_eq!(
            detect_image(b"GIF89a".to_vec()).unwrap().mime_type,
            "image/gif"
        );
        assert_eq!(
            detect_image(b"\0\0\0\0ftypavif".to_vec())
                .unwrap()
                .mime_type,
            "image/avif"
        );
        assert!(detect_image(b"not-an-image".to_vec()).is_err());
    }

    #[test]
    fn strips_only_valid_pkcs7_padding() {
        let mut padded = vec![1, 2, 3, 3, 3, 3];
        strip_pkcs7_if_present(&mut padded);
        assert_eq!(padded, vec![1, 2, 3]);
        let mut plain = vec![1, 2, 3, 2, 3];
        strip_pkcs7_if_present(&mut plain);
        assert_eq!(plain, vec![1, 2, 3, 2, 3]);
    }
}
