use super::NativeImageStore;
use super::database::{
    LinkExternalImageRequest, NativeImageRecord, PruneCachePolicy, PruneResult, PutImageRequest,
    RecoveryResult, StorageUsage,
};
use crate::image_processing::temporary::NativeTemporaryStore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, State,
    ipc::{InvokeBody, Request, Response},
};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn storage_put_image(
    state: State<'_, NativeImageStore>,
    request: Request<'_>,
) -> Result<NativeImageRecord, String> {
    let request = decode_put_request(request.body())?;
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.put(request))
        .await
        .map_err(|error| error.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLibraryImage {
    path: String,
    name: String,
    mime_type: String,
    size: u64,
}

#[tauri::command]
pub async fn storage_pick_library_images(
    app: AppHandle,
) -> Result<Vec<NativeLibraryImage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter(
                "Images",
                &[
                    "avif", "bmp", "gif", "jpeg", "jpg", "jxl", "png", "tif", "tiff", "webp",
                ],
            )
            .blocking_pick_files()
            .unwrap_or_default();
        selected
            .into_iter()
            .map(|file| {
                let path = file.into_path().map_err(|error| error.to_string())?;
                let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
                let name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| "selected image has an invalid file name".to_string())?
                    .to_string();
                let mime_type = image_mime_type(&path)
                    .ok_or_else(|| format!("unsupported image format: {name}"))?
                    .to_string();
                Ok(NativeLibraryImage {
                    path: path.to_string_lossy().into_owned(),
                    name,
                    mime_type,
                    size: metadata.len(),
                })
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_link_external_image(
    state: State<'_, NativeImageStore>,
    input: LinkExternalImageRequest,
) -> Result<NativeImageRecord, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.link_external(input))
        .await
        .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptTemporaryRequest {
    token: String,
    target: AdoptTemporaryTarget,
    metadata: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdoptTemporaryTarget {
    scope: String,
    scope_key: String,
    id: String,
    variant: String,
}

#[tauri::command]
pub async fn storage_adopt_temporary(
    store: State<'_, NativeImageStore>,
    temporary: State<'_, NativeTemporaryStore>,
    input: AdoptTemporaryRequest,
) -> Result<NativeImageRecord, String> {
    if !matches!(input.target.variant.as_str(), "original" | "output") {
        return Err("Temporary images can only be adopted as original or output data".to_string());
    }
    let store = store.inner().clone();
    let temporary = temporary.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = temporary.checkout(&input.token)?;
        let bytes = checkout.read()?;
        if bytes.len() != checkout.size_bytes() {
            return Err("Temporary image size changed before adoption".to_string());
        }
        let record = store.put(PutImageRequest {
            scope: input.target.scope,
            scope_key: input.target.scope_key,
            id: input.target.id,
            metadata: input.metadata,
            mime_type: checkout.mime_type().to_string(),
            data_length: bytes.len(),
            thumbnail_length: 0,
            data: Some(bytes),
            thumbnail: None,
            thumbnail_mime_type: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        })?;
        let _ = checkout.complete();
        Ok(record)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_get_image(
    state: State<'_, NativeImageStore>,
    scope: String,
    scope_key: String,
    id: String,
) -> Result<Option<NativeImageRecord>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.get(&scope, &scope_key, &id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_list_images(
    state: State<'_, NativeImageStore>,
    scope: String,
    scope_key: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<NativeImageRecord>, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.list(&scope, &scope_key, limit, offset))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_read_image(
    state: State<'_, NativeImageStore>,
    scope: String,
    scope_key: String,
    id: String,
    variant: String,
) -> Result<Response, String> {
    let store = state.inner().clone();
    let bytes =
        tauri::async_runtime::spawn_blocking(move || store.read(&scope, &scope_key, &id, &variant))
            .await
            .map_err(|error| error.to_string())??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn storage_delete_image(
    state: State<'_, NativeImageStore>,
    scope: String,
    scope_key: String,
    id: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.delete(&scope, &scope_key, &id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_delete_image_variant(
    state: State<'_, NativeImageStore>,
    scope: String,
    scope_key: String,
    id: String,
    variant: String,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.delete_variant(&scope, &scope_key, &id, &variant)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_clear_images(
    state: State<'_, NativeImageStore>,
    scope: String,
    scope_key: Option<String>,
) -> Result<(), String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.clear(&scope, scope_key.as_deref()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_get_usage(state: State<'_, NativeImageStore>) -> Result<StorageUsage, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.usage())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_prune_cache(
    state: State<'_, NativeImageStore>,
    policy: PruneCachePolicy,
) -> Result<PruneResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.prune(policy))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn storage_recover(state: State<'_, NativeImageStore>) -> Result<RecoveryResult, String> {
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.recover())
        .await
        .map_err(|error| error.to_string())?
}

fn decode_put_request(body: &InvokeBody) -> Result<PutImageRequest, String> {
    let InvokeBody::Raw(frame) = body else {
        return Err("storage_put_image requires a binary request".to_string());
    };
    if frame.len() < 4 {
        return Err("invalid image storage frame".to_string());
    }
    let metadata_length = u32::from_le_bytes(
        frame[..4]
            .try_into()
            .map_err(|_| "invalid image storage frame")?,
    ) as usize;
    let metadata_end = 4usize
        .checked_add(metadata_length)
        .filter(|end| *end <= frame.len())
        .ok_or_else(|| "invalid image storage frame".to_string())?;
    let mut request: PutImageRequest = serde_json::from_slice(&frame[4..metadata_end])
        .map_err(|error| format!("invalid image storage metadata: {error}"))?;
    let data_length = request.data_length;
    let thumbnail_length = request.thumbnail_length;
    let data_end = metadata_end
        .checked_add(data_length)
        .filter(|end| *end <= frame.len())
        .ok_or_else(|| "invalid image data length".to_string())?;
    let thumbnail_end = data_end
        .checked_add(thumbnail_length)
        .filter(|end| *end == frame.len())
        .ok_or_else(|| "invalid image thumbnail length".to_string())?;
    request.data = (data_length > 0).then(|| frame[metadata_end..data_end].to_vec());
    request.thumbnail = (thumbnail_length > 0).then(|| frame[data_end..thumbnail_end].to_vec());
    Ok(request)
}

fn image_mime_type(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "jpeg" | "jpg" => Some("image/jpeg"),
        "jxl" => Some("image/jxl"),
        "png" => Some("image/png"),
        "tif" | "tiff" => Some("image/tiff"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}
