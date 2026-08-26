use image::{DynamicImage, RgbaImage};

use crate::NativeImageError;

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    let (pixels, width, height) = zenwebp::oneshot::decode_rgba(input)
        .map_err(|error| NativeImageError::InvalidImage(format!("WebP decode failed: {error}")))?;
    RgbaImage::from_vec(width, height, pixels)
        .map(DynamicImage::ImageRgba8)
        .ok_or_else(|| {
            NativeImageError::InvalidImage("WebP decoder returned an invalid pixel buffer".into())
        })
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    let rgba = image.to_rgba8();
    let config = zenwebp::LossyConfig::new()
        .with_quality(f32::from(quality))
        .with_method(5)
        .with_alpha_quality(100);
    zenwebp::EncodeRequest::lossy(
        &config,
        &rgba,
        zenwebp::PixelLayout::Rgba8,
        rgba.width(),
        rgba.height(),
    )
    .encode()
    .map_err(|error| NativeImageError::EncodeFailed(format!("WebP: {error}")))
}

#[cfg(test)]
mod tests;
