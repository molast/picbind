use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use bytes::Bytes;
use tokio::sync::Mutex;
use webrtc::{
    api::APIBuilder,
    data_channel::{RTCDataChannel, data_channel_init::RTCDataChannelInit},
    ice_transport::{ice_candidate::RTCIceCandidateInit, ice_server::RTCIceServer},
    peer_connection::{
        RTCPeerConnection, configuration::RTCConfiguration,
        peer_connection_state::RTCPeerConnectionState,
        sdp::session_description::RTCSessionDescription,
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
    connection: Arc<RTCPeerConnection>,
    channels: Arc<NativeDataChannels>,
    events: NativeEventDispatcher,
    control_send: Mutex<()>,
    bulk_send: Mutex<()>,
    closed: AtomicBool,
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
        let connection = APIBuilder::new()
            .build()
            .new_peer_connection(RTCConfiguration {
                ice_servers,
                ..Default::default()
            })
            .await
            .map_err(|error| error.to_string())?;
        let peer = Arc::new(Self {
            session_id: options.session_id,
            peer_id: options.peer_id,
            connection: Arc::new(connection),
            channels: Arc::new(NativeDataChannels::default()),
            events,
            control_send: Mutex::new(()),
            bulk_send: Mutex::new(()),
            closed: AtomicBool::new(false),
        });
        peer.register_connection_events();
        if options.initiator {
            for label in ["workspace-control", "workspace-bulk"] {
                let data_channel = peer
                    .connection
                    .create_data_channel(
                        label,
                        Some(RTCDataChannelInit {
                            ordered: Some(true),
                            ..Default::default()
                        }),
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                debug_assert_eq!(data_channel.ordered(), true);
                peer.attach(data_channel).await;
            }
        } else {
            let weak = Arc::downgrade(&peer);
            peer.connection
                .on_data_channel(Box::new(move |data_channel: Arc<RTCDataChannel>| {
                    let weak = weak.clone();
                    Box::pin(async move {
                        if let Some(peer) = weak.upgrade() {
                            peer.attach(data_channel).await;
                        }
                    })
                }));
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
            NativePeerChannel::Control => (&self.control_send, 256 * 1024),
            NativePeerChannel::Bulk => (&self.bulk_send, 1024 * 1024),
        };
        let _guard = send_lock.lock().await;
        let data_channel = self
            .channels
            .get(channel)
            .await
            .ok_or("DataChannel is unavailable")?;
        if data_channel
            .buffered_amount()
            .await
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
                    .send_text(value)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            NativeFrame::Binary(value) => {
                data_channel
                    .send(&Bytes::from(value))
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    pub async fn buffered_amount(&self, channel: NativePeerChannel) -> usize {
        match self.channels.get(channel).await {
            Some(value) => value.buffered_amount().await,
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

    async fn attach(&self, data_channel: Arc<RTCDataChannel>) {
        attach_data_channel(data_channel, self.channels.clone(), self.events.clone()).await;
    }

    fn register_connection_events(&self) {
        let candidate_events = self.events.clone();
        self.connection.on_ice_candidate(Box::new(move |candidate| {
            if let Some(candidate) = candidate.and_then(|value| value.to_json().ok()) {
                candidate_events.emit(NativePeerEventKind::IceCandidate(NativeIceCandidate {
                    candidate: candidate.candidate,
                    sdp_mid: candidate.sdp_mid,
                    sdp_m_line_index: candidate.sdp_mline_index,
                    username_fragment: candidate.username_fragment,
                }));
            }
            Box::pin(async {})
        }));

        let connection_events = self.events.clone();
        self.connection.on_peer_connection_state_change(Box::new(
            move |state: RTCPeerConnectionState| {
                connection_events.emit(NativePeerEventKind::ConnectionState(state.to_string()));
                Box::pin(async {})
            },
        ));
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
