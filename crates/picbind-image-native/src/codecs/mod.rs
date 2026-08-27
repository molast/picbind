pub(crate) mod avif;
pub(crate) mod jpeg;
pub(crate) mod jpeg_xl;
pub(crate) mod png;
pub(crate) mod webp;

use image::DynamicImage;

use crate::{NativeImageError, NativeImageFormat};

pub(crate) fn encode(
    image: &DynamicImage,
    format: NativeImageFormat,
    quality: u8,
    allow_alpha_loss: bool,
) -> Result<Vec<u8>, NativeImageError> {
    match format {
        NativeImageFormat::Jpeg => jpeg::encode(image, quality, allow_alpha_loss),
        NativeImageFormat::JpegXl => jpeg_xl::encode(image, quality),
        NativeImageFormat::Png => png::encode(image, quality),
        NativeImageFormat::WebP => webp::encode(image, quality),
        NativeImageFormat::Avif => avif::encode(image, quality),
    }
}
