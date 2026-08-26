use picbind_image_native::{
    NativeEncodeOptions, NativeImageDimensions, NativeImageError, NativeImageFormat,
    NativeImageMetadata, NativeParameterDocument, NativeTaskControl, compare_quality_with_control,
    create_share_assets_with_control, encode_auto_planned_with_control, encode_auto_with_control,
    encode_planned_with_control, encode_with_control, inspect, materialize_with_control,
    render_preview_with_control,
};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, State,
    ipc::{InvokeBody, Request, Response},
};

use super::{
    source_resolver::resolve_source,
    tasks::NativeImageTasks,
    temporary::{NativeTemporaryStore, TemporaryArtifactResponse},
};
use crate::storage::NativeImageStore;

const IMAGE_PROCESSING_API_VERSION: u8 = 1;
type NativeCommandFailure = (&'static str, String);
type DecodedNativeRequest = (NativeProcessRequest, Vec<u8>, Vec<u8>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProcessRequest {
    api_version: u8,
    request_id: String,
    operation: NativeOperation,
    source: NativeSource,
    #[serde(default)]
    options: Option<NativeTransformOptions>,
    #[serde(default)]
    document: Option<NativeParameterDocument>,
    #[serde(default)]
    preview: Option<NativePreviewOptions>,
    #[serde(default)]
    materialize: Option<NativeMaterializeOptions>,
    #[serde(default)]
    container: Option<NativeDimensions>,
    #[serde(default)]
    assessed: Option<NativeSource>,
    inline_length: usize,
    #[serde(default)]
    assessed_inline_length: usize,
    #[serde(default)]
    destination: NativeDestination,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum NativeDestination {
    #[default]
    Memory,
    Temporary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum NativeOperation {
    Inspect,
    Encode,
    RenderPreview,
    Materialize,
    CreateShareAssets,
    CompareQuality,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum NativeSource {
    Inline,
    Stored {
        scope: String,
        scope_key: String,
        id: String,
        variant: String,
        revision: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeTransformOptions {
    format: String,
    #[serde(default)]
    profile: Option<String>,
    quality: u8,
    compression_gain: f64,
    allow_alpha_loss: bool,
    force_encode: bool,
    #[serde(default)]
    dimensions: Option<NativeDimensions>,
}

#[derive(Debug, Deserialize)]
struct NativeDimensions {
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePreviewOptions {
    max_width: u32,
    max_height: u32,
    quality: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeMaterializeOptions {
    format: String,
    quality: u8,
    allow_alpha_loss: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProcessResponse {
    metadata: NativeMetadataResponse,
    returned_original: bool,
    data_length: usize,
    implementation: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    temporary: Option<TemporaryArtifactResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePreviewResponse {
    width: u32,
    height: u32,
    data_length: usize,
    implementation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeShareAssetsResponse {
    placeholder: picbind_image_native::NativeSharePlaceholder,
    thumbnail_mime_type: &'static str,
    data_length: usize,
    implementation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeQualityResponse {
    comparison: picbind_image_native::NativeImageQualityComparison,
    source_metrics: picbind_image_native::NativeImageAnalysis,
    assessed_metrics: picbind_image_native::NativeImageAnalysis,
    data_length: usize,
    implementation: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMetadataResponse {
    width: u32,
    height: u32,
    format: &'static str,
    mime_type: &'static str,
    size_bytes: usize,
    has_alpha: bool,
    frame_count: u8,
    orientation_applied: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCommandError {
    code: &'static str,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeProgressEvent {
    request_id: String,
    stage: &'static str,
    completed: u8,
    total: u8,
}

#[tauri::command]
pub async fn image_processing_execute(
    store: State<'_, NativeImageStore>,
    tasks: State<'_, NativeImageTasks>,
    temporary: State<'_, NativeTemporaryStore>,
    app: AppHandle,
    request: Request<'_>,
) -> Result<Response, String> {
    let (request, inline, assessed_inline) =
        decode_request(request.body()).map_err(command_error)?;
    let registration = tasks
        .start(request.request_id.clone())
        .map_err(|error| command_error(("invalidRequest", error)))?;
    let store = store.inner().clone();
    let temporary = temporary.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        execute(
            store,
            temporary,
            &app,
            &registration,
            request,
            inline,
            assessed_inline,
        )
    })
    .await
    .map_err(|error| command_error(("processingFailed", error.to_string())))?
    .map(Response::new)
    .map_err(command_error)
}

#[tauri::command]
pub fn image_processing_cancel(
    tasks: State<'_, NativeImageTasks>,
    request_id: String,
) -> Result<bool, String> {
    tasks
        .cancel(&request_id)
        .map_err(|error| command_error(("invalidRequest", error)))
}

#[tauri::command]
pub fn image_processing_release_temporary(
    temporary: State<'_, NativeTemporaryStore>,
    token: String,
) -> Result<(), String> {
    temporary
        .release(&token)
        .map_err(|error| command_error(("temporaryUnavailable", error)))
}

fn execute(
    store: NativeImageStore,
    temporary: NativeTemporaryStore,
    app: &AppHandle,
    registration: &super::tasks::NativeTaskRegistration,
    request: NativeProcessRequest,
    inline: Vec<u8>,
    assessed_inline: Vec<u8>,
) -> Result<Vec<u8>, (&'static str, String)> {
    let control = registration.control();
    checkpoint(control)?;
    emit_progress(app, &request.request_id, "resolvingSource", 0);
    let source = resolve_source(&store, &request.source, inline)?;
    checkpoint(control)?;
    emit_progress(app, &request.request_id, "resolvingSource", 1);
    match request.operation {
        NativeOperation::Inspect => {
            emit_progress(app, &request.request_id, "decoding", 0);
            let metadata = inspect(&source).map_err(|error| ("decodeFailed", error.to_string()))?;
            checkpoint(control)?;
            emit_progress(app, &request.request_id, "decoding", 1);
            let response = encode_response(
                metadata,
                false,
                Vec::new(),
                NativeDestination::Memory,
                &temporary,
                control,
            )?;
            emit_progress(app, &request.request_id, "completed", 1);
            Ok(response)
        }
        NativeOperation::Encode => {
            emit_progress(app, &request.request_id, "encoding", 0);
            let options = request.options.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Encode options are required".to_string(),
                )
            })?;
            let automatic = options.format.eq_ignore_ascii_case("auto");
            let format = if automatic {
                NativeImageFormat::WebP
            } else {
                NativeImageFormat::parse(&options.format)
                    .map_err(|error| ("unsupportedFormat", error.to_string()))?
            };
            let compression_gain = if options.compression_gain.is_finite() {
                (options.compression_gain.clamp(0.25, 4.0) * 100.0).round() as u16
            } else {
                100
            };
            let encode_options = NativeEncodeOptions {
                format,
                quality: options.quality.clamp(1, 100),
                compression_gain,
                allow_alpha_loss: options.allow_alpha_loss,
                force_encode: options.force_encode,
                dimensions: options.dimensions.map(|dimensions| NativeImageDimensions {
                    width: dimensions.width,
                    height: dimensions.height,
                }),
            };
            let planned = match options.profile.as_deref().unwrap_or("interactive") {
                "interactive" => false,
                "planner" => true,
                _ => {
                    return Err((
                        "invalidParameters",
                        "Compression profile is invalid".to_string(),
                    ));
                }
            };
            let output = match (automatic, planned) {
                (true, true) => encode_auto_planned_with_control(&source, &encode_options, control),
                (true, false) => encode_auto_with_control(&source, &encode_options, control),
                (false, true) => encode_planned_with_control(&source, &encode_options, control),
                (false, false) => encode_with_control(&source, &encode_options, control),
            }
            .map_err(native_error)?;
            emit_progress(app, &request.request_id, "encoding", 1);
            checkpoint(control)?;
            if request.destination == NativeDestination::Temporary {
                emit_progress(app, &request.request_id, "persisting", 0);
            }
            let response = encode_response(
                output.metadata,
                output.returned_original,
                output.bytes,
                request.destination,
                &temporary,
                control,
            )?;
            checkpoint(control)?;
            if request.destination == NativeDestination::Temporary {
                emit_progress(app, &request.request_id, "persisting", 1);
            }
            emit_progress(app, &request.request_id, "completed", 1);
            Ok(response)
        }
        NativeOperation::RenderPreview => {
            emit_progress(app, &request.request_id, "rendering", 0);
            let document = required_document(request.document)?;
            let options = request.preview.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Preview options are required".to_string(),
                )
            })?;
            let output = render_preview_with_control(
                &source,
                &document,
                NativeImageDimensions {
                    width: options.max_width,
                    height: options.max_height,
                },
                options.quality,
                control,
            )
            .map_err(native_error)?;
            let response = encode_payload_response(
                &NativePreviewResponse {
                    width: output.width,
                    height: output.height,
                    data_length: output.bytes.len(),
                    implementation: "picbind-image-native/1",
                },
                output.bytes,
            )?;
            emit_progress(app, &request.request_id, "rendering", 1);
            emit_progress(app, &request.request_id, "completed", 1);
            Ok(response)
        }
        NativeOperation::Materialize => {
            emit_progress(app, &request.request_id, "rendering", 0);
            let document = required_document(request.document)?;
            let options = request.materialize.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Materialize options are required".to_string(),
                )
            })?;
            let format = if options.format.eq_ignore_ascii_case("source") {
                None
            } else {
                Some(NativeImageFormat::parse(&options.format).map_err(native_error)?)
            };
            let output = materialize_with_control(
                &source,
                &document,
                format,
                options.quality,
                options.allow_alpha_loss,
                control,
            )
            .map_err(native_error)?;
            emit_progress(app, &request.request_id, "rendering", 1);
            if request.destination == NativeDestination::Temporary {
                emit_progress(app, &request.request_id, "persisting", 0);
            }
            let response = encode_response(
                output.metadata,
                output.returned_original,
                output.bytes,
                request.destination,
                &temporary,
                control,
            )?;
            checkpoint(control)?;
            if request.destination == NativeDestination::Temporary {
                emit_progress(app, &request.request_id, "persisting", 1);
            }
            emit_progress(app, &request.request_id, "completed", 1);
            Ok(response)
        }
        NativeOperation::CreateShareAssets => {
            emit_progress(app, &request.request_id, "rendering", 0);
            let container = request.container.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Share asset container is required".to_string(),
                )
            })?;
            let assets = create_share_assets_with_control(
                &source,
                request.document.as_ref(),
                NativeImageDimensions {
                    width: container.width,
                    height: container.height,
                },
                control,
            )
            .map_err(native_error)?;
            checkpoint(control)?;
            let response = encode_payload_response(
                &NativeShareAssetsResponse {
                    placeholder: assets.placeholder,
                    thumbnail_mime_type: "image/webp",
                    data_length: assets.thumbnail.len(),
                    implementation: "picbind-image-native/1",
                },
                assets.thumbnail,
            )?;
            emit_progress(app, &request.request_id, "rendering", 1);
            emit_progress(app, &request.request_id, "completed", 1);
            Ok(response)
        }
        NativeOperation::CompareQuality => {
            emit_progress(app, &request.request_id, "analyzing", 0);
            let assessed = request.assessed.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Assessed image source is required".to_string(),
                )
            })?;
            let assessed = resolve_source(&store, &assessed, assessed_inline)?;
            checkpoint(control)?;
            let analysis =
                compare_quality_with_control(&source, &assessed, control).map_err(native_error)?;
            checkpoint(control)?;
            let response = encode_payload_response(
                &NativeQualityResponse {
                    comparison: analysis.comparison,
                    source_metrics: analysis.source_metrics,
                    assessed_metrics: analysis.assessed_metrics,
                    data_length: 0,
                    implementation: "picbind-image-native/1",
                },
                Vec::new(),
            )?;
            emit_progress(app, &request.request_id, "analyzing", 1);
            emit_progress(app, &request.request_id, "completed", 1);
            Ok(response)
        }
    }
}

