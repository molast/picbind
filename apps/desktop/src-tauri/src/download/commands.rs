use serde::Deserialize;
use std::{fs, path::Path};
use tauri::{
    AppHandle,
    ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::DialogExt;

const MAX_DOWNLOAD_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDownloadMetadata {
    file_name: String,
    data_length: usize,
}

struct SaveDownloadRequest {
    file_name: String,
    data: Vec<u8>,
}

#[tauri::command]
pub async fn save_download(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let request = decode_request(request.body())?;
    tauri::async_runtime::spawn_blocking(move || {
        let extension = Path::new(&request.file_name)
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 16
                    && value
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric())
            })
            .map(str::to_string);
        let mut dialog = app.dialog().file().set_file_name(&request.file_name);
        if let Some(extension) = extension.as_deref() {
            dialog = dialog.add_filter(extension.to_ascii_uppercase(), &[extension]);
        }
        let Some(path) = dialog.blocking_save_file() else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|error| error.to_string())?;
        fs::write(path, request.data).map_err(|error| error.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn decode_request(body: &InvokeBody) -> Result<SaveDownloadRequest, String> {
    let InvokeBody::Raw(bytes) = body else {
        return Err("download request must use a binary body".to_string());
    };
    if bytes.len() < 4 {
        return Err("download request is incomplete".to_string());
    }
    let metadata_length = u32::from_le_bytes(
        bytes[0..4]
            .try_into()
            .map_err(|_| "download metadata length is invalid")?,
    ) as usize;
    let metadata_end = 4usize
        .checked_add(metadata_length)
        .ok_or_else(|| "download metadata length overflow".to_string())?;
    if metadata_end > bytes.len() {
        return Err("download metadata is truncated".to_string());
    }
    let metadata: SaveDownloadMetadata =
        serde_json::from_slice(&bytes[4..metadata_end]).map_err(|error| error.to_string())?;
    validate_file_name(&metadata.file_name)?;
    if metadata.data_length == 0 || metadata.data_length > MAX_DOWNLOAD_BYTES {
        return Err("download data length is invalid".to_string());
    }
    if bytes.len() - metadata_end != metadata.data_length {
        return Err("download data length does not match the request".to_string());
    }
    Ok(SaveDownloadRequest {
        file_name: metadata.file_name,
        data: bytes[metadata_end..].to_vec(),
    })
}

fn validate_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() || file_name.len() > 255 {
        return Err("download file name is invalid".to_string());
    }
    let path = Path::new(file_name);
    if path.file_name().and_then(|value| value.to_str()) != Some(file_name) {
        return Err("download file name must not contain a path".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_file_name;

    #[test]
    fn validates_download_file_names() {
        assert!(validate_file_name("image.webp").is_ok());
        assert!(validate_file_name("../image.webp").is_err());
        assert!(validate_file_name("folder/image.webp").is_err());
        assert!(validate_file_name("").is_err());
    }
}
