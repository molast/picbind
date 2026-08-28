use serde_json::Value;

use crate::{
    MAX_DIMENSION, MAX_PIXELS, NativeDecodedImage, NativeImageDimensions, NativeImageError,
    NativeOperationType, NativeParameterDocument, NativeTaskControl, codecs, decode,
    operations::{replay_image, replay_image_with_control},
};

use super::NativePreviewOutput;

pub fn render_preview(
    input: &[u8],
    document: &NativeParameterDocument,
    bounds: NativeImageDimensions,
    quality: u8,
) -> Result<NativePreviewOutput, NativeImageError> {
    render_preview_inner(input, document, bounds, quality, None)
}

pub fn render_preview_with_control(
    input: &[u8],
    document: &NativeParameterDocument,
    bounds: NativeImageDimensions,
    quality: u8,
    control: &NativeTaskControl,
) -> Result<NativePreviewOutput, NativeImageError> {
    render_preview_inner(input, document, bounds, quality, Some(control))
}

pub fn render_preview_from_decoded_with_control(
    source: &NativeDecodedImage,
    document: &NativeParameterDocument,
    bounds: NativeImageDimensions,
    quality: u8,
    control: &NativeTaskControl,
) -> Result<NativePreviewOutput, NativeImageError> {
    render_decoded_preview_inner(source, document, bounds, quality, Some(control))
}

fn render_preview_inner(
    input: &[u8],
    document: &NativeParameterDocument,
    bounds: NativeImageDimensions,
    quality: u8,
    control: Option<&NativeTaskControl>,
) -> Result<NativePreviewOutput, NativeImageError> {
    if let Some(control) = control {
        control.checkpoint()?;
    }
    validate_bounds(bounds)?;
    if !(1..=100).contains(&quality) {
        return Err(NativeImageError::InvalidParameters(
            "preview quality must be between 1 and 100".into(),
        ));
    }
    let source = decode::decode_image(input)?;
    render_decoded_preview_inner(&source, document, bounds, quality, control)
}

fn render_decoded_preview_inner(
    source: &NativeDecodedImage,
    document: &NativeParameterDocument,
    bounds: NativeImageDimensions,
    quality: u8,
    control: Option<&NativeTaskControl>,
) -> Result<NativePreviewOutput, NativeImageError> {
    validate_bounds(bounds)?;
    if !(1..=100).contains(&quality) {
        return Err(NativeImageError::InvalidParameters(
            "preview quality must be between 1 and 100".into(),
        ));
    }
    if let Some(control) = control {
        control.checkpoint()?;
    }
    let source_format = source.format;
    let source_dimensions = (source.width(), source.height());
    let (logical_width, logical_height) = final_dimensions(source_dimensions, document)?;
    let output_scale = (f64::from(bounds.width) / f64::from(logical_width))
        .min(f64::from(bounds.height) / f64::from(logical_height))
        .min(1.0);
    let cached_scale = (f64::from(source.image.width()) / f64::from(source_dimensions.0))
        .min(f64::from(source.image.height()) / f64::from(source_dimensions.1))
        .min(1.0);
    let replay_scale = output_scale.min(cached_scale);
    let replay_width = (f64::from(source_dimensions.0) * replay_scale)
        .round()
        .max(1.0) as u32;
    let replay_height = (f64::from(source_dimensions.1) * replay_scale)
        .round()
        .max(1.0) as u32;
    let preview_width = (f64::from(logical_width) * output_scale).round().max(1.0) as u32;
    let preview_height = (f64::from(logical_height) * output_scale).round().max(1.0) as u32;

    // The Original activity has no operations. Encode the already bounded
    // cached pixels by reference instead of cloning and replaying them.
    if document.operations.is_empty()
        && replay_width == source.image.width()
        && replay_height == source.image.height()
        && preview_width == source.image.width()
        && preview_height == source.image.height()
    {
        let bytes = codecs::webp::encode_preview(&source.image, quality)?;
        if let Some(control) = control {
            control.checkpoint()?;
        }
        return Ok(NativePreviewOutput {
            bytes,
            width: preview_width,
            height: preview_height,
        });
    }

    // Never copy a full-resolution cached image before downscaling. A prepared
    // collaboration source is already bounded, so normal previews only clone
    // a small pixel buffer before replaying operations.
    let source = if replay_width == source.image.width() && replay_height == source.image.height() {
        source.image.clone()
    } else {
        source.image.resize_exact(
            replay_width,
            replay_height,
            image::imageops::FilterType::Lanczos3,
        )
    };
    let document = scaled_document(document, replay_scale)?;
    let mut preview = match control {
        Some(control) => {
            replay_image_with_control(source, source_format, &document, Some(control))?
        }
        None => replay_image(source, source_format, &document)?,
    }
    .into_image();
    if preview.width() != preview_width || preview.height() != preview_height {
        preview = preview.resize_exact(
            preview_width,
            preview_height,
            image::imageops::FilterType::Lanczos3,
        );
    }
    let bytes = codecs::webp::encode_preview(&preview, quality)?;
    if let Some(control) = control {
        control.checkpoint()?;
    }
    Ok(NativePreviewOutput {
        bytes,
        width: preview_width,
        height: preview_height,
    })
}

