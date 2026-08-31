use image::{DynamicImage, RgbaImage};
use zenpixels::PixelDescriptor;

use crate::NativeImageError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AvifDecoderOptions {
    /// Keep this at one until rav1d-safe's ARM tile-threading panic is fixed.
    pub threads: u32,
    /// Normalize 10/12-bit AVIF sources to the pipeline's RGBA8 model.
    pub prefer_8bit: bool,
}

impl Default for AvifDecoderOptions {
    fn default() -> Self {
        Self {
            threads: 1,
            prefer_8bit: true,
        }
    }
}

pub fn decode_avif(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    decode_avif_with_options(input, &AvifDecoderOptions::default())
}

pub(crate) fn decode_avif_with_options(
    input: &[u8],
    options: &AvifDecoderOptions,
) -> Result<DynamicImage, NativeImageError> {
    let config = zenavif::DecoderConfig::new()
        .threads(options.threads)
        .prefer_8bit(options.prefer_8bit);
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
