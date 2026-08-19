use picbind_protocol::events::{DataClass, Reliability, WorkspaceEvent};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Transport {
    WebSocket,
    WebRtc,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RtcQualification {
    pub channel_open: bool,
    pub heartbeat_ack: bool,
    pub test_message_ack: bool,
}

impl RtcQualification {
    pub fn qualified(self) -> bool {
        self.channel_open && self.heartbeat_ack && self.test_message_ack
    }
}

#[derive(Debug)]
pub struct TransportRouter {
    active: Transport,
    rtc: RtcQualification,
    reliable_ws_queue: usize,
}

impl Default for TransportRouter {
    fn default() -> Self {
        Self {
            active: Transport::WebSocket,
            rtc: RtcQualification::default(),
            reliable_ws_queue: 0,
        }
    }
}

impl TransportRouter {
    pub fn active(&self) -> Transport {
        self.active
    }
    pub fn queued_reliable(&self) -> usize {
        self.reliable_ws_queue
    }
    pub fn record_ws_enqueue(&mut self, event: &WorkspaceEvent) {
        if event.reliability == Reliability::Reliable {
            self.reliable_ws_queue += 1;
        }
    }
    pub fn record_ws_ack(&mut self) {
        self.reliable_ws_queue = self.reliable_ws_queue.saturating_sub(1);
        self.try_promote();
    }
    pub fn set_rtc_qualification(&mut self, value: RtcQualification) {
        self.rtc = value;
        self.try_promote();
    }
    fn try_promote(&mut self) {
        if self.rtc.qualified() && self.reliable_ws_queue == 0 {
            self.active = Transport::WebRtc;
        }
    }
    pub fn rtc_failed(&mut self) {
        self.active = Transport::WebSocket;
        self.rtc = RtcQualification::default();
    }
    pub fn route(&self, event: &WorkspaceEvent) -> Transport {
        if self.active == Transport::WebRtc
            && matches!(
                event.data_class,
                DataClass::Preview | DataClass::SourceOrCommit
            )
            && event.kind != "commitCreated"
        {
            Transport::WebRtc
        } else {
            Transport::WebSocket
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn event() -> WorkspaceEvent {
        WorkspaceEvent {
            event_id: "e".into(),
            sequence: 1,
            timestamp: 0,
            data_class: DataClass::Preview,
            reliability: Reliability::Reliable,
            kind: "preview".into(),
            payload: Value::Null,
        }
    }
    #[test]
    fn rtc_requires_all_checks_and_drained_queue() {
        let mut r = TransportRouter::default();
        r.record_ws_enqueue(&event());
        r.set_rtc_qualification(RtcQualification {
            channel_open: true,
            heartbeat_ack: true,
            test_message_ack: true,
        });
        assert_eq!(r.active(), Transport::WebSocket);
        r.record_ws_ack();
        assert_eq!(r.active(), Transport::WebRtc);
    }
    #[test]
    fn rtc_failure_immediately_falls_back() {
        let mut r = TransportRouter::default();
        r.set_rtc_qualification(RtcQualification {
            channel_open: true,
            heartbeat_ack: true,
            test_message_ack: true,
        });
        r.rtc_failed();
        assert_eq!(r.active(), Transport::WebSocket);
    }
}
