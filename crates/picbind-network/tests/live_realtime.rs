#![cfg(feature = "native-webrtc")]

use std::{error::Error, sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use picbind_network::{
    signaling::{
        NativeIceCandidate, NativeIceServer, NativePeerCreateOptions, NativeSessionDescription,
    },
    webrtc::{NativeFrame, NativePeer, NativePeerChannel, NativePeerEvent, NativePeerEventKind},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        Message,
        client::IntoClientRequest,
        http::{HeaderValue, header::ORIGIN},
    },
};
use uuid::Uuid;

const API_ORIGIN: &str = "https://api.picbind.com";
const DESKTOP_ORIGIN: &str = "tauri://localhost";
const LIVE_TEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    data: T,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RealtimeTicket {
    ticket: String,
    workspace_id: String,
    ice_servers: Vec<NativeIceServer>,
}

#[derive(Default)]
struct ProbeState {
    connected: bool,
    websocket_acknowledged: bool,
    remote_description_set: bool,
    pending_candidates: Vec<NativeIceCandidate>,
    connection_connected: bool,
    control_open: bool,
    bulk_open: bool,
    control_probe_sent: bool,
    control_probe_acknowledged: bool,
    binary_probe_sent: bool,
    binary_probe_acknowledged: bool,
    local_candidates: usize,
    remote_candidates: usize,
}

impl ProbeState {
    fn rtc_ready(&self) -> bool {
        self.connection_connected && self.control_open && self.bulk_open
    }

