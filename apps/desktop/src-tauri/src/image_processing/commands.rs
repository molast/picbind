use picbind_image_native::{
    NativeEncodeOptions, NativeImageDimensions, NativeImageError, NativeImageFormat,
    NativeImageMetadata, NativeParameterDocument, compare_quality, create_share_assets, encode,
    encode_auto, encode_auto_planned, encode_planned, inspect, materialize, render_preview,
};
use serde::{Deserialize, Serialize};
use tauri::{
    State,
    ipc::{InvokeBody, Request, Response},
};

use crate::storage::NativeImageStore;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProcessRequest {
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
enum NativeSource {
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

#[tauri::command]
pub async fn image_processing_execute(
    state: State<'_, NativeImageStore>,
    request: Request<'_>,
) -> Result<Response, String> {
    let (request, inline, assessed_inline) =
        decode_request(request.body()).map_err(command_error)?;
    let store = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || execute(store, request, inline, assessed_inline))
        .await
        .map_err(|error| command_error(("processingFailed", error.to_string())))?
        .map(Response::new)
        .map_err(command_error)
}

fn execute(
    store: NativeImageStore,
    request: NativeProcessRequest,
    inline: Vec<u8>,
    assessed_inline: Vec<u8>,
) -> Result<Vec<u8>, (&'static str, String)> {
    let source = resolve_source(&store, &request.source, inline)?;
    match request.operation {
        NativeOperation::Inspect => {
            let metadata = inspect(&source).map_err(|error| ("decodeFailed", error.to_string()))?;
            encode_response(metadata, false, Vec::new())
        }
        NativeOperation::Encode => {
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
                (true, true) => encode_auto_planned(&source, &encode_options),
                (true, false) => encode_auto(&source, &encode_options),
                (false, true) => encode_planned(&source, &encode_options),
                (false, false) => encode(&source, &encode_options),
            }
            .map_err(native_error)?;
            encode_response(output.metadata, output.returned_original, output.bytes)
        }
        NativeOperation::RenderPreview => {
            let document = required_document(request.document)?;
            let options = request.preview.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Preview options are required".to_string(),
                )
            })?;
            let output = render_preview(
                &source,
                &document,
                NativeImageDimensions {
                    width: options.max_width,
                    height: options.max_height,
                },
                options.quality,
            )
            .map_err(native_error)?;
            encode_payload_response(
                &NativePreviewResponse {
                    width: output.width,
                    height: output.height,
                    data_length: output.bytes.len(),
                    implementation: "picbind-image-native/1",
                },
                output.bytes,
            )
        }
        NativeOperation::Materialize => {
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
            let output = materialize(
                &source,
                &document,
                format,
                options.quality,
                options.allow_alpha_loss,
            )
            .map_err(native_error)?;
            encode_response(output.metadata, output.returned_original, output.bytes)
        }
        NativeOperation::CreateShareAssets => {
            let container = request.container.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Share asset container is required".to_string(),
                )
            })?;
            let assets = create_share_assets(
                &source,
                request.document.as_ref(),
                NativeImageDimensions {
                    width: container.width,
                    height: container.height,
                },
            )
            .map_err(native_error)?;
            encode_payload_response(
                &NativeShareAssetsResponse {
                    placeholder: assets.placeholder,
                    thumbnail_mime_type: "image/webp",
                    data_length: assets.thumbnail.len(),
                    implementation: "picbind-image-native/1",
                },
                assets.thumbnail,
            )
        }
        NativeOperation::CompareQuality => {
            let assessed = request.assessed.ok_or_else(|| {
                (
                    "invalidParameters",
                    "Assessed image source is required".to_string(),
                )
            })?;
            let assessed = resolve_source(&store, &assessed, assessed_inline)?;
            let analysis = compare_quality(&source, &assessed).map_err(native_error)?;
            encode_payload_response(
                &NativeQualityResponse {
                    comparison: analysis.comparison,
                    source_metrics: analysis.source_metrics,
                    assessed_metrics: analysis.assessed_metrics,
                    data_length: 0,
                    implementation: "picbind-image-native/1",
                },
                Vec::new(),
            )
        }
    }
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

fn resolve_source(
    store: &NativeImageStore,
    source: &NativeSource,
    inline: Vec<u8>,
) -> Result<Vec<u8>, (&'static str, String)> {
    match source {
        NativeSource::Inline => {
            if inline.is_empty() {
                Err(("invalidSource", "Inline image data is empty".to_string()))
            } else {
                Ok(inline)
            }
        }
        NativeSource::Stored {
            scope,
            scope_key,
            id,
            variant,
            revision,
        } => {
            if !inline.is_empty() {
                return Err((
                    "invalidSource",
                    "Stored sources cannot contain inline data".to_string(),
                ));
            }
            let record = store
                .get(scope, scope_key, id)
                .map_err(|error| ("sourceUnavailable", error))?
                .ok_or_else(|| {
                    (
                        "sourceUnavailable",
                        "Stored image was not found".to_string(),
                    )
                })?;
            if record.revision != *revision {
                return Err((
                    "sourceChanged",
                    "Stored image revision has changed".to_string(),
                ));
            }
            store
                .read(scope, scope_key, id, variant)
                .map_err(|error| ("sourceUnavailable", error))
        }
    }
}

fn decode_request(
    body: &InvokeBody,
) -> Result<(NativeProcessRequest, Vec<u8>, Vec<u8>), (&'static str, String)> {
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
) -> Result<Vec<u8>, (&'static str, String)> {
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
        data_length: bytes.len(),
        implementation: "picbind-image-native/1",
    };
    encode_payload_response(&response, bytes)
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
        let metadata = br#"{"operation":"inspect","source":{"kind":"inline"},"inlineLength":2}"#;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        frame.extend_from_slice(metadata);
        frame.push(1);
        let error = decode_request(&InvokeBody::Raw(frame)).unwrap_err();
        assert_eq!(error.0, "invalidParameters");
    }

    #[test]
    fn splits_two_inline_sources_without_base64() {
        let metadata = br#"{"operation":"compareQuality","source":{"kind":"inline"},"assessed":{"kind":"inline"},"inlineLength":2,"assessedInlineLength":3}"#;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        frame.extend_from_slice(metadata);
        frame.extend_from_slice(&[1, 2, 3, 4, 5]);
        let (_, source, assessed) = decode_request(&InvokeBody::Raw(frame)).unwrap();
        assert_eq!(source, [1, 2]);
        assert_eq!(assessed, [3, 4, 5]);
    }
}
