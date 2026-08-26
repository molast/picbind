use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbaImage};
use zenpixels::PixelDescriptor;

use crate::NativeImageError;

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    let config = zenavif::DecoderConfig::new().threads(1).prefer_8bit(true);
    let decoded = zenavif::decode_with(input, &config, &zenavif::Unstoppable)
        .map_err(|error| NativeImageError::InvalidImage(format!("AVIF decode failed: {error}")))?;
    let width = decoded.width();
    let height = decoded.height();
    let descriptor = decoded.descriptor();
    let pixels = decoded.copy_to_contiguous_bytes();
    let rgba = if descriptor.layout_compatible(PixelDescriptor::RGBA8) {
        pixels
    } else if descriptor.layout_compatible(PixelDescriptor::RGB8) {
        let mut rgba = Vec::with_capacity(pixels.len() / 3 * 4);
        for pixel in pixels.as_chunks::<3>().0 {
            rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
        }
        rgba
    } else {
        return Err(NativeImageError::InvalidImage(format!(
            "unsupported AVIF pixel layout: {descriptor:?}"
        )));
    };
    RgbaImage::from_vec(width, height, rgba)
        .map(DynamicImage::ImageRgba8)
        .ok_or_else(|| {
            NativeImageError::InvalidImage("AVIF decoder returned an invalid pixel buffer".into())
        })
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    let rgba = image.to_rgba8();
    let mut bytes = Vec::new();
    image::codecs::avif::AvifEncoder::new_with_speed_quality(&mut bytes, 9, quality)
        .with_num_threads(Some(1))
        .write_image(&rgba, rgba.width(), rgba.height(), ExtendedColorType::Rgba8)
        .map_err(|error| NativeImageError::EncodeFailed(format!("AVIF: {error}")))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests;