    fn complete(&self) -> bool {
        self.connected
            && self.websocket_acknowledged
            && self.rtc_ready()
            && self.control_probe_acknowledged
            && self.binary_probe_acknowledged
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a live Web owner and PICBIND_REALTIME_SHARE_ID"]
async fn web_owner_and_native_collaborator_exchange_websocket_and_rtc_frames()
-> Result<(), Box<dyn Error>> {
    let share_id = std::env::var("PICBIND_REALTIME_SHARE_ID")
        .map_err(|_| "PICBIND_REALTIME_SHARE_ID is required")?;
    let client_id = format!("native-probe-{}", Uuid::new_v4().simple());
    let ticket = request_ticket(&share_id, &client_id).await?;
    println!("ticket: ok (workspace {})", ticket.workspace_id);

    let socket_url = format!(
        "wss://api.picbind.com/api/workspaces/{}/realtime-v2?ticket={}",
        ticket.workspace_id, ticket.ticket,
    );
    let mut request = socket_url.into_client_request()?;
    request
        .headers_mut()
        .insert(ORIGIN, HeaderValue::from_static(DESKTOP_ORIGIN));
    let (socket, response) = connect_async(request).await?;
    if response.status() != 101 {
        return Err(format!("WebSocket upgrade returned {}", response.status()).into());
    }
    println!("websocket: upgraded");

    let (mut socket_writer, mut socket_reader) = socket.split();
    let (native_event_tx, mut native_event_rx) = mpsc::unbounded_channel::<NativePeerEvent>();
    let peer = NativePeer::create(
        NativePeerCreateOptions {
            session_id: format!("live-{}", Uuid::new_v4().simple()),
            peer_id: "owner".into(),
            ice_servers: ticket.ice_servers,
            initiator: true,
        },
        Arc::new(move |event| {
            let _ = native_event_tx.send(event);
        }),
    )
    .await
    .map_err(|error| format!("native peer creation failed: {error}"))?;

    let websocket_event_id = format!("ws-{}", Uuid::new_v4().simple());
    let control_probe_id = format!("control-{}", Uuid::new_v4().simple());
    let binary_event_id = format!("binary-{}", Uuid::new_v4().simple());
    let mut state = ProbeState::default();

    let result = tokio::time::timeout(LIVE_TEST_TIMEOUT, async {
        loop {
            tokio::select! {
                socket_message = socket_reader.next() => {
                    let socket_message = socket_message
                        .ok_or("WebSocket closed before the live probe completed")??;
                    match socket_message {
                        Message::Text(text) => {
                            let message: Value = serde_json::from_str(&text)?;
                            handle_socket_message(
                                &message,
                                &peer,
                                &mut socket_writer,
                                &mut state,
                                &websocket_event_id,
                            ).await?;

                            if message.get("type").and_then(Value::as_str) == Some("connected") {
                                let role = message.get("role").and_then(Value::as_str);
                                if role != Some("collaborator") {
                                    return Err(format!("expected collaborator role, received {role:?}").into());
                                }
                                if message.get("ownerOnline").and_then(Value::as_bool) != Some(true) {
                                    return Err("Web owner is not online".into());
                                }
                                state.connected = true;
                                println!("websocket: connected as collaborator; owner online");

                                send_json(&mut socket_writer, websocket_probe(&websocket_event_id)).await?;
                                let offer = peer.create_offer().await.map_err(native_error)?;
                                peer.set_local_description(offer.clone()).await.map_err(native_error)?;
                                send_json(&mut socket_writer, json!({
                                    "type": "webrtcOffer",
                                    "targetRole": "owner",
                                    "description": offer,
                                })).await?;
                                println!("signaling: native offer sent");
                            }
                        }
                        Message::Ping(bytes) => socket_writer.send(Message::Pong(bytes)).await?,
                        Message::Close(frame) => {
                            return Err(format!("WebSocket closed early: {frame:?}").into());
                        }
                        _ => {}
                    }
                }
                native_event = native_event_rx.recv() => {
                    let native_event = native_event.ok_or("native peer event stream closed")?;
                    handle_native_event(
                        native_event,
                        &peer,
                        &mut socket_writer,
                        &mut state,
                        &control_probe_id,
                        &binary_event_id,
                    ).await?;
                }
            }

            if state.rtc_ready() && !state.control_probe_sent {
                peer.send(
                    NativePeerChannel::Control,
                    NativeFrame::Text(json!({
                        "type": "rtcProbe",
                        "probeId": control_probe_id,
                    }).to_string()),
                ).await.map_err(native_error)?;
                state.control_probe_sent = true;
                println!("rtc control: outbound probe sent");
            }
            if state.control_probe_acknowledged && !state.binary_probe_sent {
                peer.send(
                    NativePeerChannel::Bulk,
                    NativeFrame::Binary(binary_probe(&binary_event_id)?),
                ).await.map_err(native_error)?;
                state.binary_probe_sent = true;
                println!("rtc bulk: binary probe sent");
            }
            if state.complete() {
                return Ok::<(), Box<dyn Error>>(());
            }
        }
    }).await;

    let _ = socket_writer.send(Message::Close(None)).await;
    peer.close().await;
    result.map_err(|_| {
        format!(
            "live realtime probe timed out (local candidates: {}, remote candidates: {}, remote description: {}, connection: {}, control: {}, bulk: {})",
            state.local_candidates,
            state.remote_candidates,
            state.remote_description_set,
            state.connection_connected,
            state.control_open,
            state.bulk_open,
        )
    })??;
    println!("result: WebSocket + native RTC control/bulk passed");
    Ok(())
}

async fn request_ticket(share_id: &str, client_id: &str) -> Result<RealtimeTicket, Box<dyn Error>> {
    let response = reqwest::Client::new()
        .post(format!(
            "{API_ORIGIN}/api/workspace-links/{share_id}/realtime-ticket"
        ))
        .header(ORIGIN, DESKTOP_ORIGIN)
        .json(&json!({ "clientId": client_id }))
        .send()
        .await?;
    let status = response.status();
    let bytes = response.bytes().await?;
    if !status.is_success() {
        return Err(format!(
            "ticket request failed ({status}): {}",
            String::from_utf8_lossy(&bytes),
        )
        .into());
    }
    Ok(serde_json::from_slice::<ApiEnvelope<RealtimeTicket>>(&bytes)?.data)
}

async fn handle_socket_message<S>(
    message: &Value,
    peer: &Arc<NativePeer>,
    socket_writer: &mut S,
    state: &mut ProbeState,
    websocket_event_id: &str,
) -> Result<(), Box<dyn Error>>
where
    S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    match message.get("type").and_then(Value::as_str) {
        Some("eventAck")
            if message.get("eventId").and_then(Value::as_str) == Some(websocket_event_id) =>
        {
            state.websocket_acknowledged = true;
            println!("websocket: reliable relay acknowledged");
        }
        Some("webrtcAnswer") => {
            let description: NativeSessionDescription = serde_json::from_value(
                message
                    .get("description")
                    .cloned()
                    .ok_or("answer description is missing")?,
            )?;
            peer.set_remote_description(description)
                .await
                .map_err(native_error)?;
            state.remote_description_set = true;
            for candidate in state.pending_candidates.drain(..) {
                peer.add_ice_candidate(candidate)
                    .await
                    .map_err(native_error)?;
            }
            println!("signaling: browser answer applied");
        }
        Some("webrtcIceCandidate") => {
            let candidate: NativeIceCandidate = serde_json::from_value(
                message
                    .get("candidate")
                    .cloned()
                    .ok_or("ICE candidate is missing")?,
            )?;
            state.remote_candidates += 1;
            println!(
                "signaling: browser ICE candidate {} ({})",
                state.remote_candidates,
                candidate_kind(&candidate.candidate),
            );
            if state.remote_description_set {
                peer.add_ice_candidate(candidate)
                    .await
                    .map_err(native_error)?;
            } else if state.pending_candidates.len() < 256 {
                state.pending_candidates.push(candidate);
            }
        }
        Some("transportReady") => {
            if let Some(epoch) = message.get("transportEpoch").and_then(Value::as_u64) {
                send_json(
                    socket_writer,
                    json!({
                        "type": "transportReady",
                        "transportEpoch": epoch,
                        "transport": "webRtcDataChannel",
                        "targetRole": "owner",
                    }),
                )
                .await?;
            }
        }
        _ => {}
    }
    Ok(())
}

async fn handle_native_event<S>(
    event: NativePeerEvent,
    peer: &Arc<NativePeer>,
    socket_writer: &mut S,
    state: &mut ProbeState,
    control_probe_id: &str,
    binary_event_id: &str,
) -> Result<(), Box<dyn Error>>
where
    S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    match event.kind {
        NativePeerEventKind::IceCandidate(candidate) => {
            state.local_candidates += 1;
            println!(
                "signaling: native ICE candidate {} ({})",
                state.local_candidates,
                candidate_kind(&candidate.candidate),
            );
            send_json(
                socket_writer,
                json!({
                    "type": "webrtcIceCandidate",
                    "targetRole": "owner",
                    "candidate": candidate,
                }),
            )
            .await?;
        }
        NativePeerEventKind::ConnectionState(value) => {
            println!("rtc connection: {value}");
            state.connection_connected = value == "connected";
            if matches!(value.as_str(), "failed" | "closed") && !state.complete() {
                return Err(format!("native RTC connection entered {value}").into());
            }
        }
        NativePeerEventKind::ChannelState {
            channel,
            state: value,
        } => {
            println!("rtc {} channel: {value}", channel.as_str());
            let open = value == "open";
            match channel {
                NativePeerChannel::Control => state.control_open = open,
                NativePeerChannel::Bulk => state.bulk_open = open,
            }
        }
        NativePeerEventKind::Message {
            channel: NativePeerChannel::Control,
            frame: NativeFrame::Text(text),
        } => {
            let message: Value = serde_json::from_str(&text)?;
            match message.get("type").and_then(Value::as_str) {
                Some("rtcProbe") => {
                    if let Some(probe_id) = message.get("probeId").and_then(Value::as_str) {
                        peer.send(
                            NativePeerChannel::Control,
                            NativeFrame::Text(
                                json!({
                                    "type": "rtcProbeAck",
                                    "probeId": probe_id,
                                })
                                .to_string(),
                            ),
                        )
                        .await
                        .map_err(native_error)?;
                    }
                }
                Some("rtcProbeAck")
                    if message.get("probeId").and_then(Value::as_str) == Some(control_probe_id) =>
                {
                    state.control_probe_acknowledged = true;
                    println!("rtc control: bidirectional probe acknowledged");
                }
                Some("eventAck")
                    if message.get("eventId").and_then(Value::as_str) == Some(binary_event_id) =>
                {
                    state.binary_probe_acknowledged = true;
                    println!("rtc bulk: binary probe acknowledged over control");
                }
                Some("transportReady") => {
                    if let Some(epoch) = message.get("transportEpoch").and_then(Value::as_u64) {
                        peer.send(
                            NativePeerChannel::Control,
                            NativeFrame::Text(
                                json!({
                                    "type": "transportReady",
                                    "transportEpoch": epoch,
                                    "transport": "webRtcDataChannel",
                                    "targetRole": "owner",
                                })
                                .to_string(),
                            ),
                        )
                        .await
                        .map_err(native_error)?;
                    }
                }
                _ => {}
            }
        }
        NativePeerEventKind::Message { .. } => {}
        NativePeerEventKind::Error(error) => return Err(error.into()),
    }
    Ok(())
}

