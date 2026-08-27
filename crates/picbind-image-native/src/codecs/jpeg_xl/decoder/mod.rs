use std::io::Cursor;

use image::{DynamicImage, ImageDecoder};
use jxl_oxide::{JxlThreadPool, integration::JxlDecoder};

use crate::{MAX_PIXELS, NativeImageError};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct JpegXlDecoderOptions {
    /// None uses jxl-oxide's global Rayon thread pool.
    pub threads: Option<usize>,
}

impl JpegXlDecoderOptions {
    fn validate(&self) -> Result<(), NativeImageError> {
        if self.threads == Some(0) {
            return Err(NativeImageError::InvalidParameters(
                "JPEG XL decoder thread count must be greater than zero".into(),
            ));
        }
        Ok(())
    }
}

impl Default for JpegXlDecoderOptions {
    fn default() -> Self {
        Self { threads: None }
    }
}

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    decode_with_options(input, &JpegXlDecoderOptions::default())
}

pub(crate) fn decode_with_options(
    input: &[u8],
    options: &JpegXlDecoderOptions,
) -> Result<DynamicImage, NativeImageError> {
    options.validate()?;
    let pool = options
        .threads
        .map_or_else(JxlThreadPool::rayon_global, |threads| {
            JxlThreadPool::rayon(Some(threads))
        });
    let decoder = JxlDecoder::with_thread_pool(Cursor::new(input), pool).map_err(|error| {
        NativeImageError::InvalidImage(format!("JPEG XL decode failed: {error}"))
    })?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(NativeImageError::InvalidImage(
            "decoded pixel count exceeds the native limit".into(),
        ));
    }
    DynamicImage::from_decoder(decoder)
        .map_err(|error| NativeImageError::InvalidImage(format!("JPEG XL decode failed: {error}")))
}
