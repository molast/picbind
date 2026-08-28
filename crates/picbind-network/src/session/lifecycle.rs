use std::sync::Arc;

use crate::webrtc::NativePeer;

pub async fn close_peers(peers: Vec<Arc<NativePeer>>) {
    for peer in peers {
        peer.close().await;
    }
}
