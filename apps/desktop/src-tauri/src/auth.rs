use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde::{Deserialize, Serialize};
use tokio::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};

const DEFAULT_API_BASE: &str = "https://api.picbind.com/api";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_OAUTH_REQUEST_BYTES: usize = 8 * 1024;
const MAX_AVATAR_BYTES: u64 = 2 * 1024 * 1024;

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

fn oauth_handoff_code_from_url(url: &reqwest::Url) -> Result<String, String> {
    let mut result = None;
    let mut code = None;
    for (key, value) in url.query_pairs() {
        let destination = match key.as_ref() {
            "auth_result" => &mut result,
            "auth_code" => &mut code,
            _ => continue,
        };
        if destination.replace(value.into_owned()).is_some() {
            return Err("oauth_invalid_state:Duplicate OAuth callback value".into());
        }
    }
    let result = result.unwrap_or_default();
    if result != "success" {
        return Err(format!(
            "{}:OAuth login was not completed",
            result.strip_prefix("error:").unwrap_or("oauth_failed")
        ));
    }
    let code = code.unwrap_or_default();
    if !(43..=128).contains(&code.len())
        || !code
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'_' || value == b'-')
    {
        return Err("oauth_invalid_state:Invalid OAuth handoff code".into());
    }
    Ok(code)
}

fn oauth_request_target(request: &str, expected_port: u16) -> Result<&str, String> {
    let mut lines = request.split("\r\n");
    let mut parts = lines
        .next()
        .ok_or_else(|| "oauth_invalid_state:Invalid OAuth callback".to_string())?
        .split_ascii_whitespace();
    let method = parts.next();
    let target = parts.next();
    let version = parts.next();
    if method != Some("GET") || version != Some("HTTP/1.1") || parts.next().is_some() {
        return Err("oauth_invalid_state:Invalid OAuth callback".into());
    }
    let mut host = None;
    for line in lines.take_while(|line| !line.is_empty()) {
        let Some((name, value)) = line.split_once(':') else {
            return Err("oauth_invalid_state:Invalid OAuth callback".into());
        };
        if name.eq_ignore_ascii_case("host") && host.replace(value.trim()).is_some() {
            return Err("oauth_invalid_state:Invalid OAuth callback".into());
        }
    }
    let expected_host = format!("127.0.0.1:{expected_port}");
    if host != Some(expected_host.as_str()) {
        return Err("oauth_invalid_state:Invalid OAuth callback".into());
    }
    target.ok_or_else(|| "oauth_invalid_state:Invalid OAuth callback".into())
}

fn oauth_loopback_url(raw_target: &str, expected_port: u16) -> Result<reqwest::Url, String> {
    if raw_target.len() > 2048 || !raw_target.starts_with('/') || raw_target.starts_with("//") {
        return Err("oauth_invalid_state:Invalid OAuth callback".into());
    }
    let base = reqwest::Url::parse(&format!("http://127.0.0.1:{expected_port}/"))
        .map_err(|_| "oauth_invalid_state:Invalid OAuth callback".to_string())?;
    let url = base
        .join(raw_target)
        .map_err(|_| "oauth_invalid_state:Invalid OAuth callback".to_string())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(expected_port)
        || url.path() != "/picbind/oauth/callback"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("oauth_invalid_state:Invalid OAuth callback".into());
    }
    Ok(url)
}