fn checkpoint(control: &NativeTaskControl) -> Result<(), (&'static str, String)> {
    control.checkpoint().map_err(native_error)
}

fn emit_progress(app: &AppHandle, request_id: &str, stage: &'static str, completed: u8) {
    let _ = app.emit(
        "image-processing-progress",
        NativeProgressEvent {
            request_id: request_id.to_string(),
            stage,
            completed,
            total: 1,
        },
    );
}

fn required_document(
    document: Option<NativeParameterDocument>,
) -> Result<NativeParameterDocument, (&'static str, String)> {
    document.ok_or_else(|| {
        (
            "invalidParameters",
            "Parameter document is required".to_string(),
        )
    })
}

fn native_error(error: NativeImageError) -> (&'static str, String) {
    let code = match error {
        NativeImageError::AlphaLossDenied => "alphaLossDenied",
        NativeImageError::Cancelled => "cancelled",
        NativeImageError::InvalidDimensions(_) | NativeImageError::InvalidParameters(_) => {
            "invalidParameters"
        }
        NativeImageError::UnsupportedOperation(_) => "unsupportedOperation",
        NativeImageError::UnsupportedFormat(_) => "unsupportedFormat",
        NativeImageError::InputTooLarge => "inputTooLarge",
        NativeImageError::InvalidImage(_) => "decodeFailed",
        NativeImageError::EncodeFailed(_) => "encodeFailed",
    };
    (code, error.to_string())
}