fn final_dimensions(
    mut dimensions: (u32, u32),
    document: &NativeParameterDocument,
) -> Result<(u32, u32), NativeImageError> {
    for operation in &document.operations {
        match operation.operation_type {
            NativeOperationType::Crop => {
                let width = finite_number(&operation.params, "width", "crop")?;
                let height = finite_number(&operation.params, "height", "crop")?;
                dimensions = (
                    (f64::from(dimensions.0) * width).round().max(1.0) as u32,
                    (f64::from(dimensions.1) * height).round().max(1.0) as u32,
                );
            }
            NativeOperationType::Resize => {
                dimensions = (
                    finite_number(&operation.params, "width", "resize")?.round() as u32,
                    finite_number(&operation.params, "height", "resize")?.round() as u32,
                );
            }
            NativeOperationType::Rotate => {
                let degrees = finite_number(&operation.params, "degrees", "rotate")? as u16;
                if degrees == 90 || degrees == 270 {
                    dimensions = (dimensions.1, dimensions.0);
                }
            }
            _ => {}
        }
    }
    Ok(dimensions)
}

fn scaled_document(
    document: &NativeParameterDocument,
    scale: f64,
) -> Result<NativeParameterDocument, NativeImageError> {
    if (scale - 1.0).abs() <= f64::EPSILON {
        return Ok(document.clone());
    }
    let mut document = document.clone();
    for operation in &mut document.operations {
        match operation.operation_type {
            NativeOperationType::Resize => {
                scale_integer_field(&mut operation.params, "width", scale)?;
                scale_integer_field(&mut operation.params, "height", scale)?;
            }
            NativeOperationType::Draw => {
                let annotations = operation
                    .params
                    .get_mut("annotations")
                    .and_then(Value::as_array_mut)
                    .ok_or_else(|| {
                        NativeImageError::InvalidParameters(
                            "draw annotations must be an array".into(),
                        )
                    })?;
                for annotation in annotations {
                    for field in ["x", "y", "width", "height", "strokeWidth"] {
                        scale_field(annotation, field, scale)?;
                    }
                    if let Some(points) = annotation.get_mut("points").and_then(Value::as_array_mut)
                    {
                        for point in points {
                            scale_value(point, scale, "draw point")?;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok(document)
}

fn scale_field(object: &mut Value, field: &str, scale: f64) -> Result<(), NativeImageError> {
    if let Some(value) = object.get_mut(field) {
        scale_value(value, scale, field)?;
    }
    Ok(())
}

fn scale_integer_field(
    object: &mut Value,
    field: &str,
    scale: f64,
) -> Result<(), NativeImageError> {
    let value = object
        .get_mut(field)
        .ok_or_else(|| NativeImageError::InvalidParameters(format!("{field} is required")))?;
    let number = value
        .as_f64()
        .ok_or_else(|| NativeImageError::InvalidParameters(format!("{field} must be a number")))?;
    *value = Value::from((number * scale).round().max(1.0) as u64);
    Ok(())
}

fn scale_value(value: &mut Value, scale: f64, field: &str) -> Result<(), NativeImageError> {
    let number = value
        .as_f64()
        .ok_or_else(|| NativeImageError::InvalidParameters(format!("{field} must be a number")))?;
    *value = Value::from((number * scale).max(if field == "strokeWidth" { 0.75 } else { 0.0 }));
    Ok(())
}

fn finite_number(value: &Value, field: &str, operation: &str) -> Result<f64, NativeImageError> {
    value
        .get(field)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| {
            NativeImageError::InvalidParameters(format!("invalid {operation} {field} parameter"))
        })
}

fn validate_bounds(bounds: NativeImageDimensions) -> Result<(), NativeImageError> {
    if bounds.width == 0
        || bounds.height == 0
        || bounds.width > MAX_DIMENSION
        || bounds.height > MAX_DIMENSION
        || u64::from(bounds.width) * u64::from(bounds.height) > MAX_PIXELS
    {
        return Err(NativeImageError::InvalidDimensions(
            "preview dimensions exceed the native size limits".into(),
        ));
    }
    Ok(())
}
