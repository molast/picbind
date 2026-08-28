#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct NativePeerKey {
    pub session_id: String,
    pub peer_id: String,
}

impl NativePeerKey {
    pub fn new(session_id: impl Into<String>, peer_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            peer_id: peer_id.into(),
        }
    }
}
