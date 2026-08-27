use std::io::Cursor;

use image::{DynamicImage, RgbImage, RgbaImage};
use image_webp::{UpsamplingMethod, WebPDecodeOptions as ImageWebPDecodeOptions, WebPDecoder};

use crate::{MAX_DIMENSION, MAX_PIXELS, NativeImageError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WebPDecoderOptions {
    pub memory_limit: usize,
    pub use_simple_upsampling: bool,
}

impl WebPDecoderOptions {
    fn validate(&self) -> Result<(), NativeImageError> {
        if self.memory_limit == 0 {
            return Err(NativeImageError::InvalidParameters(
                "WebP decoder memory limit must be greater than zero".into(),
            ));
        }
        Ok(())
    }
}

impl Default for WebPDecoderOptions {
    fn default() -> Self {
        Self {
            memory_limit: (MAX_PIXELS as usize).saturating_mul(4),
            use_simple_upsampling: false,
        }
    }
}

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    decode_with_options(input, &WebPDecoderOptions::default())
}

pub(crate) fn decode_with_options(
    input: &[u8],
    options: &WebPDecoderOptions,
) -> Result<DynamicImage, NativeImageError> {
    options.validate()?;
    let mut decode_options = ImageWebPDecodeOptions::default();
    decode_options.lossy_upsampling = if options.use_simple_upsampling {
        UpsamplingMethod::Simple
    } else {
        UpsamplingMethod::Bilinear
    };
    let mut decoder = WebPDecoder::new_with_options(Cursor::new(input), decode_options)
        .map_err(|error| NativeImageError::InvalidImage(format!("WebP decode failed: {error}")))?;
    decoder.set_memory_limit(options.memory_limit);

    let (width, height) = decoder.dimensions();
    if width > MAX_DIMENSION
        || height > MAX_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(NativeImageError::InvalidImage(
            "decoded WebP dimensions exceed the native limit".into(),
        ));
    }
    let buffer_size = decoder.output_buffer_size().ok_or_else(|| {
        NativeImageError::InvalidImage("WebP decoded buffer size overflow".into())
    })?;
    if buffer_size > options.memory_limit {
        return Err(NativeImageError::InvalidImage(
            "WebP decoded buffer exceeds the configured memory limit".into(),
        ));
    }
    let has_alpha = decoder.has_alpha();
    let mut pixels = vec![0; buffer_size];
    decoder
        .read_image(&mut pixels)
        .map_err(|error| NativeImageError::InvalidImage(format!("WebP decode failed: {error}")))?;

    let image = if has_alpha {
        RgbaImage::from_vec(width, height, pixels).map(DynamicImage::ImageRgba8)
    } else {
        RgbImage::from_vec(width, height, pixels).map(DynamicImage::ImageRgb8)
    };
    image.ok_or_else(|| {
        NativeImageError::InvalidImage("WebP decoder returned an invalid pixel buffer".into())
    })
}
