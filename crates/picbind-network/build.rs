const COMMANDS: &[&str] = &[
    "realtime_peer_create",
    "realtime_peer_create_offer",
    "realtime_peer_create_answer",
    "realtime_peer_set_local_description",
    "realtime_peer_set_remote_description",
    "realtime_peer_add_ice_candidate",
    "realtime_peer_send",
    "realtime_peer_buffered_amount",
    "realtime_peer_close",
    "realtime_session_close",
];

fn main() {
    if std::env::var_os("CARGO_FEATURE_TAURI").is_some() {
        tauri_plugin::Builder::new(COMMANDS).build();
    }
}
