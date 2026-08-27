use image::{DynamicImage, RgbImage};
use mozjpeg_rs::{Encoder, Preset, Subsampling};

use crate::NativeImageError;

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    image::load_from_memory_with_format(input, image::ImageFormat::Jpeg)
        .map_err(|error| NativeImageError::InvalidImage(error.to_string()))
}

pub(crate) fn encode(
    image: &DynamicImage,
    quality: u8,
    allow_alpha_loss: bool,
) -> Result<Vec<u8>, NativeImageError> {
    let rgb = prepare_rgb(image, allow_alpha_loss);
    encode_rgb(&rgb, quality)
}

pub(crate) fn prepare_rgb(image: &DynamicImage, allow_alpha_loss: bool) -> RgbImage {
    let rgba = image.to_rgba8();
    let mut rgb = RgbImage::new(rgba.width(), rgba.height());
    for (source, destination) in rgba.pixels().zip(rgb.pixels_mut()) {
        let alpha = u16::from(source[3]);
        let background = if allow_alpha_loss { 255 } else { 0 };
        for channel in 0..3 {
            destination[channel] =
                ((u16::from(source[channel]) * alpha + background * (255 - alpha)) / 255) as u8;
        }
    }
    rgb
}

pub(crate) fn encode_rgb(image: &RgbImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    let subsampling = if quality >= 96 {
        Subsampling::S444
    } else if quality >= 90 {
        Subsampling::S422
    } else {
        Subsampling::S420
    };
    Encoder::new(Preset::ProgressiveBalanced)
        .quality(quality)
        .progressive(true)
        .subsampling(subsampling)
        .optimize_huffman(true)
        .encode_rgb(image.as_raw(), image.width(), image.height())
        .map_err(|error| NativeImageError::EncodeFailed(format!("JPEG: {error}")))
}

#[cfg(test)]
mod tests;