fn decode_request(body: &InvokeBody) -> Result<DecodedNativeRequest, NativeCommandFailure> {
    let InvokeBody::Raw(frame) = body else {
        return Err((
            "invalidParameters",
            "Native image processing requires a binary request".to_string(),
        ));
    };
    if frame.len() < 4 {
        return Err((
            "invalidParameters",
            "Native image processing frame is invalid".to_string(),
        ));
    }
    let metadata_length = u32::from_le_bytes(frame[..4].try_into().map_err(|_| {
        (
            "invalidParameters",
            "Native image processing frame is invalid".to_string(),
        )
    })?) as usize;
    let metadata_end = 4usize
        .checked_add(metadata_length)
        .filter(|end| *end <= frame.len())
        .ok_or_else(|| {
            (
                "invalidParameters",
                "Native image metadata length is invalid".to_string(),
            )
        })?;
    let request: NativeProcessRequest =
        serde_json::from_slice(&frame[4..metadata_end]).map_err(|error| {
            (
                "invalidParameters",
                format!("Invalid native image metadata: {error}"),
            )
        })?;
    if request.api_version != IMAGE_PROCESSING_API_VERSION {
        return Err((
            "invalidRequest",
            format!(
                "Unsupported image processing API version {}",
                request.api_version
            ),
        ));
    }
    let payload_length = request
        .inline_length
        .checked_add(request.assessed_inline_length)
        .ok_or_else(|| {
            (
                "invalidParameters",
                "Native image data length is invalid".to_string(),
            )
        })?;
    if payload_length != frame.len() - metadata_end {
        return Err((
            "invalidParameters",
            "Native image data length is invalid".to_string(),
        ));
    }
    let source_end = metadata_end + request.inline_length;
    let inline = frame[metadata_end..source_end].to_vec();
    let assessed_inline = frame[source_end..].to_vec();
    Ok((request, inline, assessed_inline))
}

