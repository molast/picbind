use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use bytes::BytesMut;
use tokio::sync::Mutex;
use webrtc::{
    data_channel::{DataChannel, RTCDataChannelInit},
    peer_connection::{
        PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
        RTCIceCandidateInit, RTCIceServer, RTCPeerConnectionIceEvent, RTCPeerConnectionState,
        RTCSessionDescription,
    },
};

use crate::signaling::{NativeIceCandidate, NativePeerCreateOptions, NativeSessionDescription};

use super::{
    NativeEventDispatcher, NativeEventSink, NativeFrame, NativePeerChannel, NativePeerEventKind,
    data_channel::{NativeDataChannels, attach_data_channel},
    validate_description,
};

pub struct NativePeer {
    pub session_id: String,
    pub peer_id: String,
    connection: Arc<dyn PeerConnection>,
    channels: Arc<NativeDataChannels>,
    events: NativeEventDispatcher,
    control_send: Mutex<()>,
    bulk_send: Mutex<()>,
    closed: AtomicBool,
}

const CONTROL_BUFFERED_MAXIMUM_BYTES: usize = 256 * 1024;
const BULK_BUFFERED_MAXIMUM_BYTES: usize = 1024 * 1024;

struct NativePeerHandler {
    channels: Arc<NativeDataChannels>,
    events: NativeEventDispatcher,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for NativePeerHandler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(candidate) = event.candidate.to_json() {
            self.events
                .emit(NativePeerEventKind::IceCandidate(NativeIceCandidate {
                    candidate: candidate.candidate,
                    sdp_mid: candidate.sdp_mid,
                    sdp_m_line_index: candidate.sdp_mline_index,
                    username_fragment: candidate.username_fragment,
                }));
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        self.events
            .emit(NativePeerEventKind::ConnectionState(state.to_string()));
    }

    async fn on_data_channel(&self, data_channel: Arc<dyn DataChannel>) {
        attach_data_channel(data_channel, self.channels.clone(), self.events.clone()).await;
    }
}

impl NativePeer {
    pub async fn create(
        options: NativePeerCreateOptions,
        sink: NativeEventSink,
    ) -> Result<Arc<Self>, String> {
        validate_id("sessionId", &options.session_id)?;
        validate_id("peerId", &options.peer_id)?;
        let events =
            NativeEventDispatcher::new(options.session_id.clone(), options.peer_id.clone(), sink);
        let ice_servers = options
            .ice_servers
            .into_iter()
            .map(|server| RTCIceServer {
                urls: server.urls.into_vec(),
                username: server.username,
                credential: server.credential,
                ..Default::default()
            })
            .collect();
        let channels = Arc::new(NativeDataChannels::default());
        let handler = Arc::new(NativePeerHandler {
            channels: channels.clone(),
            events: events.clone(),
        });
        let connection: Arc<dyn PeerConnection> = Arc::new(
            PeerConnectionBuilder::<String>::new()
                .with_configuration(
                    RTCConfigurationBuilder::new()
                        .with_ice_servers(ice_servers)
                        .build(),
                )
                .with_handler(handler)
                .with_udp_addrs(vec!["0.0.0.0:0".to_owned(), "[::]:0".to_owned()])
                .with_data_channel_send_buffer_limit(BULK_BUFFERED_MAXIMUM_BYTES)
                .build()
                .await
                .map_err(|error| error.to_string())?,
        );
        let peer = Arc::new(Self {
            session_id: options.session_id,
            peer_id: options.peer_id,
            connection,
            channels,
            events,
            control_send: Mutex::new(()),
            bulk_send: Mutex::new(()),
            closed: AtomicBool::new(false),
        });
        if options.initiator {
            for label in ["workspace-control", "workspace-bulk"] {
                let data_channel = peer
                    .connection
                    .create_data_channel(
                        label,
                        Some(RTCDataChannelInit {
                            ordered: true,
                            ..Default::default()
                        }),
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                attach_data_channel(data_channel, peer.channels.clone(), peer.events.clone()).await;
            }
        }
        Ok(peer)
    }

    pub async fn create_offer(&self) -> Result<NativeSessionDescription, String> {
        let value = self
            .connection
            .create_offer(None)
            .await
            .map_err(|error| error.to_string())?;
        Ok(NativeSessionDescription {
            kind: "offer".into(),
            sdp: value.sdp,
        })
    }

    pub async fn create_answer(&self) -> Result<NativeSessionDescription, String> {
        let value = self
            .connection
            .create_answer(None)
            .await
            .map_err(|error| error.to_string())?;
        Ok(NativeSessionDescription {
            kind: "answer".into(),
            sdp: value.sdp,
        })
    }

    pub async fn set_local_description(
        &self,
        value: NativeSessionDescription,
    ) -> Result<(), String> {
        validate_description(&value, None)?;
        self.connection
            .set_local_description(description(value)?)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn set_remote_description(
        &self,
        value: NativeSessionDescription,
    ) -> Result<(), String> {
        validate_description(&value, None)?;
        self.connection
            .set_remote_description(description(value)?)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn add_ice_candidate(&self, value: NativeIceCandidate) -> Result<(), String> {
        if value.candidate.len() > 16 * 1024 {
            return Err("ICE candidate exceeds size limit".into());
        }
        self.connection
            .add_ice_candidate(RTCIceCandidateInit {
                candidate: value.candidate,
                sdp_mid: value.sdp_mid,
                sdp_mline_index: value.sdp_m_line_index,
                username_fragment: value.username_fragment,
                url: None,
            })
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn send(&self, channel: NativePeerChannel, frame: NativeFrame) -> Result<(), String> {
        let frame_bytes = match &frame {
            NativeFrame::Text(value) => value.len(),
            NativeFrame::Binary(value) => value.len(),
        };
        let (send_lock, buffered_maximum) = match channel {
            NativePeerChannel::Control => (&self.control_send, CONTROL_BUFFERED_MAXIMUM_BYTES),
            NativePeerChannel::Bulk => (&self.bulk_send, BULK_BUFFERED_MAXIMUM_BYTES),
        };
        let _guard = send_lock.lock().await;
        let data_channel = self
            .channels
            .get(channel)
            .await
            .ok_or("DataChannel is unavailable")?;
        if data_channel
            .outstanding_bytes()
            .await
            .map_err(|error| error.to_string())?
            .saturating_add(frame_bytes)
            > buffered_maximum
        {
            return Err(format!(
                "native RTC {} channel is backpressured",
                channel.as_str()
            ));
        }
        match frame {
            NativeFrame::Text(value) => {
                data_channel
                    .try_send_text(&value)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            NativeFrame::Binary(value) => {
                data_channel
                    .try_send(BytesMut::from(value.as_slice()))
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    pub async fn buffered_amount(&self, channel: NativePeerChannel) -> usize {
        match self.channels.get(channel).await {
            Some(value) => value.outstanding_bytes().await.unwrap_or_default(),
            None => 0,
        }
    }

    pub async fn close(&self) {
        if self.closed.swap(true, Ordering::AcqRel) {
            return;
        }
        self.channels.close().await;
        let _ = self.connection.close().await;
    }
}

fn validate_id(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("invalid {name}"));
    }
    Ok(())
}

fn description(value: NativeSessionDescription) -> Result<RTCSessionDescription, String> {
    match value.kind.as_str() {
        "offer" => RTCSessionDescription::offer(value.sdp),
        "answer" => RTCSessionDescription::answer(value.sdp),
        _ => return Err("invalid SDP type".into()),
    }
    .map_err(|error| error.to_string())
}
