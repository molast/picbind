use tauri::{Runtime, plugin::TauriPlugin};

pub fn websocket_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_websocket::Builder::new().build()
}
