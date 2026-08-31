use image::{DynamicImage, ExtendedColorType, GenericImageView, imageops::FilterType};

use crate::{
    NativeImageError, NativeImageFormat, NativeImageMetadata, NativeImageOutput, NativeTaskControl,
    decode,
};

const DEFAULT_IGNORE_BELOW_BYTES: usize = 100 * 1024;
const DEFAULT_JPEG_QUALITY: u8 = 60;
const DEFAULT_WEBP_QUALITY: u8 = 75;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeMessagingCompressionOptions {
    pub ignore_below_bytes: usize,
    pub jpeg_quality: u8,
    pub webp_quality: u8,
}

impl Default for NativeMessagingCompressionOptions {
    fn default() -> Self {
        Self {
            ignore_below_bytes: DEFAULT_IGNORE_BELOW_BYTES,
            jpeg_quality: DEFAULT_JPEG_QUALITY,
            webp_quality: DEFAULT_WEBP_QUALITY,
        }
    }
}

pub fn compress_for_messaging(
    input: &[u8],
    options: &NativeMessagingCompressionOptions,
) -> Result<NativeImageOutput, NativeImageError> {
    compress_for_messaging_inner(input, options, None)
}

pub fn compress_for_messaging_with_control(
    input: &[u8],
    options: &NativeMessagingCompressionOptions,
    control: &NativeTaskControl,
) -> Result<NativeImageOutput, NativeImageError> {
    compress_for_messaging_inner(input, options, Some(control))
}

fn compress_for_messaging_inner(
    input: &[u8],
    options: &NativeMessagingCompressionOptions,
    control: Option<&NativeTaskControl>,
) -> Result<NativeImageOutput, NativeImageError> {
    validate_options(options)?;
    checkpoint(control)?;
    let (source_format, source) = decode::decode(input)?;
    checkpoint(control)?;
    let source_metadata = decode::metadata(&source, source_format, input.len())?;

    if input.len() <= options.ignore_below_bytes && is_messaging_compatible(source_format) {
        return Ok(original_output(input, source_metadata));
    }

    let has_transparency = decode::has_transparency(&source);
    let sample_size = luban_sample_size(source.width(), source.height());
    let image = resize_for_sample_size(source, sample_size);
    checkpoint(control)?;

    let (format, bytes) = if has_transparency {
        let encoder_options =
            crate::codecs::webp::encoder::WebPEncoderOptions::preview(options.webp_quality);
        let bytes = crate::codecs::webp::encoder::encode_with_options(&image, &encoder_options)?;
        (NativeImageFormat::WebP, bytes)
    } else {
        (
            NativeImageFormat::Jpeg,
            encode_luban_jpeg(&image, options.jpeg_quality)?,
        )
    };
    checkpoint(control)?;

    if is_messaging_compatible(source_format) && bytes.len() >= input.len() {
        return Ok(original_output(input, source_metadata));
    }

    let (width, height) = image.dimensions();
    let size_bytes = bytes.len();
    Ok(NativeImageOutput {
        bytes,
        metadata: NativeImageMetadata {
            width,
            height,
            format,
            mime_type: format.mime_type(),
            size_bytes,
            has_alpha: has_transparency,
        },
        returned_original: false,
    })
}

fn validate_options(options: &NativeMessagingCompressionOptions) -> Result<(), NativeImageError> {
    if !(1..=100).contains(&options.jpeg_quality) || !(1..=100).contains(&options.webp_quality) {
        return Err(NativeImageError::InvalidParameters(
            "messaging compression quality must be between 1 and 100".into(),
        ));
    }
    Ok(())
}

fn encode_luban_jpeg(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    let rgb = image.to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|error| NativeImageError::EncodeFailed(format!("messaging JPEG: {error}")))?;
    Ok(bytes)
}

fn resize_for_sample_size(image: DynamicImage, sample_size: u32) -> DynamicImage {
    if sample_size <= 1 {
        return image;
    }
    let width = (image.width() / sample_size).max(1);
    let height = (image.height() / sample_size).max(1);
    image.resize_exact(width, height, FilterType::Triangle)
}

fn luban_sample_size(width: u32, height: u32) -> u32 {
    let even_width = width.saturating_add(width % 2).max(1);
    let even_height = height.saturating_add(height % 2).max(1);
    let long_side = even_width.max(even_height);
    let short_side = even_width.min(even_height);
    let scale = f64::from(short_side) / f64::from(long_side);

    if scale > 0.5625 {
        if long_side < 1_664 {
            1
        } else if long_side < 4_990 {
            2
        } else if long_side < 10_240 {
            4
        } else {
            (long_side / 1_280).max(1)
        }
    } else if scale > 0.5 {
        (long_side / 1_280).max(1)
    } else {
        let normalized_long_side = 1_280.0 / scale.max(f64::EPSILON);
        (f64::from(long_side) / normalized_long_side)
            .ceil()
            .max(1.0) as u32
    }
}

fn is_messaging_compatible(format: NativeImageFormat) -> bool {
    matches!(
        format,
        NativeImageFormat::Jpeg | NativeImageFormat::Png | NativeImageFormat::WebP
    )
}

fn original_output(input: &[u8], metadata: NativeImageMetadata) -> NativeImageOutput {
    NativeImageOutput {
        bytes: input.to_vec(),
        metadata,
        returned_original: true,
    }
}

fn checkpoint(control: Option<&NativeTaskControl>) -> Result<(), NativeImageError> {
    control.map_or(Ok(()), NativeTaskControl::checkpoint)
}

#[cfg(test)]
mod tests;
