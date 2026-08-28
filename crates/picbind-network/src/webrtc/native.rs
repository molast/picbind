use crate::signaling::{NativeIceCandidate, NativeSessionDescription};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativePeerChannel {
    Control,
    Bulk,
}

impl NativePeerChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Bulk => "bulk",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "control" => Some(Self::Control),
            "bulk" => Some(Self::Bulk),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum NativeFrame {
    Text(String),
    Binary(Vec<u8>),
}

#[derive(Clone, Debug)]
pub enum NativePeerEventKind {
    IceCandidate(NativeIceCandidate),
    ConnectionState(String),
    ChannelState {
        channel: NativePeerChannel,
        state: String,
    },
    Message {
        channel: NativePeerChannel,
        frame: NativeFrame,
    },
    Error(String),
}

#[derive(Clone, Debug)]
pub struct NativePeerEvent {
    pub session_id: String,
    pub peer_id: String,
    pub sequence: u64,
    pub kind: NativePeerEventKind,
}

pub type NativeEventSink = std::sync::Arc<dyn Fn(NativePeerEvent) + Send + Sync>;

#[derive(Clone)]
pub(crate) struct NativeEventDispatcher {
    session_id: String,
    peer_id: String,
    state: std::sync::Arc<std::sync::Mutex<NativeEventDispatcherState>>,
}

struct NativeEventDispatcherState {
    sequence: u64,
    sink: NativeEventSink,
}

impl NativeEventDispatcher {
    pub(crate) fn new(session_id: String, peer_id: String, sink: NativeEventSink) -> Self {
        Self {
            session_id,
            peer_id,
            state: std::sync::Arc::new(std::sync::Mutex::new(NativeEventDispatcherState {
                sequence: 0,
                sink,
            })),
        }
    }

    pub(crate) fn emit(&self, kind: NativePeerEventKind) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.sequence = state.sequence.saturating_add(1);
        (state.sink)(NativePeerEvent {
            session_id: self.session_id.clone(),
            peer_id: self.peer_id.clone(),
            sequence: state.sequence,
            kind,
        });
    }
}

pub fn validate_description(
    value: &NativeSessionDescription,
    expected: Option<&str>,
) -> Result<(), String> {
    if value.sdp.is_empty() || value.sdp.len() > 1024 * 1024 {
        return Err("invalid SDP size".into());
    }
    if !matches!(value.kind.as_str(), "offer" | "answer") {
        return Err("invalid SDP type".into());
    }
    if expected.is_some_and(|kind| value.kind != kind) {
        return Err("unexpected SDP type".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn dispatcher_assigns_sequence_in_sink_delivery_order() {
        let delivered = Arc::new(Mutex::new(Vec::new()));
        let captured = delivered.clone();
        let dispatcher = NativeEventDispatcher::new(
            "session-1".into(),
            "peer-1".into(),
            Arc::new(move |event| captured.lock().unwrap().push(event.sequence)),
        );

        std::thread::scope(|scope| {
            for _ in 0..32 {
                let dispatcher = dispatcher.clone();
                scope.spawn(move || {
                    dispatcher.emit(NativePeerEventKind::ConnectionState("connected".into()));
                });
            }
        });

        assert_eq!(*delivered.lock().unwrap(), (1..=32).collect::<Vec<_>>());
    }
}
