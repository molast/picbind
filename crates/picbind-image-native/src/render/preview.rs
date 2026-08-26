use image::GenericImageView;
use serde_json::Value;

use crate::{
    MAX_DIMENSION, MAX_PIXELS, NativeImageDimensions, NativeImageError, NativeImageFormat,
    NativeOperationType, NativeParameterDocument, NativeTaskControl, decode, formats,
    parameters::{replay_image, replay_image_with_control},
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
    let (source_format, source) = decode::decode(input)?;
    if let Some(control) = control {
        control.checkpoint()?;
    }
    let (logical_width, logical_height) = final_dimensions(source.dimensions(), document)?;
    let scale = (f64::from(bounds.width) / f64::from(logical_width))
        .min(f64::from(bounds.height) / f64::from(logical_height))
        .min(1.0);
    let source_width = (f64::from(source.width()) * scale).round().max(1.0) as u32;
    let source_height = (f64::from(source.height()) * scale).round().max(1.0) as u32;
    let source = if source_width == source.width() && source_height == source.height() {
        source
    } else {
        source.resize_exact(
            source_width,
            source_height,
            image::imageops::FilterType::Lanczos3,
        )
    };
    let document = scaled_document(document, scale)?;
    let mut preview = match control {
        Some(control) => {
            replay_image_with_control(source, source_format, &document, Some(control))?
        }
        None => replay_image(source, source_format, &document)?,
    }
    .into_image();
    let preview_width = (f64::from(logical_width) * scale).round().max(1.0) as u32;
    let preview_height = (f64::from(logical_height) * scale).round().max(1.0) as u32;
    if preview.width() != preview_width || preview.height() != preview_height {
        preview = preview.resize_exact(
            preview_width,
            preview_height,
            image::imageops::FilterType::Lanczos3,
        );
    }
    let bytes = formats::encode(&preview, NativeImageFormat::WebP, quality, false)?;
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
