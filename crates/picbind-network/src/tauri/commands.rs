use tauri::{
    State,
    ipc::{Channel, InvokeBody, Request, Response},
};

use crate::{
    session::close_peers,
    signaling::{NativeIceCandidate, NativePeerCreateOptions, NativeSessionDescription},
    webrtc::{NativeFrame, NativePeer, NativePeerChannel},
};

use super::{events::event_sink, state::NativeRealtimeState};

const MAXIMUM_TEXT_FRAME_BYTES: usize = 96 * 1024;
const MAXIMUM_BINARY_FRAME_BYTES: usize = 4 * 1024 * 1024;

#[tauri::command]
pub async fn realtime_peer_create(
    options: NativePeerCreateOptions,
    on_event: Channel<Response>,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    let peer = NativePeer::create(options, event_sink(on_event)).await?;
    if let Some(previous) = state.insert(peer)? {
        previous.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn realtime_peer_create_offer(
    session_id: String,
    peer_id: String,
    state: State<'_, NativeRealtimeState>,
) -> Result<NativeSessionDescription, String> {
    state.get(&session_id, &peer_id)?.create_offer().await
}

#[tauri::command]
pub async fn realtime_peer_create_answer(
    session_id: String,
    peer_id: String,
    state: State<'_, NativeRealtimeState>,
) -> Result<NativeSessionDescription, String> {
    state.get(&session_id, &peer_id)?.create_answer().await
}

#[tauri::command]
pub async fn realtime_peer_set_local_description(
    session_id: String,
    peer_id: String,
    value: NativeSessionDescription,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    state
        .get(&session_id, &peer_id)?
        .set_local_description(value)
        .await
}

#[tauri::command]
pub async fn realtime_peer_set_remote_description(
    session_id: String,
    peer_id: String,
    value: NativeSessionDescription,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    state
        .get(&session_id, &peer_id)?
        .set_remote_description(value)
        .await
}

#[tauri::command]
pub async fn realtime_peer_add_ice_candidate(
    session_id: String,
    peer_id: String,
    value: NativeIceCandidate,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    state
        .get(&session_id, &peer_id)?
        .add_ice_candidate(value)
        .await
}

#[tauri::command]
pub async fn realtime_peer_send(
    request: Request<'_>,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    let session_id = header(&request, "x-picbind-session-id")?;
    let peer_id = header(&request, "x-picbind-peer-id")?;
    let channel = NativePeerChannel::parse(&header(&request, "x-picbind-channel")?)
        .ok_or_else(|| "invalid native peer channel".to_owned())?;
    let frame_kind = header(&request, "x-picbind-frame-kind")?;
    let bytes = match request.body() {
        InvokeBody::Raw(value) => value.clone(),
        InvokeBody::Json(_) => return Err("native realtime send requires a raw IPC body".into()),
    };
    let frame = match frame_kind.as_str() {
        "text" if bytes.len() <= MAXIMUM_TEXT_FRAME_BYTES => NativeFrame::Text(
            String::from_utf8(bytes).map_err(|_| "invalid UTF-8 realtime frame".to_owned())?,
        ),
        "binary" if bytes.len() <= MAXIMUM_BINARY_FRAME_BYTES => NativeFrame::Binary(bytes),
        "text" | "binary" => return Err("native realtime frame exceeds its size limit".into()),
        _ => return Err("invalid native realtime frame kind".into()),
    };
    state.get(&session_id, &peer_id)?.send(channel, frame).await
}

#[tauri::command]
pub async fn realtime_peer_buffered_amount(
    session_id: String,
    peer_id: String,
    channel: String,
    state: State<'_, NativeRealtimeState>,
) -> Result<usize, String> {
    let channel = NativePeerChannel::parse(&channel)
        .ok_or_else(|| "invalid native peer channel".to_owned())?;
    Ok(state
        .get(&session_id, &peer_id)?
        .buffered_amount(channel)
        .await)
}

#[tauri::command]
pub async fn realtime_peer_close(
    session_id: String,
    peer_id: String,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    if let Some(peer) = state.remove(&session_id, &peer_id)? {
        peer.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn realtime_session_close(
    session_id: String,
    state: State<'_, NativeRealtimeState>,
) -> Result<(), String> {
    close_peers(state.remove_session(&session_id)?).await;
    Ok(())
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing {name} header"))?
        .to_str()
        .map(str::to_owned)
        .map_err(|_| format!("invalid {name} header"))
}