async fn receive_oauth_callback(
    listener: TcpListener,
    expected_port: u16,
) -> Result<String, String> {
    let (mut stream, _) = timeout(OAUTH_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "oauth_cancelled:OAuth login timed out".to_string())?
        .map_err(|error| format!("oauth_failed:{error}"))?;
    let mut request = Vec::with_capacity(1024);
    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
        if request.len() >= MAX_OAUTH_REQUEST_BYTES {
            return Err("oauth_invalid_state:OAuth callback is too long".into());
        }
        let mut chunk = [0_u8; 1024];
        let length = timeout(Duration::from_secs(5), stream.read(&mut chunk))
            .await
            .map_err(|_| "oauth_failed:OAuth callback timed out".to_string())?
            .map_err(|error| format!("oauth_failed:{error}"))?;
        if length == 0 {
            return Err("oauth_invalid_state:Incomplete OAuth callback".into());
        }
        let remaining = MAX_OAUTH_REQUEST_BYTES - request.len();
        if length > remaining {
            return Err("oauth_invalid_state:OAuth callback is too long".into());
        }
        request.extend_from_slice(&chunk[..length]);
    }
    let request = std::str::from_utf8(&request)
        .map_err(|_| "oauth_invalid_state:Invalid OAuth callback".to_string())?;
    let target = oauth_request_target(request, expected_port)?;
    let url = oauth_loopback_url(target, expected_port)?;
    let code = oauth_handoff_code_from_url(&url);
    let message = if code.is_ok() {
        "PicBind login completed. You can close this window and return to the app."
    } else {
        "PicBind login was not completed. You can close this window and try again."
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>PicBind</title><style>body{{font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f7fb;color:#172033}}main{{text-align:center;padding:32px}}h1{{font-size:24px}}</style><main><h1>PicBind</h1><p>{message}</p></main>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("oauth_failed:{error}"))?;
    code
}

#[tauri::command]
pub async fn desktop_auth_oauth(provider: String) -> Result<AuthState, String> {
    if provider != "google" && provider != "github" {
        return Err("oauth_unavailable:Unsupported OAuth provider".into());
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("oauth_unavailable:{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("oauth_unavailable:{error}"))?
        .port();
    let return_to = format!("http://127.0.0.1:{port}/picbind/oauth/callback");
    let start_url = format!(
        "{}/auth/oauth/{provider}/start?return_to={}",
        api_base().trim_end_matches('/'),
        urlencoding::encode(&return_to)
    );
    open_system_browser(&start_url)?;
    let code = receive_oauth_callback(listener, port).await?;
    post_auth(
        "auth/exchange",
        &serde_json::json!({ "code": code }),
        &format!("http://127.0.0.1:{port}"),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        allowed_avatar_url, oauth_handoff_code_from_url, oauth_loopback_url, oauth_request_target,
    };

    #[test]
    fn reads_a_valid_one_time_handoff_code() {
        let code = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
        let callback = |query: &str| {
            reqwest::Url::parse(&format!(
                "http://127.0.0.1:43125/picbind/oauth/callback?{query}"
            ))
            .expect("valid callback URL")
        };
        assert_eq!(
            oauth_handoff_code_from_url(&callback(&format!(
                "auth_result=success&auth_code={code}"
            ))),
            Ok(code.into())
        );
        assert!(
            oauth_handoff_code_from_url(&callback("auth_result=error%3Aoauth_cancelled")).is_err()
        );
        assert!(
            oauth_handoff_code_from_url(&callback("auth_result=success&auth_code=short")).is_err()
        );
        assert!(
            oauth_handoff_code_from_url(&callback(&format!(
                "auth_result=success&auth_code={code}&auth_code={code}"
            )))
            .is_err()
        );
    }

    #[test]
    fn accepts_only_the_expected_loopback_callback() {
        let code = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
        let target = format!("/picbind/oauth/callback?auth_result=success&auth_code={code}");
        let url = oauth_loopback_url(&target, 43125).expect("valid loopback callback");
        assert_eq!(url.origin().ascii_serialization(), "http://127.0.0.1:43125");
        assert!(oauth_loopback_url("/other?auth_result=success", 43125).is_err());
        assert!(oauth_loopback_url("//example.com/picbind/oauth/callback", 43125).is_err());
        assert!(oauth_loopback_url("http://example.com/picbind/oauth/callback", 43125).is_err());
        assert!(oauth_loopback_url("/picbind/oauth/callback#fragment", 43125).is_err());
    }

    #[test]
    fn parses_only_get_oauth_http_requests() {
        assert_eq!(
            oauth_request_target(
                "GET /picbind/oauth/callback?auth_result=success HTTP/1.1\r\nHost: 127.0.0.1:43125\r\n\r\n",
                43125,
            ),
            Ok("/picbind/oauth/callback?auth_result=success")
        );
        assert!(
            oauth_request_target(
                "GET /picbind/oauth/callback HTTP/1.1\r\nHost: 127.0.0.1:43126\r\n\r\n",
                43125,
            )
            .is_err()
        );
        assert!(
            oauth_request_target(
                "POST /picbind/oauth/callback HTTP/1.1\r\nHost: 127.0.0.1:43125\r\n\r\n",
                43125,
            )
            .is_err()
        );
        assert!(
            oauth_request_target(
                "GET /picbind/oauth/callback FTP/1.0\r\nHost: 127.0.0.1:43125\r\n\r\n",
                43125,
            )
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
