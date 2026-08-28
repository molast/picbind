use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

use crate::{session::NativePeerKey, webrtc::NativePeer};

#[derive(Default)]
pub struct NativeRealtimeState {
    peers: RwLock<HashMap<NativePeerKey, Arc<NativePeer>>>,
}

impl NativeRealtimeState {
    pub fn get(&self, session_id: &str, peer_id: &str) -> Result<Arc<NativePeer>, String> {
        self.peers
            .read()
            .map_err(|_| "native peer state is unavailable".to_owned())?
            .get(&NativePeerKey::new(session_id, peer_id))
            .cloned()
            .ok_or_else(|| "native peer was not found".to_owned())
    }

    pub fn insert(&self, peer: Arc<NativePeer>) -> Result<Option<Arc<NativePeer>>, String> {
        let key = NativePeerKey::new(&peer.session_id, &peer.peer_id);
        Ok(self
            .peers
            .write()
            .map_err(|_| "native peer state is unavailable".to_owned())?
            .insert(key, peer))
    }

    pub fn remove(
        &self,
        session_id: &str,
        peer_id: &str,
    ) -> Result<Option<Arc<NativePeer>>, String> {
        Ok(self
            .peers
            .write()
            .map_err(|_| "native peer state is unavailable".to_owned())?
            .remove(&NativePeerKey::new(session_id, peer_id)))
    }

    pub fn remove_session(&self, session_id: &str) -> Result<Vec<Arc<NativePeer>>, String> {
        let mut peers = self
            .peers
            .write()
            .map_err(|_| "native peer state is unavailable".to_owned())?;
        let keys = peers
            .keys()
            .filter(|key| key.session_id == session_id)
            .cloned()
            .collect::<Vec<_>>();
        Ok(keys
            .into_iter()
            .filter_map(|key| peers.remove(&key))
            .collect())
    }

    pub fn drain(&self) -> Vec<Arc<NativePeer>> {
        self.peers
            .write()
            .map(|mut peers| peers.drain().map(|(_, peer)| peer).collect())
            .unwrap_or_default()
    }
}
