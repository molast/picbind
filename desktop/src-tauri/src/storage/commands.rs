use super::database::{
    NativeImageRecord, PruneCachePolicy, PruneResult, PutImageRequest, RecoveryResult, StorageUsage,
};
use super::NativeImageStore;
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State,
};

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
