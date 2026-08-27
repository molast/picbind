use image::{DynamicImage, RgbaImage};

use crate::NativeImageError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebPEncoderOptions {
    pub quality: u8,
    pub method: u8,
    pub alpha_quality: u8,
}

impl WebPEncoderOptions {
    pub(crate) fn new(quality: u8) -> Self {
        Self {
            quality,
            ..Self::default()
        }
    }

    fn validate(&self) -> Result<(), NativeImageError> {
        if !(1..=100).contains(&self.quality) {
            return Err(NativeImageError::InvalidParameters(
                "WebP quality must be between 1 and 100".into(),
            ));
        }
        if self.method > 6 {
            return Err(NativeImageError::InvalidParameters(
                "WebP method must be between 0 and 6".into(),
            ));
        }
        if self.alpha_quality > 100 {
            return Err(NativeImageError::InvalidParameters(
                "WebP alpha quality must be between 0 and 100".into(),
            ));
        }
        Ok(())
    }
}

impl Default for WebPEncoderOptions {
    fn default() -> Self {
        Self {
            quality: 80,
            method: 5,
            alpha_quality: 100,
        }
    }
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &WebPEncoderOptions::new(quality))
}

pub(crate) fn encode_with_options(
    image: &DynamicImage,
    options: &WebPEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    match image.as_rgba8() {
        Some(rgba) => encode_rgba_with_options(rgba, options),
        None => encode_rgba_with_options(&image.to_rgba8(), options),
    }
}

pub(crate) fn encode_rgba(rgba: &RgbaImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_rgba_with_options(rgba, &WebPEncoderOptions::new(quality))
}

pub(crate) fn encode_rgba_with_options(
    rgba: &RgbaImage,
    options: &WebPEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    let config = zenwebp::LossyConfig::new()
        .with_quality(f32::from(options.quality))
        .with_method(options.method)
        .with_alpha_quality(options.alpha_quality);
    zenwebp::EncodeRequest::lossy(
        &config,
        rgba,
        zenwebp::PixelLayout::Rgba8,
        rgba.width(),
        rgba.height(),
    )
    .encode()
    .map_err(|error| NativeImageError::EncodeFailed(format!("WebP: {error}")))
}
