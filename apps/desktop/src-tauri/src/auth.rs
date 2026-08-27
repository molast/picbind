use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::Duration;

const DEFAULT_API_BASE: &str = "https://api.picbind.com/api";
const DESKTOP_AUTH_ORIGIN: &str = "picbind://auth";
const OAUTH_RETURN_TO: &str = "picbind://auth/callback";
pub const OAUTH_DEEP_LINK_EVENT: &str = "picbind:auth-deep-link";
const MAX_AVATAR_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Default)]
pub struct OAuthDeepLinkState {
    pending: Mutex<Option<String>>,
    last_received: Mutex<Option<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    id: String,
    email: Option<String>,
    name: Option<String>,
    avatar: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    authenticated: bool,
    user: Option<AuthUser>,
    #[serde(default)]
    workspaces: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    data: Option<T>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    code: String,
    message: String,
}

#[derive(Serialize)]
struct LoginRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct RegisterRequest<'a> {
    email: &'a str,
    password: &'a str,
    name: Option<&'a str>,
}

fn api_base() -> &'static str {
    option_env!("PICBIND_API_URL").unwrap_or(DEFAULT_API_BASE)
}

fn api_error(error: ApiError) -> String {
    format!("{}:{}", error.code, error.message)
}

fn allowed_avatar_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "avatar_invalid:Invalid avatar URL")?;
    let allowed_host = matches!(
        url.host_str(),
        Some("avatars.githubusercontent.com" | "lh3.googleusercontent.com")
    );
    if url.scheme() != "https"
        || !allowed_host
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("avatar_invalid:Avatar host is not allowed".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn desktop_auth_avatar_data_url(url: String) -> Result<String, String> {
    let url = allowed_avatar_url(&url)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("avatar_unavailable:{error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("avatar_unavailable:{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "avatar_unavailable:Avatar returned {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_AVATAR_BYTES)
    {
        return Err("avatar_too_large:Avatar exceeds 2 MiB".into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        content_type.as_str(),
        "image/gif" | "image/jpeg" | "image/png" | "image/webp"
    ) {
        return Err("avatar_invalid:Avatar response is not a supported image".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("avatar_unavailable:{error}"))?;
    if bytes.len() as u64 > MAX_AVATAR_BYTES {
        return Err("avatar_too_large:Avatar exceeds 2 MiB".into());
    }
    Ok(format!(
        "data:{content_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

async fn post_auth<T: Serialize>(path: &str, body: &T, origin: &str) -> Result<AuthState, String> {
    let response = reqwest::Client::new()
        .post(format!("{}/{}", api_base().trim_end_matches('/'), path))
        .header("origin", origin)
        .json(body)
        .send()
        .await
        .map_err(|error| format!("network_error:{error}"))?;
    let status = response.status();
    let envelope = response
        .json::<ApiEnvelope<AuthState>>()
        .await
        .map_err(|error| format!("invalid_response:{error}"))?;
    if let Some(data) = envelope.data {
        return Ok(data);
    }
    if let Some(error) = envelope.error {
        return Err(api_error(error));
    }
    Err(format!("invalid_response:Authentication returned {status}"))
}

#[tauri::command]
pub async fn desktop_auth_login(email: String, password: String) -> Result<AuthState, String> {
    post_auth(
        "auth/login",
        &LoginRequest {
            email: email.trim(),
            password: &password,
        },
        "https://picbind.com",
    )
    .await
}

#[tauri::command]
pub async fn desktop_auth_register(
    email: String,
    password: String,
    name: Option<String>,
) -> Result<AuthState, String> {
    post_auth(
        "auth/register",
        &RegisterRequest {
            email: email.trim(),
            password: &password,
            name: name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        },
        "https://picbind.com",
    )
    .await
}

fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    command
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("oauth_unavailable:{error}"))
}

fn oauth_deep_link(raw: &str) -> Result<reqwest::Url, String> {
    if raw.len() > 2048 {
        return Err("oauth_invalid_state:OAuth callback is too long".into());
    }
    let url = reqwest::Url::parse(raw)
        .map_err(|_| "oauth_invalid_state:Invalid OAuth callback".to_string())?;
    if url.scheme() != "picbind"
        || url.host_str() != Some("auth")
        || url.port().is_some()
        || url.path() != "/callback"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("oauth_invalid_state:Invalid OAuth callback".into());
    }
    Ok(url)
}

fn oauth_handoff_code(raw: &str) -> Result<String, String> {
    let url = oauth_deep_link(raw)?;
    let result = url
        .query_pairs()
        .find_map(|(key, value)| (key == "auth_result").then(|| value.into_owned()))
        .unwrap_or_default();
    if result != "success" {
        return Err(format!(
            "{}:OAuth login was not completed",
            result.strip_prefix("error:").unwrap_or("oauth_failed")
        ));
    }
    let code = url
        .query_pairs()
        .find_map(|(key, value)| (key == "auth_code").then(|| value.into_owned()))
        .unwrap_or_default();
    if !(43..=128).contains(&code.len())
        || !code
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'_' || value == b'-')
    {
        return Err("oauth_invalid_state:Invalid OAuth handoff code".into());
    }
    Ok(code)
}

pub fn handle_oauth_deep_link(app: &AppHandle, raw: &str) -> bool {
    if oauth_deep_link(raw).is_err() {
        return false;
    }
    if let Some(state) = app.try_state::<OAuthDeepLinkState>() {
        if let Ok(mut last_received) = state.last_received.lock() {
            if last_received.as_deref() == Some(raw) {
                return false;
            }
            *last_received = Some(raw.to_string());
        }
        if let Ok(mut pending) = state.pending.lock() {
            *pending = Some(raw.to_string());
        }
    }
    let _ = app.emit(OAUTH_DEEP_LINK_EVENT, raw);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    true
}

#[tauri::command]
pub async fn desktop_auth_oauth(
    provider: String,
    deep_link: State<'_, OAuthDeepLinkState>,
) -> Result<(), String> {
    if provider != "google" && provider != "github" {
        return Err("oauth_unavailable:Unsupported OAuth provider".into());
    }
    if let Ok(mut pending) = deep_link.pending.lock() {
        pending.take();
    }
    let start_url = format!(
        "{}/auth/oauth/{provider}/start?return_to={}",
        api_base().trim_end_matches('/'),
        urlencoding::encode(OAUTH_RETURN_TO)
    );
    open_system_browser(&start_url)
}

#[tauri::command]
pub async fn desktop_auth_exchange(callback_url: String) -> Result<AuthState, String> {
    let code = oauth_handoff_code(&callback_url)?;
    post_auth(
        "auth/exchange",
        &serde_json::json!({ "code": code }),
        DESKTOP_AUTH_ORIGIN,
    )
    .await
}

#[tauri::command]
pub fn desktop_auth_take_deep_link(
    deep_link: State<'_, OAuthDeepLinkState>,
) -> Result<Option<String>, String> {
    deep_link
        .pending
        .lock()
        .map(|mut pending| pending.take())
        .map_err(|_| "oauth_failed:OAuth callback state is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::{allowed_avatar_url, oauth_deep_link, oauth_handoff_code};

    #[test]
    fn accepts_only_the_picbind_auth_callback() {
        assert!(oauth_deep_link("picbind://auth/callback?auth_result=success").is_ok());
        assert!(oauth_deep_link("picbind://other/callback?auth_result=success").is_err());
        assert!(oauth_deep_link("picbind://auth/other?auth_result=success").is_err());
        assert!(oauth_deep_link("https://auth/callback?auth_result=success").is_err());
        assert!(oauth_deep_link("picbind://auth/callback#code").is_err());
    }

    #[test]
    fn reads_a_valid_one_time_handoff_code() {
        let code = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
        assert_eq!(
            oauth_handoff_code(&format!(
                "picbind://auth/callback?auth_result=success&auth_code={code}"
            )),
            Ok(code.into())
        );
        assert!(
            oauth_handoff_code("picbind://auth/callback?auth_result=error%3Aoauth_cancelled")
                .is_err()
        );
        assert!(
            oauth_handoff_code("picbind://auth/callback?auth_result=success&auth_code=short")
                .is_err()
        );
    }

    #[test]
    fn allows_only_google_and_github_avatar_hosts() {
        assert!(allowed_avatar_url("https://lh3.googleusercontent.com/a/example=s96-c").is_ok());
        assert!(allowed_avatar_url("https://avatars.githubusercontent.com/u/1?v=4").is_ok());
        assert!(allowed_avatar_url("http://lh3.googleusercontent.com/a/example").is_err());
        assert!(allowed_avatar_url("https://lh3.googleusercontent.com.evil.test/a").is_err());
        assert!(allowed_avatar_url("https://example.com/avatar.png").is_err());
    }
}
