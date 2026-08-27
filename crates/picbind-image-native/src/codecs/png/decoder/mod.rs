use image::{DynamicImage, GrayAlphaImage, GrayImage, RgbImage, RgbaImage};
use zune_core::{bytestream::ZCursor, colorspace::ColorSpace, options::DecoderOptions};
use zune_png::PngDecoder;

use crate::{MAX_DIMENSION, NativeImageError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PngDecoderOptions {
    pub strict_mode: bool,
    pub use_unsafe: bool,
    pub strip_to_8bit: bool,
}

impl Default for PngDecoderOptions {
    fn default() -> Self {
        Self {
            strict_mode: true,
            use_unsafe: true,
            strip_to_8bit: true,
        }
    }
}

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    decode_with_options(input, &PngDecoderOptions::default())
}

pub(crate) fn decode_with_options(
    input: &[u8],
    options: &PngDecoderOptions,
) -> Result<DynamicImage, NativeImageError> {
    let decoder_options = DecoderOptions::new_fast()
        .set_strict_mode(options.strict_mode)
        .set_use_unsafe(options.use_unsafe)
        .set_max_width(MAX_DIMENSION as usize)
        .set_max_height(MAX_DIMENSION as usize)
        .png_set_strip_to_8bit(options.strip_to_8bit)
        .png_set_decode_animated(false);
    let mut decoder = PngDecoder::new_with_options(ZCursor::new(input), decoder_options);
    let result = decoder
        .decode()
        .map_err(|error| NativeImageError::InvalidImage(format!("PNG decode failed: {error}")))?;
    let pixels = result.u8().ok_or_else(|| {
        NativeImageError::InvalidImage(
            "PNG decoder returned a non-8-bit buffer; enable strip_to_8bit".into(),
        )
    })?;
    let (width, height) = decoder.dimensions().ok_or_else(|| {
        NativeImageError::InvalidImage("PNG decoder did not return dimensions".into())
    })?;
    let colorspace = decoder.colorspace().ok_or_else(|| {
        NativeImageError::InvalidImage("PNG decoder did not return a colorspace".into())
    })?;

    dynamic_image_from_pixels(pixels, width as u32, height as u32, colorspace)
}

fn dynamic_image_from_pixels(
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    colorspace: ColorSpace,
) -> Result<DynamicImage, NativeImageError> {
    let image = match colorspace {
        ColorSpace::Luma => {
            GrayImage::from_vec(width, height, pixels).map(DynamicImage::ImageLuma8)
        }
        ColorSpace::LumaA => {
            GrayAlphaImage::from_vec(width, height, pixels).map(DynamicImage::ImageLumaA8)
        }
        ColorSpace::RGB => RgbImage::from_vec(width, height, pixels).map(DynamicImage::ImageRgb8),
        ColorSpace::RGBA => {
            RgbaImage::from_vec(width, height, pixels).map(DynamicImage::ImageRgba8)
        }
        _ => {
            return Err(NativeImageError::InvalidImage(format!(
                "unsupported PNG colorspace: {colorspace:?}"
            )));
        }
    };
    image.ok_or_else(|| {
        NativeImageError::InvalidImage("PNG decoder returned an invalid pixel buffer".into())
    })
}
