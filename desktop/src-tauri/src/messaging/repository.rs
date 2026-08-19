use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use super::{
    ilink::{self, Account, QrCode},
    models::{
        MessagingEvent, MessagingGatewaySnapshot, MessagingImageUpload, MessagingLoginSession,
        MessagingLoginState, MessagingMessage, MessagingMessageType, MessagingProviderStatus,
    },
};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone)]
pub struct DesktopMessagingRepository {
    poll_client: reqwest::Client,
    api_client: reqwest::Client,
    account_path: PathBuf,
    account: Arc<Mutex<Option<Account>>>,
    gateway: Arc<Mutex<MessagingGatewaySnapshot>>,
    login_sessions: Arc<Mutex<HashMap<String, LocalLoginSession>>>,
    events: Arc<Mutex<Vec<MessagingEvent>>>,
    poller: Arc<Mutex<Option<mpsc::UnboundedSender<PollerCommand>>>>,
    media: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

#[derive(Clone)]
struct LocalLoginSession {
    qrcode: String,
    qr_data: String,
    base_url: String,
    state: MessagingLoginState,
    expires_at: u64,
    error: Option<String>,
}

enum PollerCommand {
    Stop { done: oneshot::Sender<()> },
}

impl DesktopMessagingRepository {
    pub fn new(
        poll_client: reqwest::Client,
        api_client: reqwest::Client,
        root: PathBuf,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let account_path = root.join("weixin-account.json");
        let account = read_account(&account_path)?;
        let gateway = MessagingGatewaySnapshot {
            configured: account.is_some(),
            status: MessagingProviderStatus::Disconnected,
            account_id: account.as_ref().map(|account| account.account_id.clone()),
            user_id: account.as_ref().and_then(|account| account.user_id.clone()),
            error: None,
        };
        Ok(Self {
            poll_client,
            api_client,
            account_path,
            account: Arc::new(Mutex::new(account)),
            gateway: Arc::new(Mutex::new(gateway)),
            login_sessions: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(Mutex::new(Vec::new())),
            poller: Arc::new(Mutex::new(None)),
            media: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    fn account(&self) -> Result<Account, String> {
        self.account
            .lock()
            .map_err(|_| "Weixin account state is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "Weixin has not been configured".to_string())
    }

    pub fn snapshot(&self) -> MessagingGatewaySnapshot {
        self.gateway
            .lock()
            .map(|gateway| gateway.clone())
            .unwrap_or_default()
    }

    async fn start_poller(&self) -> Result<(), String> {
        if self
            .poller
            .lock()
            .ok()
            .and_then(|poller| poller.clone())
            .is_some()
        {
            return Ok(());
        }
        let account = self.account()?;
        let account_id = account.account_id.clone();
        let user_id = account.user_id.clone();
        let (sender, receiver) = mpsc::unbounded_channel();
        if let Ok(mut poller) = self.poller.lock() {
            *poller = Some(sender);
        }
        tokio::spawn(run_poller(
            self.poll_client.clone(),
            self.account_path.clone(),
            self.account.clone(),
            self.gateway.clone(),
            account,
            self.events.clone(),
            self.poller.clone(),
            self.media.clone(),
            receiver,
        ));
        // Starting the poll task means the gateway is ready for outbound API
        // calls. A quiet long poll may not return for roughly 30 seconds.
        let snapshot = MessagingGatewaySnapshot {
            configured: true,
            status: MessagingProviderStatus::Connected,
            account_id: Some(account_id),
            user_id,
            error: None,
        };
        set_gateway(&self.gateway, snapshot.clone());
        push_event(&self.events, MessagingEvent::GatewayStatus(snapshot));
        Ok(())
    }

    async fn stop_poller(&self) {
        let sender = self.poller.lock().ok().and_then(|mut poller| poller.take());
        if let Some(sender) = sender {
            let (done, done_rx) = oneshot::channel();
            let _ = sender.send(PollerCommand::Stop { done });
            let _ = tokio::time::timeout(Duration::from_secs(2), done_rx).await;
        }
        let account = self.account.lock().ok().and_then(|account| account.clone());
        set_gateway(
            &self.gateway,
            MessagingGatewaySnapshot {
                configured: account.is_some(),
                status: MessagingProviderStatus::Disconnected,
                account_id: account.as_ref().map(|account| account.account_id.clone()),
                user_id: account.and_then(|account| account.user_id),
                error: None,
            },
        );
    }
}

impl DesktopMessagingRepository {
    pub async fn start_login(&self) -> Result<MessagingLoginSession, String> {
        self.stop_poller().await;
        let QrCode { value, scan_data } = ilink::request_qr_code(&self.api_client).await?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let expires_at = now_millis().saturating_add(8 * 60 * 1000);
        self.login_sessions
            .lock()
            .map_err(|_| "Weixin login state is unavailable".to_string())?
            .insert(
                session_id.clone(),
                LocalLoginSession {
                    qrcode: value,
                    qr_data: scan_data.clone(),
                    base_url: "https://ilinkai.weixin.qq.com".into(),
                    state: MessagingLoginState::QrPending,
                    expires_at,
                    error: None,
                },
            );
        Ok(MessagingLoginSession {
            session_id,
            state: MessagingLoginState::QrPending,
            qr_data_url: None,
            qr_data: Some(scan_data),
            expires_at,
            error: None,
        })
    }

    pub async fn login_status(&self, session_id: &str) -> Result<MessagingLoginSession, String> {
        let mut session = self
            .login_sessions
            .lock()
            .map_err(|_| "Weixin login state is unavailable".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "Login session not found".to_string())?;
        if now_millis() >= session.expires_at {
            session.state = MessagingLoginState::Expired;
        }
        if matches!(
            session.state,
            MessagingLoginState::QrPending | MessagingLoginState::Scanned
        ) {
            match ilink::request_qr_status(&self.api_client, &session.base_url, &session.qrcode)
                .await
            {
                Ok(result) if result.status == "scaned_but_redirect" => {
                    if let Some(host) = result.redirect_host {
                        session.base_url = if host.starts_with("http") {
                            host
                        } else {
                            format!("https://{host}")
                        };
                    }
                    session.state = MessagingLoginState::Scanned;
                }
                Ok(result) if result.status == "scaned" => {
                    session.state = MessagingLoginState::Scanned
                }
                Ok(result) if result.status == "expired" => {
                    session.state = MessagingLoginState::Expired
                }
                Ok(result) if result.status == "confirmed" => {
                    let account_id = result
                        .account_id
                        .ok_or("iLink confirmation did not return an account ID")?;
                    let token = result
                        .token
                        .ok_or("iLink confirmation did not return credentials")?;
                    let user_id = result.user_id;
                    let account = Account {
                        account_id: account_id.clone(),
                        token,
                        base_url: result.base_url.unwrap_or_else(|| session.base_url.clone()),
                        user_id: user_id.clone(),
                        sync_buffer: String::new(),
                        context_tokens: HashMap::new(),
                    };
                    write_account(&self.account_path, &account)?;
                    *self
                        .account
                        .lock()
                        .map_err(|_| "Weixin account state is unavailable".to_string())? =
                        Some(account);
                    set_gateway(
                        &self.gateway,
                        MessagingGatewaySnapshot {
                            configured: true,
                            status: MessagingProviderStatus::Disconnected,
                            account_id: Some(account_id),
                            user_id,
                            error: None,
                        },
                    );
                    session.state = MessagingLoginState::Confirmed;
                }
                Ok(_) => {}
                Err(error) => {
                    session.state = MessagingLoginState::Error;
                    session.error = Some(error);
                }
            }
        }
        let output = public_login(session_id, &session);
        if matches!(
            session.state,
            MessagingLoginState::Expired | MessagingLoginState::Confirmed
        ) {
            self.login_sessions
                .lock()
                .ok()
                .map(|mut sessions| sessions.remove(session_id));
        } else if let Ok(mut sessions) = self.login_sessions.lock() {
            sessions.insert(session_id.to_string(), session);
        }
        Ok(output)
    }

    pub async fn connect(&self) -> Result<(), String> {
        self.start_poller().await
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        self.stop_poller().await;
        Ok(())
    }

    pub async fn send_text(&self, message: MessagingMessage) -> Result<(), String> {
        let text = message
            .payload
            .text
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .ok_or("Message text is required")?;
        let account = self.account()?;
        ilink::send_text(&self.api_client, &account, &message.conversation_id, text).await?;
        Ok(())
    }

    pub async fn send_image(&self, upload: MessagingImageUpload) -> Result<String, String> {
        let account = self.account()?;
        ilink::send_image(
            &self.api_client,
            &account,
            &upload.recipient_id,
            &upload.mime_type,
            &upload.bytes,
        )
        .await
    }

    pub async fn download_image(
        &self,
        reference: &str,
        fallback_file_id: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let key = fallback_file_id.unwrap_or(reference);
        self.media
            .lock()
            .map_err(|_| "Weixin media state is unavailable".to_string())?
            .remove(key)
            .ok_or_else(|| "Weixin image is no longer available".to_string())
    }

    pub fn take_events(&self) -> Vec<MessagingEvent> {
        self.events
            .lock()
            .map(|mut events| std::mem::take(&mut *events))
            .unwrap_or_default()
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_poller(
    client: reqwest::Client,
    account_path: PathBuf,
    account_slot: Arc<Mutex<Option<Account>>>,
    gateway: Arc<Mutex<MessagingGatewaySnapshot>>,
    mut account: Account,
    events: Arc<Mutex<Vec<MessagingEvent>>>,
    poller_slot: Arc<Mutex<Option<mpsc::UnboundedSender<PollerCommand>>>>,
    media: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    mut commands: mpsc::UnboundedReceiver<PollerCommand>,
) {
    let mut seen = HashSet::<String>::new();
    let mut failures = 0_u32;
    let mut stopped = None;
    let mut long_poll_timeout = Duration::from_secs(35);
    loop {
        let poll = ilink::get_updates(&client, &account, long_poll_timeout);
        tokio::select! {
            command = commands.recv() => {
                if let Some(PollerCommand::Stop { done }) = command { stopped = Some(done); }
                break;
            }
            result = poll => match result {
                Ok(batch) => {
                    failures = 0;
                    if let Some(timeout) = batch.long_poll_timeout {
                        long_poll_timeout = timeout.clamp(
                            Duration::from_secs(5),
                            Duration::from_secs(60),
                        );
                    }
                    if !batch.sync_buffer.is_empty() { account.sync_buffer = batch.sync_buffer; }
                    for raw in batch.messages {
                        let source_id = ilink::message_identity(&raw);
                        for (index, item) in ilink::image_items(&raw).into_iter().enumerate() {
                            if !seen.insert(format!("{source_id}-image-{index}")) {
                                continue;
                            }
                            let media_id = format!("{source_id}-{index}");
                            match ilink::receive_image(&client, &item).await {
                                Ok(image) => {
                                    let image_size = image.bytes.len() as u64;
                                    if let Ok(mut map) = media.lock() { map.insert(media_id.clone(), image.bytes); }
                                    if let Some(message) = ilink::normalize_message(&raw, &mut account).into_iter().find(|message| message.id.ends_with(&format!("image-{index}"))) {
                                        let mut message = message;
                                        message.payload.file_id = Some(media_id.clone());
                                        message.payload.download_url = Some(media_id);
                                        message.payload.file_name = Some(image.file_name);
                                        message.payload.mime_type = Some(image.mime_type);
                                        message.payload.size = Some(image_size);
                                        push_event(&events, MessagingEvent::Message(message));
                                    }
                                }
                                Err(error) => push_event(&events, MessagingEvent::Error(error)),
                            }
                        }
                        for message in ilink::normalize_message(&raw, &mut account).into_iter().filter(|message| message.r#type != MessagingMessageType::Image) {
                            if seen.insert(message.id.clone()) { push_event(&events, MessagingEvent::Message(message)); }
                        }
                    }
                    let _ = write_account(&account_path, &account);
                    if let Ok(mut slot) = account_slot.lock() { *slot = Some(account.clone()); }
                    let snapshot = MessagingGatewaySnapshot { configured: true, status: MessagingProviderStatus::Connected, account_id: Some(account.account_id.clone()), user_id: account.user_id.clone(), error: None };
                    set_gateway(&gateway, snapshot.clone());
                    push_event(&events, MessagingEvent::GatewayStatus(snapshot));
                }
                Err(error) => {
                    failures = failures.saturating_add(1);
                    let expired = error.to_lowercase().contains("session expired");
                    if expired {
                        let _ = std::fs::remove_file(&account_path);
                        if let Ok(mut slot) = account_slot.lock() { *slot = None; }
                    }
                    let snapshot = MessagingGatewaySnapshot { configured: !expired, status: MessagingProviderStatus::Error, account_id: (!expired).then(|| account.account_id.clone()), user_id: (!expired).then(|| account.user_id.clone()).flatten(), error: Some(error.clone()) };
                    set_gateway(&gateway, snapshot.clone());
                    push_event(&events, MessagingEvent::GatewayStatus(snapshot));
                    push_event(&events, MessagingEvent::Error(error.clone()));
                    if expired { break; }
                    tokio::time::sleep(Duration::from_secs(if failures >= 3 { 30 } else { 2 })).await;
                }
            }
        }
    }
    if let Ok(mut poller) = poller_slot.lock() {
        *poller = None;
    }
    if let Some(done) = stopped {
        let _ = done.send(());
    }
}

fn public_login(session_id: &str, session: &LocalLoginSession) -> MessagingLoginSession {
    MessagingLoginSession {
        session_id: session_id.into(),
        state: session.state,
        qr_data_url: None,
        qr_data: Some(session.qr_data.clone()),
        expires_at: session.expires_at,
        error: session.error.clone(),
    }
}

fn now_millis() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}
fn read_account(path: &Path) -> Result<Option<Account>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("Invalid Weixin account file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
fn write_account(path: &Path, account: &Account) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec(account).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::{fs::OpenOptions, os::unix::fs::OpenOptionsExt};
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}
fn push_event(events: &Arc<Mutex<Vec<MessagingEvent>>>, event: MessagingEvent) {
    if let Ok(mut events) = events.lock() {
        events.push(event);
    }
}
fn set_gateway(gateway: &Arc<Mutex<MessagingGatewaySnapshot>>, snapshot: MessagingGatewaySnapshot) {
    if let Ok(mut gateway) = gateway.lock() {
        *gateway = snapshot;
    }
}
