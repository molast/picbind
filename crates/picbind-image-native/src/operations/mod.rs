mod color;
mod crop;
mod draw;
mod model;
pub(crate) mod resize;
mod rotate;
mod validation;

use image::DynamicImage;

use crate::{NativeImageError, NativeTaskControl, decode};

pub use model::{
    NativeImageOperation, NativeOperationType, NativeParameterDocument, NativeRenderedImage,
};

pub fn replay_parameters(
    input: &[u8],
    document: &NativeParameterDocument,
) -> Result<NativeRenderedImage, NativeImageError> {
    let (source_format, image) = decode::decode(input)?;
    replay_image_with_control(image, source_format, document, None)
}

pub fn replay_parameters_with_control(
    input: &[u8],
    document: &NativeParameterDocument,
    control: &NativeTaskControl,
) -> Result<NativeRenderedImage, NativeImageError> {
    control.checkpoint()?;
    let (source_format, image) = decode::decode(input)?;
    control.checkpoint()?;
    replay_image_with_control(image, source_format, document, Some(control))
}

pub(crate) fn replay_image(
    image: DynamicImage,
    source_format: crate::NativeImageFormat,
    document: &NativeParameterDocument,
) -> Result<NativeRenderedImage, NativeImageError> {
    replay_image_with_control(image, source_format, document, None)
}

pub(crate) fn replay_image_with_control(
    mut image: DynamicImage,
    source_format: crate::NativeImageFormat,
    document: &NativeParameterDocument,
    control: Option<&NativeTaskControl>,
) -> Result<NativeRenderedImage, NativeImageError> {
    validation::validate_document(document)?;
    for operation in &document.operations {
        if let Some(control) = control {
            control.checkpoint()?;
        }
        image = apply_operation(image, operation)?;
    }
    if let Some(control) = control {
        control.checkpoint()?;
    }
    Ok(NativeRenderedImage {
        image,
        source_format,
    })
}

fn apply_operation(
    image: DynamicImage,
    operation: &NativeImageOperation,
) -> Result<DynamicImage, NativeImageError> {
    match operation.operation_type {
        NativeOperationType::Crop => crop::apply(image, &operation.params),
        NativeOperationType::Resize => resize_operation(image, &operation.params),
        NativeOperationType::Rotate => rotate::apply(image, &operation.params),
        NativeOperationType::Color => color::apply(image, &operation.params),
        NativeOperationType::Draw => draw::apply(image, &operation.params),
        NativeOperationType::Filter => unsupported("filter"),
        NativeOperationType::Annotation => unsupported("annotation"),
        NativeOperationType::Ai => unsupported("ai"),
    }
}

fn resize_operation(
    image: DynamicImage,
    params: &serde_json::Value,
) -> Result<DynamicImage, NativeImageError> {
    let dimensions = validation::dimensions(params)?;
    resize::apply(image, Some(dimensions)).map(|(image, _)| image)
}

fn unsupported(operation: &str) -> Result<DynamicImage, NativeImageError> {
    Err(NativeImageError::UnsupportedOperation(operation.into()))
}

#[cfg(test)]
mod tests;
