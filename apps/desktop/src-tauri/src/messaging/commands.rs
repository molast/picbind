use tauri::State;

use super::{
    models::{
        MessagingEvent, MessagingGatewaySnapshot, MessagingImageUpload, MessagingLoginSession,
        MessagingMessage,
    },
    DesktopMessagingRepository,
};

#[tauri::command]
pub async fn messaging_status(
    messaging: State<'_, DesktopMessagingRepository>,
) -> Result<MessagingGatewaySnapshot, String> {
    Ok(messaging.snapshot())
}

#[tauri::command]
pub async fn messaging_start_login(
    messaging: State<'_, DesktopMessagingRepository>,
) -> Result<MessagingLoginSession, String> {
    messaging.start_login().await
}

#[tauri::command]
pub async fn messaging_login_status(
    messaging: State<'_, DesktopMessagingRepository>,
    session_id: String,
) -> Result<MessagingLoginSession, String> {
    messaging.login_status(&session_id).await
}

#[tauri::command]
pub async fn messaging_connect(
    messaging: State<'_, DesktopMessagingRepository>,
) -> Result<(), String> {
    messaging.connect().await
}

#[tauri::command]
pub async fn messaging_disconnect(
    messaging: State<'_, DesktopMessagingRepository>,
) -> Result<(), String> {
    messaging.disconnect().await
}

#[tauri::command]
pub async fn messaging_send_text(
    messaging: State<'_, DesktopMessagingRepository>,
    message: MessagingMessage,
) -> Result<(), String> {
    messaging.send_text(message).await
}

#[tauri::command]
pub async fn messaging_send_image(
    messaging: State<'_, DesktopMessagingRepository>,
    upload: MessagingImageUpload,
) -> Result<String, String> {
    messaging.send_image(upload).await
}

#[tauri::command]
pub async fn messaging_download_image(
    messaging: State<'_, DesktopMessagingRepository>,
    reference: String,
    fallback_file_id: Option<String>,
) -> Result<Vec<u8>, String> {
    messaging
        .download_image(&reference, fallback_file_id.as_deref())
        .await
}

#[tauri::command]
pub fn messaging_take_events(
    messaging: State<'_, DesktopMessagingRepository>,
) -> Vec<MessagingEvent> {
    messaging.take_events()
}
