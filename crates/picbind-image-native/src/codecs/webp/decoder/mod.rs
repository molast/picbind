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
