mod color;
mod crop;
mod draw;
mod model;
mod rotate;
mod validation;

use image::DynamicImage;

use crate::{NativeImageError, decode};

pub use model::{
    NativeImageOperation, NativeOperationType, NativeParameterDocument, NativeRenderedImage,
};

pub fn replay_parameters(
    input: &[u8],
    document: &NativeParameterDocument,
) -> Result<NativeRenderedImage, NativeImageError> {
    let (source_format, image) = decode::decode(input)?;
    replay_image(image, source_format, document)
}

pub(crate) fn replay_image(
    mut image: DynamicImage,
    source_format: crate::NativeImageFormat,
    document: &NativeParameterDocument,
) -> Result<NativeRenderedImage, NativeImageError> {
    validation::validate_document(document)?;
    for operation in &document.operations {
        image = apply_operation(image, operation)?;
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
    crate::resize::apply(image, Some(dimensions)).map(|(image, _)| image)
}

fn unsupported(operation: &str) -> Result<DynamicImage, NativeImageError> {
    Err(NativeImageError::UnsupportedOperation(operation.into()))
}

#[cfg(test)]
mod tests;
