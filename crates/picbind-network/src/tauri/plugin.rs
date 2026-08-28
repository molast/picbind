use tauri::{
    Manager, RunEvent, Runtime, WindowEvent,
    plugin::{Builder, TauriPlugin},
};

use crate::session::close_peers;

use super::{commands::*, state::NativeRealtimeState};

pub fn realtime_plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("picbind-realtime")
        .setup(|app, _api| {
            app.manage(NativeRealtimeState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            realtime_peer_create,
            realtime_peer_create_offer,
            realtime_peer_create_answer,
            realtime_peer_set_local_description,
            realtime_peer_set_remote_description,
            realtime_peer_add_ice_candidate,
            realtime_peer_send,
            realtime_peer_buffered_amount,
            realtime_peer_close,
            realtime_session_close,
        ])
        .on_event(|app, event| {
            let should_close = matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. })
                || matches!(event, RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } if label == "main");
            if should_close {
                let peers = app.state::<NativeRealtimeState>().drain();
                tauri::async_runtime::spawn(close_peers(peers));
            }
        })
        .build()
}
