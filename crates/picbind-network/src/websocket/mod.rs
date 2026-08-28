//! WebSocket transport contracts.

#[cfg(feature = "tauri")]
mod tauri_plugin;

#[cfg(feature = "tauri")]
pub use tauri_plugin::websocket_plugin;
