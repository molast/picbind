mod auth;
mod download;
mod image_processing;
mod messaging;
mod storage;

use tauri::{Manager, http};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("picbind-preview", |context, request| {
            if request.method() != http::Method::GET {
                return http::Response::builder()
                    .status(http::StatusCode::METHOD_NOT_ALLOWED)
                    .body(Vec::new())
                    .expect("valid preview method response");
            }
            let token = request.uri().path().trim_start_matches('/');
            let cache = context
                .app_handle()
                .state::<image_processing::preview_cache::NativePreviewCache>();
            match cache.read(token) {
                Ok(file) => http::Response::builder()
                    .header(http::header::CONTENT_TYPE, file.mime_type)
                    .header(
                        http::header::CACHE_CONTROL,
                        "private, max-age=31536000, immutable",
                    )
                    .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(file.bytes)
                    .expect("valid preview cache response"),
                Err(_) => http::Response::builder()
                    .status(http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .expect("valid preview not-found response"),
            }
        })
        .register_uri_scheme_protocol("picbind-library", |context, request| {
            if request.method() != http::Method::GET {
                return http::Response::builder()
                    .status(http::StatusCode::METHOD_NOT_ALLOWED)
                    .body(Vec::new())
                    .expect("valid library image method response");
            }
            let segments = request
                .uri()
                .path()
                .trim_start_matches('/')
                .split('/')
                .map(|segment| urlencoding::decode(segment).map(|value| value.into_owned()))
                .collect::<Result<Vec<_>, _>>();
            let Ok(segments) = segments else {
                return http::Response::builder()
                    .status(http::StatusCode::BAD_REQUEST)
                    .body(Vec::new())
                    .expect("valid library image bad-request response");
            };
            if segments.len() != 4 {
                return http::Response::builder()
                    .status(http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .expect("valid library image not-found response");
            }
            let store = context.app_handle().state::<storage::NativeImageStore>();
            let (scope, scope_key, id, variant) =
                (&segments[0], &segments[1], &segments[2], &segments[3]);
            let mime_type = store
                .get(scope, scope_key, id)
                .ok()
                .flatten()
                .map(|record| record.mime_type);
            match (mime_type, store.read(scope, scope_key, id, variant)) {
                (Some(mime_type), Ok(bytes)) => http::Response::builder()
                    .header(http::header::CONTENT_TYPE, mime_type)
                    .header(http::header::CACHE_CONTROL, "private, no-cache")
                    .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(bytes)
                    .expect("valid library image response"),
                _ => http::Response::builder()
                    .status(http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .expect("valid library image not-found response"),
            }
        })
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, _cwd| {
                let _ = arguments;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(picbind_network::tauri::websocket_plugin())
        .plugin(picbind_network::tauri::realtime_plugin())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let store =
                storage::NativeImageStore::open(data_dir.clone()).map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(image_processing::tasks::NativeImageTasks::default());
            app.manage(image_processing::memory::NativeImageMemory::default());
            let preview_cache =
                image_processing::preview_cache::NativePreviewCache::open(data_dir.clone())
                    .map_err(std::io::Error::other)?;
            app.manage(preview_cache);
            let temporary =
                image_processing::temporary::NativeTemporaryStore::open(data_dir.clone())
                    .map_err(std::io::Error::other)?;
            app.manage(temporary);

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
            image_processing::commands::image_processing_execute,
            image_processing::commands::image_processing_cancel,
            image_processing::commands::image_processing_release_temporary,
            image_processing::commands::image_processing_release_memory_source,
            image_processing::commands::image_processing_release_preview_cache,
            storage::commands::storage_put_image,
            storage::commands::storage_pick_library_images,
            storage::commands::storage_link_external_image,
            storage::commands::storage_adopt_temporary,
            storage::commands::storage_get_image,
            storage::commands::storage_list_images,
            storage::commands::storage_read_image,
            storage::commands::storage_delete_image,
            storage::commands::storage_delete_image_variant,
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