fn websocket_probe(event_id: &str) -> Value {
    json!({
        "type": "workspaceRelay",
        "version": 1,
        "route": "owner",
        "delivery": "reliable",
        "event": {
            "eventId": event_id,
            "sequence": 1,
            "timestamp": 0,
            "dataClass": "collaborationEvent",
            "reliability": "reliable",
            "streamId": "owner",
            "senderId": "native-live-probe",
            "senderName": "Native live probe",
            "senderRole": "collaborator",
            "type": "nativeLiveWebSocketProbe"
        }
    })
}

fn binary_probe(event_id: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    let header = serde_json::to_vec(&json!({
        "route": "owner",
        "delivery": "reliable",
        "event": {
            "eventId": event_id,
            "sequence": 1,
            "timestamp": 0,
            "dataClass": "sourceOrCommit",
            "reliability": "reliable",
            "streamId": "owner",
            "senderId": "native-live-probe",
            "senderName": "Native live probe",
            "senderRole": "collaborator",
            "type": "nativeLiveBinaryProbe"
        }
    }))?;
    let payload = b"picbind-native-rtc-binary-probe";
    let mut frame = Vec::with_capacity(8 + header.len() + payload.len());
    frame.extend_from_slice(b"PBW1");
    frame.extend_from_slice(&(header.len() as u32).to_be_bytes());
    frame.extend_from_slice(&header);
    frame.extend_from_slice(payload);
    Ok(frame)
}

async fn send_json<S>(socket_writer: &mut S, value: Value) -> Result<(), Box<dyn Error>>
where
    S: futures_util::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    socket_writer
        .send(Message::Text(value.to_string().into()))
        .await?;
    Ok(())
}

fn native_error(error: String) -> Box<dyn Error> {
    error.into()
}

fn candidate_kind(candidate: &str) -> &str {
    let fields = candidate.split_ascii_whitespace().collect::<Vec<_>>();
    fields
        .windows(2)
        .find_map(|fields| (fields[0] == "typ").then_some(fields[1]))
        .unwrap_or("unknown")
}
