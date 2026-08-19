use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::{timeout, Duration},
};

const DEFAULT_API_BASE: &str = "https://api.picbind.com/api";
const OAUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);

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

fn query_value(target: &str, key: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    urlencoding::decode(query.split('&').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        (name == key).then_some(value)
    })?)
    .ok()
    .map(|value| value.into_owned())
}

async fn receive_oauth_callback(listener: TcpListener) -> Result<(String, String), String> {
    let (mut stream, _) = timeout(OAUTH_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "oauth_cancelled:OAuth login timed out".to_string())?
        .map_err(|error| format!("oauth_failed:{error}"))?;
    let mut request = vec![0_u8; 8192];
    let length = timeout(Duration::from_secs(5), stream.read(&mut request))
        .await
        .map_err(|_| "oauth_failed:OAuth callback timed out".to_string())?
        .map_err(|error| format!("oauth_failed:{error}"))?;
    let request = String::from_utf8_lossy(&request[..length]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .filter(|target| target.starts_with("/picbind/oauth/callback?"))
        .ok_or_else(|| "oauth_invalid_state:Invalid OAuth callback".to_string())?;
    let result = query_value(target, "auth_result").unwrap_or_default();
    let code = query_value(target, "auth_code").unwrap_or_default();
    let success = result == "success" && !code.is_empty();
    let message = if success {
        "PicBind login completed. You can close this window and return to the app."
    } else {
        "PicBind login was not completed. You can close this window and try again."
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>PicBind</title><style>body{{font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f7fb;color:#172033}}main{{text-align:center;padding:32px}}h1{{font-size:24px}}</style><main><h1>PicBind</h1><p>{message}</p></main>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("oauth_failed:{error}"))?;
    if success {
        Ok((code, result))
    } else {
        Err(result
            .strip_prefix("error:")
            .unwrap_or("oauth_failed")
            .to_string())
    }
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
    let (code, _) = receive_oauth_callback(listener).await?;
    post_auth(
        "auth/exchange",
        &serde_json::json!({ "code": code }),
        &format!("http://127.0.0.1:{port}"),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::query_value;

    #[test]
    fn reads_and_decodes_oauth_callback_values() {
        let target = "/picbind/oauth/callback?auth_result=success&auth_code=a%2Bb";
        assert_eq!(
            query_value(target, "auth_result").as_deref(),
            Some("success")
        );
        assert_eq!(query_value(target, "auth_code").as_deref(), Some("a+b"));
        assert_eq!(query_value(target, "missing"), None);
    }
}
