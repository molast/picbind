use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum NativeIceUrls {
    One(String),
    Many(Vec<String>),
}

impl NativeIceUrls {
    pub fn into_vec(self) -> Vec<String> {
        match self {
            Self::One(value) => vec![value],
            Self::Many(values) => values,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeIceServer {
    pub urls: NativeIceUrls,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePeerCreateOptions {
    pub session_id: String,
    pub peer_id: String,
    pub ice_servers: Vec<NativeIceServer>,
    pub initiator: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionDescription {
    #[serde(rename = "type")]
    pub kind: String,
    pub sdp: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeIceCandidate {
    pub candidate: String,
    #[serde(default)]
    pub sdp_mid: Option<String>,
    #[serde(default)]
    pub sdp_m_line_index: Option<u16>,
    #[serde(default)]
    pub username_fragment: Option<String>,
}