fn encode_response(
    metadata: NativeImageMetadata,
    returned_original: bool,
    bytes: Vec<u8>,
    destination: NativeDestination,
    temporary_store: &NativeTemporaryStore,
    control: &NativeTaskControl,
) -> Result<Vec<u8>, (&'static str, String)> {
    let (payload, temporary) = match destination {
        NativeDestination::Memory => (bytes, None),
        NativeDestination::Temporary => {
            checkpoint(control)?;
            let artifact = temporary_store
                .create(metadata.mime_type, &bytes)
                .map_err(|error| ("persistenceFailed", error))?;
            if let Err(error) = checkpoint(control) {
                let _ = temporary_store.release(&artifact.token);
                return Err(error);
            }
            (Vec::new(), Some(artifact))
        }
    };
    let response = NativeProcessResponse {
        metadata: NativeMetadataResponse {
            width: metadata.width,
            height: metadata.height,
            format: match metadata.format {
                NativeImageFormat::Jpeg => "jpeg",
                NativeImageFormat::Png => "png",
                NativeImageFormat::WebP => "webp",
                NativeImageFormat::Avif => "avif",
            },
            mime_type: metadata.mime_type,
            size_bytes: metadata.size_bytes,
            has_alpha: metadata.has_alpha,
            frame_count: 1,
            orientation_applied: false,
        },
        returned_original,
        data_length: payload.len(),
        implementation: "picbind-image-native/1",
        temporary,
    };
    encode_payload_response(&response, payload)
}

