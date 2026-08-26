mod auto;
mod matrix;
mod planned;
mod resize;
mod same_format;

use image::{DynamicImage, RgbaImage};

use crate::{NativeEncodeOptions, NativeImageFormat, encode, formats};

pub(super) fn source_image() -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_fn(24, 18, |x, y| {
        image::Rgba([(x * 9) as u8, (y * 11) as u8, 140, 255])
    }))
}

pub(super) fn seed(format: NativeImageFormat) -> Vec<u8> {
    let image = source_image();
    formats::encode(&image, format, 82, true).unwrap()
}

pub(super) fn transform(
    source: &[u8],
    format: NativeImageFormat,
    force_encode: bool,
) -> crate::NativeImageOutput {
    encode(
        source,
        &NativeEncodeOptions {
            format,
            quality: 80,
            compression_gain: 100,
            allow_alpha_loss: true,
            force_encode,
            dimensions: None,
        },
    )
    .unwrap()
}
