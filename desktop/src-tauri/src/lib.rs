mod download;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let store = storage::NativeImageStore::open(data_dir).map_err(std::io::Error::other)?;
            app.manage(store);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running PicBind desktop");
}