fn encode_payload_response<T: Serialize>(
    response: &T,
    bytes: Vec<u8>,
) -> Result<Vec<u8>, (&'static str, String)> {
    let metadata =
        serde_json::to_vec(response).map_err(|error| ("processingFailed", error.to_string()))?;
    let metadata_length = u32::try_from(metadata.len()).map_err(|_| {
        (
            "processingFailed",
            "Native response metadata is too large".to_string(),
        )
    })?;
    let mut frame = Vec::with_capacity(4 + metadata.len() + bytes.len());
    frame.extend_from_slice(&metadata_length.to_le_bytes());
    frame.extend_from_slice(&metadata);
    frame.extend_from_slice(&bytes);
    Ok(frame)
}

fn command_error(error: (&'static str, String)) -> String {
    serde_json::to_string(&NativeCommandError {
        code: error.0,
        message: error.1,
    })
    .unwrap_or_else(|_| {
        "{\"code\":\"processingFailed\",\"message\":\"Native image processing failed\"}".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_mismatched_inline_lengths() {
        let metadata = br#"{"apiVersion":1,"requestId":"test-1","operation":"inspect","source":{"kind":"inline"},"inlineLength":2}"#;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        frame.extend_from_slice(metadata);
        frame.push(1);
        let error = decode_request(&InvokeBody::Raw(frame)).unwrap_err();
        assert_eq!(error.0, "invalidParameters");
    }

    #[test]
    fn splits_two_inline_sources_without_base64() {
        let metadata = br#"{"apiVersion":1,"requestId":"test-2","operation":"compareQuality","source":{"kind":"inline"},"assessed":{"kind":"inline"},"inlineLength":2,"assessedInlineLength":3}"#;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        frame.extend_from_slice(metadata);
        frame.extend_from_slice(&[1, 2, 3, 4, 5]);
        let (_, source, assessed) = decode_request(&InvokeBody::Raw(frame)).unwrap();
        assert_eq!(source, [1, 2]);
        assert_eq!(assessed, [3, 4, 5]);
    }

    #[test]
    fn rejects_unknown_api_versions() {
        let metadata = br#"{"apiVersion":2,"requestId":"test-3","operation":"inspect","source":{"kind":"inline"},"inlineLength":1}"#;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        frame.extend_from_slice(metadata);
        frame.push(1);
        let error = decode_request(&InvokeBody::Raw(frame)).unwrap_err();
        assert_eq!(error.0, "invalidRequest");
    }
}
