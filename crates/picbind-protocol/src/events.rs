use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DataClass {
    Presence,
    CollaborationEvent,
    Preview,
    SourceOrCommit,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reliability {
    Ephemeral,
    Reliable,
    Bulk,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEvent {
    pub event_id: String,
    pub sequence: u64,
    pub timestamp: i64,
    pub data_class: DataClass,
    pub reliability: Reliability,
    pub kind: String,
    pub payload: Value,
}

impl WorkspaceEvent {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.event_id.is_empty()
            || self.event_id.len() > 128
            || self.kind.is_empty()
            || self.kind.len() > 80
        {
            return Err("invalid event envelope");
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct EventCursor {
    last_sequence: u64,
    seen: std::collections::HashSet<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventDisposition {
    Apply,
    Duplicate,
    SequenceGap,
}

impl EventCursor {
    pub fn accept(&mut self, event: &WorkspaceEvent) -> EventDisposition {
        if self.seen.contains(&event.event_id) {
            return EventDisposition::Duplicate;
        }
        if self.last_sequence > 0 && event.sequence > self.last_sequence + 1 {
            return EventDisposition::SequenceGap;
        }
        self.seen.insert(event.event_id.clone());
        self.last_sequence = self.last_sequence.max(event.sequence);
        EventDisposition::Apply
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(id: &str, sequence: u64) -> WorkspaceEvent {
        WorkspaceEvent {
            event_id: id.into(),
            sequence,
            timestamp: 0,
            data_class: DataClass::CollaborationEvent,
            reliability: Reliability::Reliable,
            kind: "proposal".into(),
            payload: Value::Null,
        }
    }
    #[test]
    fn duplicate_ids_are_not_applied_twice() {
        let mut c = EventCursor::default();
        assert_eq!(c.accept(&event("a", 1)), EventDisposition::Apply);
        assert_eq!(c.accept(&event("a", 1)), EventDisposition::Duplicate);
    }
    #[test]
    fn gaps_request_a_snapshot() {
        let mut c = EventCursor::default();
        c.accept(&event("a", 1));
        assert_eq!(c.accept(&event("b", 3)), EventDisposition::SequenceGap);
    }
}
