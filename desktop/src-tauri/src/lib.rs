mod auth;
mod download;
mod messaging;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let store =
                storage::NativeImageStore::open(data_dir.clone()).map_err(std::io::Error::other)?;
            app.manage(store);

            // iLink getupdates is a long poll and must not inherit the shorter
            // timeout used by the regular API client.
            let messaging_poll_client = reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(8))
                .pool_idle_timeout(std::time::Duration::from_secs(2))
                .build()
                .map_err(std::io::Error::other)?;
            let messaging_api_client = reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(8))
                .timeout(std::time::Duration::from_secs(35))
                .build()
                .map_err(std::io::Error::other)?;
            let messaging = messaging::DesktopMessagingRepository::new(
                messaging_poll_client,
                messaging_api_client,
                data_dir.join("messaging"),
            )
            .map_err(std::io::Error::other)?;
            app.manage(messaging);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::desktop_auth_login,
            auth::desktop_auth_register,
            auth::desktop_auth_oauth,
            auth::desktop_auth_avatar_data_url,
            download::commands::save_download,
            storage::commands::storage_put_image,
            storage::commands::storage_get_image,
            storage::commands::storage_list_images,
            storage::commands::storage_read_image,
            storage::commands::storage_delete_image,
            storage::commands::storage_clear_images,
            storage::commands::storage_get_usage,
            storage::commands::storage_prune_cache,
            storage::commands::storage_recover,
            messaging::commands::messaging_status,
            messaging::commands::messaging_start_login,
            messaging::commands::messaging_login_status,
            messaging::commands::messaging_connect,
            messaging::commands::messaging_disconnect,
            messaging::commands::messaging_send_text,
            messaging::commands::messaging_send_image,
            messaging::commands::messaging_download_image,
            messaging::commands::messaging_take_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PicBind desktop");
}
