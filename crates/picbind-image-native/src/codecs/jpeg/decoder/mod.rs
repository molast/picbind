use image::{DynamicImage, RgbImage};
use zune_core::{bytestream::ZCursor, colorspace::ColorSpace, options::DecoderOptions};
use zune_jpeg::JpegDecoder;

use crate::{MAX_DIMENSION, NativeImageError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct JpegDecoderOptions {
    pub strict_mode: bool,
    pub use_unsafe: bool,
    pub max_scans: usize,
}

impl JpegDecoderOptions {
    fn validate(&self) -> Result<(), NativeImageError> {
        if self.max_scans == 0 {
            return Err(NativeImageError::InvalidParameters(
                "JPEG decoder max scans must be greater than zero".into(),
            ));
        }
        Ok(())
    }
}

impl Default for JpegDecoderOptions {
    fn default() -> Self {
        Self {
            strict_mode: true,
            use_unsafe: true,
            max_scans: 100,
        }
    }
}

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    decode_with_options(input, &JpegDecoderOptions::default())
}

pub(crate) fn decode_with_options(
    input: &[u8],
    options: &JpegDecoderOptions,
) -> Result<DynamicImage, NativeImageError> {
    options.validate()?;
    let decoder_options = DecoderOptions::new_fast()
        .set_strict_mode(options.strict_mode)
        .set_use_unsafe(options.use_unsafe)
        .set_max_width(MAX_DIMENSION as usize)
        .set_max_height(MAX_DIMENSION as usize)
        .jpeg_set_max_scans(options.max_scans)
        .jpeg_set_out_colorspace(ColorSpace::RGB);
    let mut decoder = JpegDecoder::new_with_options(ZCursor::new(input), decoder_options);
    let pixels = decoder
        .decode()
        .map_err(|error| NativeImageError::InvalidImage(format!("JPEG decode failed: {error}")))?;
    let (width, height) = decoder.dimensions().ok_or_else(|| {
        NativeImageError::InvalidImage("JPEG decoder did not return dimensions".into())
    })?;

    RgbImage::from_vec(width as u32, height as u32, pixels)
        .map(DynamicImage::ImageRgb8)
        .ok_or_else(|| {
            NativeImageError::InvalidImage("JPEG decoder returned an invalid RGB buffer".into())
        })
}
