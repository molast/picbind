use serde::Serialize;
use tauri::ipc::{Channel, Response};

use crate::webrtc::{NativeEventSink, NativeFrame, NativePeerEvent, NativePeerEventKind};

const MAXIMUM_EVENT_HEADER_BYTES: usize = 32 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeEventHeader<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    session_id: &'a str,
    peer_id: &'a str,
    sequence: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidate: Option<&'a crate::signaling::NativeIceCandidate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_kind: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

pub fn event_sink(channel: Channel<Response>) -> NativeEventSink {
    std::sync::Arc::new(move |event| {
        if let Ok(bytes) = encode_event(&event) {
            let _ = channel.send(Response::new(bytes));
        }
    })
}

fn encode_event(event: &NativePeerEvent) -> Result<Vec<u8>, String> {
    let (kind, channel, state, candidate, frame_kind, error, payload) = match &event.kind {
        NativePeerEventKind::IceCandidate(candidate) => (
            "iceCandidate",
            None,
            None,
            Some(candidate),
            None,
            None,
            Vec::new(),
        ),
        NativePeerEventKind::ConnectionState(state) => (
            "connectionState",
            None,
            Some(state.as_str()),
            None,
            None,
            None,
            Vec::new(),
        ),
        NativePeerEventKind::ChannelState { channel, state } => (
            "channelState",
            Some(channel.as_str()),
            Some(state.as_str()),
            None,
            None,
            None,
            Vec::new(),
        ),
        NativePeerEventKind::Message { channel, frame } => match frame {
            NativeFrame::Text(value) => (
                "message",
                Some(channel.as_str()),
                None,
                None,
                Some("text"),
                None,
                value.as_bytes().to_vec(),
            ),
            NativeFrame::Binary(value) => (
                "message",
                Some(channel.as_str()),
                None,
                None,
                Some("binary"),
                None,
                value.clone(),
            ),
        },
        NativePeerEventKind::Error(error) => (
            "error",
            None,
            None,
            None,
            None,
            Some(error.as_str()),
            Vec::new(),
        ),
    };
    let header = serde_json::to_vec(&NativeEventHeader {
        kind,
        session_id: &event.session_id,
        peer_id: &event.peer_id,
        sequence: event.sequence,
        channel,
        state,
        candidate,
        frame_kind,
        error,
    })
    .map_err(|error| error.to_string())?;
    if header.len() > MAXIMUM_EVENT_HEADER_BYTES {
        return Err("native event header exceeds size limit".into());
    }
    let mut encoded = Vec::with_capacity(4 + header.len() + payload.len());
    encoded.extend_from_slice(&(header.len() as u32).to_le_bytes());
    encoded.extend_from_slice(&header);
    encoded.extend_from_slice(&payload);
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::webrtc::{NativePeerChannel, NativePeerEvent};

    #[test]
    fn binary_event_keeps_payload_outside_json() {
        let value = encode_event(&NativePeerEvent {
            session_id: "session-1".into(),
            peer_id: "peer-1".into(),
            sequence: 1,
            kind: NativePeerEventKind::Message {
                channel: NativePeerChannel::Bulk,
                frame: NativeFrame::Binary(vec![0, 1, 255]),
            },
        })
        .unwrap();
        let header_len = u32::from_le_bytes(value[..4].try_into().unwrap()) as usize;
        assert_eq!(&value[4 + header_len..], &[0, 1, 255]);
        assert!(
            std::str::from_utf8(&value[4..4 + header_len])
                .unwrap()
                .contains("\"frameKind\":\"binary\"")
        );
    }
}
