use image::DynamicImage;

use crate::{
    MAX_DIMENSION, MAX_PIXELS, NativeImageDimensions, NativeImageError, NativeImageFormat, formats,
};

const THUMBNAIL_QUALITY: u8 = 78;

pub(super) fn validate_container(container: NativeImageDimensions) -> Result<(), NativeImageError> {
    if container.width == 0
        || container.height == 0
        || container.width > MAX_DIMENSION
        || container.height > MAX_DIMENSION
        || u64::from(container.width) * u64::from(container.height) > MAX_PIXELS
    {
        return Err(NativeImageError::InvalidDimensions(
            "share thumbnail dimensions exceed the native size limits".into(),
        ));
    }
    Ok(())
}

pub(super) fn generate(
    image: &DynamicImage,
    container: NativeImageDimensions,
) -> Result<Vec<u8>, NativeImageError> {
    let scale = (f64::from(container.width) / f64::from(image.width()))
        .min(f64::from(container.height) / f64::from(image.height()))
        .min(1.0);
    let width = (f64::from(image.width()) * scale).round().max(1.0) as u32;
    let height = (f64::from(image.height()) * scale).round().max(1.0) as u32;
    let thumbnail = image.resize_exact(width, height, image::imageops::FilterType::Lanczos3);
    formats::encode(
        &thumbnail,
        NativeImageFormat::WebP,
        THUMBNAIL_QUALITY,
        false,
    )
}
