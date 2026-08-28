//! WebRTC transport contracts.

#[cfg(feature = "native-webrtc")]
mod data_channel;
#[cfg(feature = "native-webrtc")]
mod native;
#[cfg(feature = "native-webrtc")]
mod peer;

#[cfg(feature = "native-webrtc")]
pub use native::*;
#[cfg(feature = "native-webrtc")]
pub use peer::NativePeer;
