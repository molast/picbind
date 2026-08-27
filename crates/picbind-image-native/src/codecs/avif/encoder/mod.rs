use image::{DynamicImage, RgbaImage};
use ravif::{AlphaColorMode, BitDepth, ColorModel, Encoder, Img};
use rgb::FromSlice;

use crate::NativeImageError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AvifEncoderOptions {
    pub quality: u8,
    pub alpha_quality: Option<u8>,
    pub speed: u8,
    pub color_model: ColorModel,
    pub alpha_color_mode: AlphaColorMode,
    pub bit_depth: BitDepth,
    /// None uses ravif's global Rayon thread pool.
    pub num_threads: Option<usize>,
}

impl AvifEncoderOptions {
    pub(crate) fn new(quality: u8) -> Self {
        Self {
            quality,
            ..Self::default()
        }
    }

    fn validate(&self) -> Result<(), NativeImageError> {
        if !(1..=100).contains(&self.quality) {
            return Err(NativeImageError::InvalidParameters(
                "AVIF quality must be between 1 and 100".into(),
            ));
        }
        if self
            .alpha_quality
            .is_some_and(|quality| !(1..=100).contains(&quality))
        {
            return Err(NativeImageError::InvalidParameters(
                "AVIF alpha quality must be between 1 and 100".into(),
            ));
        }
        if !(1..=10).contains(&self.speed) {
            return Err(NativeImageError::InvalidParameters(
                "AVIF speed must be between 1 and 10".into(),
            ));
        }
        if self.num_threads == Some(0) {
            return Err(NativeImageError::InvalidParameters(
                "AVIF encoder thread count must be greater than zero".into(),
            ));
        }
        Ok(())
    }
}

impl Default for AvifEncoderOptions {
    fn default() -> Self {
        Self {
            quality: 80,
            alpha_quality: None,
            speed: 9,
            color_model: ColorModel::YCbCr,
            alpha_color_mode: AlphaColorMode::UnassociatedClean,
            bit_depth: BitDepth::Eight,
            num_threads: None,
        }
    }
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &AvifEncoderOptions::new(quality))
}

pub(crate) fn encode_with_options(
    image: &DynamicImage,
    options: &AvifEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    match image.as_rgba8() {
        Some(rgba) => encode_rgba_with_options(rgba, options),
        None => encode_rgba_with_options(&image.to_rgba8(), options),
    }
}

pub(crate) fn encode_rgba(rgba: &RgbaImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_rgba_with_options(rgba, &AvifEncoderOptions::new(quality))
}

pub(crate) fn encode_rgba_with_options(
    rgba: &RgbaImage,
    options: &AvifEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    let encoder = Encoder::new()
        .with_quality(f32::from(options.quality))
        .with_alpha_quality(f32::from(options.alpha_quality.unwrap_or(options.quality)))
        .with_speed(options.speed)
        .with_internal_color_model(options.color_model)
        .with_alpha_color_mode(options.alpha_color_mode)
        .with_bit_depth(options.bit_depth)
        .with_num_threads(options.num_threads);
    let pixels = rgba.as_raw().as_slice().as_rgba();
    let image = Img::new(pixels, rgba.width() as usize, rgba.height() as usize);
    encoder
        .encode_rgba(image)
        .map(|encoded| encoded.avif_file)
        .map_err(|error| NativeImageError::EncodeFailed(format!("AVIF: {error}")))
}
