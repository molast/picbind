use std::borrow::Cow;

use image::{DynamicImage, GenericImageView, RgbImage, RgbaImage};

use crate::NativeImageError;

pub(crate) type LibWebPConfig = webp::WebPConfig;

#[derive(Clone, Debug)]
pub(crate) struct WebPEncoderOptions {
    pub config: LibWebPConfig,
}

impl WebPEncoderOptions {
    pub(crate) fn new(quality: u8) -> Self {
        let mut options = Self::default();
        options.config.quality = f32::from(quality);
        options
    }

    pub(crate) fn preview(quality: u8) -> Self {
        let mut options = Self::new(quality);
        options.config.method = 0;
        options.config.thread_level = 1;
        options
    }
}

impl Default for WebPEncoderOptions {
    fn default() -> Self {
        let mut config = LibWebPConfig::new()
            .expect("the bundled libwebp encoder ABI must match its Rust bindings");
        config.quality = 80.0;
        config.method = 5;
        config.alpha_quality = 100;
        Self { config }
    }
}

#[derive(Debug)]
pub(crate) enum PreparedWebPPixels<'a> {
    Rgb(Cow<'a, RgbImage>),
    Rgba(Cow<'a, RgbaImage>),
}

impl<'a> PreparedWebPPixels<'a> {
    pub(crate) fn from_image(image: &'a DynamicImage) -> Result<Self, NativeImageError> {
        let (width, height) = image.dimensions();
        ensure_dimensions(width, height)?;

        if let Some(rgb) = image.as_rgb8() {
            return Ok(Self::Rgb(Cow::Borrowed(rgb)));
        }
        if let Some(rgba) = image.as_rgba8() {
            return Ok(Self::Rgba(Cow::Borrowed(rgba)));
        }
        if image.color().has_alpha() {
            Ok(Self::Rgba(Cow::Owned(image.to_rgba8())))
        } else {
            Ok(Self::Rgb(Cow::Owned(image.to_rgb8())))
        }
    }

    pub(crate) fn encode_with_options(
        &self,
        options: &WebPEncoderOptions,
    ) -> Result<Vec<u8>, NativeImageError> {
        match self {
            Self::Rgb(rgb) => encode_rgb_with_options(rgb.as_ref(), options),
            Self::Rgba(rgba) => encode_rgba_with_options(rgba.as_ref(), options),
        }
    }
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &WebPEncoderOptions::new(quality))
}

pub(crate) fn encode_preview(
    image: &DynamicImage,
    quality: u8,
) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &WebPEncoderOptions::preview(quality))
}

pub(crate) fn encode_with_options(
    image: &DynamicImage,
    options: &WebPEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    PreparedWebPPixels::from_image(image)?.encode_with_options(options)
}

pub(crate) fn encode_rgb_with_options(
    rgb: &RgbImage,
    options: &WebPEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    ensure_dimensions(rgb.width(), rgb.height())?;
    encode_pixels(
        webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height()),
        options,
    )
}

pub(crate) fn encode_rgba_with_options(
    rgba: &RgbaImage,
    options: &WebPEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    ensure_dimensions(rgba.width(), rgba.height())?;
    encode_pixels(
        webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height()),
        options,
    )
}

fn encode_pixels(
    encoder: webp::Encoder<'_>,
    options: &WebPEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    encoder
        .encode_advanced(&options.config)
        .map(|memory| memory.to_vec())
        .map_err(|error| match error {
            webp::WebPEncodingError::VP8_ENC_ERROR_INVALID_CONFIGURATION => {
                NativeImageError::InvalidParameters("invalid libwebp encoder configuration".into())
            }
            _ => NativeImageError::EncodeFailed(format!("WebP: {error:?}")),
        })
}

fn ensure_dimensions(width: u32, height: u32) -> Result<(), NativeImageError> {
    if width == 0 || height == 0 {
        return Err(NativeImageError::InvalidImage(
            "WebP encoder cannot encode an empty image".into(),
        ));
    }
    Ok(())
}
