use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessagingProviderStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingGatewaySnapshot {
    pub configured: bool,
    pub status: MessagingProviderStatus,
    pub account_id: Option<String>,
    pub user_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MessagingLoginState {
    QrPending,
    Scanned,
    Expired,
    Confirmed,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingLoginSession {
    pub session_id: String,
    pub state: MessagingLoginState,
    pub qr_data_url: Option<String>,
    pub qr_data: Option<String>,
    pub expires_at: u64,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessagingMessageType {
    Text,
    Image,
    File,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingPayload {
    pub text: Option<String>,
    pub file_id: Option<String>,
    pub download_url: Option<String>,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub size: Option<u64>,
    pub expires_at: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagingMessage {
    pub id: String,
    pub channel: String,
    pub sender_id: String,
    pub conversation_id: String,
    pub r#type: MessagingMessageType,
    pub payload: MessagingPayload,
    pub timestamp: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MessagingEvent {
    GatewayStatus(MessagingGatewaySnapshot),
    Message(MessagingMessage),
    Error(String),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MessagingImageUpload {
    pub recipient_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}
