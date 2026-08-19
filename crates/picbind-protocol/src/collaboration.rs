use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayEnvelope {
    pub target: RelayTarget,
    pub event: crate::events::WorkspaceEvent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RelayTarget {
    Workspace,
    Owner,
    Client(String),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CollaborationPayload {
    Presence { client_id: String, online: bool },
    Reaction { emoji: String },
    Message { text: String },
    Opaque { kind: String, value: Value },
}
