use image::{DynamicImage, RgbaImage};
use zune_core::{bit_depth::BitDepth, colorspace::ColorSpace, options::EncoderOptions};
use zune_jpegxl::JxlSimpleEncoder;

use crate::NativeImageError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct JpegXlEncoderOptions {
    pub effort: u8,
    /// Zero disables the encoder's scoped worker threads.
    pub num_threads: u8,
    pub bit_depth: BitDepth,
}

impl JpegXlEncoderOptions {
    fn validate(&self) -> Result<(), NativeImageError> {
        if self.effort > 127 {
            return Err(NativeImageError::InvalidParameters(
                "JPEG XL effort must be between 0 and 127".into(),
            ));
        }
        if self.bit_depth != BitDepth::Eight {
            return Err(NativeImageError::InvalidParameters(
                "JPEG XL Native encoding currently supports RGBA8/RGB8 pixels".into(),
            ));
        }
        Ok(())
    }
}

impl Default for JpegXlEncoderOptions {
    fn default() -> Self {
        Self {
            effort: 4,
            num_threads: 4,
            bit_depth: BitDepth::Eight,
        }
    }
}

pub(crate) fn encode(image: &DynamicImage, _quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &JpegXlEncoderOptions::default())
}

pub(crate) fn encode_with_options(
    image: &DynamicImage,
    options: &JpegXlEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    if crate::decode::has_transparency(image) {
        match image.as_rgba8() {
            Some(rgba) => encode_rgba_with_options(rgba, options),
            None => encode_rgba_with_options(&image.to_rgba8(), options),
        }
    } else {
        let rgb = image.to_rgb8();
        encode_pixels(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ColorSpace::RGB,
            options,
        )
    }
}

pub(crate) fn encode_rgba_with_options(
    rgba: &RgbaImage,
    options: &JpegXlEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    encode_pixels(
        rgba.as_raw(),
        rgba.width(),
        rgba.height(),
        ColorSpace::RGBA,
        options,
    )
}

fn encode_pixels(
    pixels: &[u8],
    width: u32,
    height: u32,
    color_space: ColorSpace,
    options: &JpegXlEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    let encoder_options = EncoderOptions::new(
        width as usize,
        height as usize,
        color_space,
        options.bit_depth,
    )
    .set_effort(options.effort)
    .set_num_threads(options.num_threads)
    .set_strip_metadata(true);
    let mut output = Vec::new();
    JxlSimpleEncoder::new(pixels, encoder_options)
        .encode(&mut output)
        .map_err(|error| NativeImageError::EncodeFailed(format!("JPEG XL: {error}")))?;
    Ok(output)
}
