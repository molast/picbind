use image::{DynamicImage, GenericImageView};

use crate::{
    MAX_INPUT_BYTES, MAX_PIXELS, NativeImageError, NativeImageFormat, NativeImageMetadata,
};

pub(crate) fn decode(input: &[u8]) -> Result<(NativeImageFormat, DynamicImage), NativeImageError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(NativeImageError::InputTooLarge);
    }
    let format = detect_format(input)?;
    let image = match format {
        NativeImageFormat::Avif => crate::codecs::avif::decode(input)?,
        NativeImageFormat::JpegXl => crate::codecs::jpeg_xl::decode(input)?,
        NativeImageFormat::WebP => crate::codecs::webp::decode(input)?,
        NativeImageFormat::Jpeg => crate::codecs::jpeg::decode(input)?,
        NativeImageFormat::Png => crate::codecs::png::decode(input)?,
    };
    ensure_pixel_limit(&image)?;
    Ok((format, image))
}

pub(crate) fn metadata(
    image: &DynamicImage,
    format: NativeImageFormat,
    size_bytes: usize,
) -> Result<NativeImageMetadata, NativeImageError> {
    ensure_pixel_limit(image)?;
    let (width, height) = image.dimensions();
    Ok(NativeImageMetadata {
        width,
        height,
        format,
        mime_type: format.mime_type(),
        size_bytes,
        has_alpha: has_transparency(image),
    })
}

pub(crate) fn has_transparency(image: &DynamicImage) -> bool {
    if let Some(rgba) = image.as_rgba8() {
        return rgba.pixels().any(|pixel| pixel[3] < 255);
    }
    if !image.color().has_alpha() {
        return false;
    }
    image.to_rgba8().pixels().any(|pixel| pixel[3] < 255)
}

fn detect_format(input: &[u8]) -> Result<NativeImageFormat, NativeImageError> {
    const JXL_CONTAINER_SIGNATURE: &[u8] = b"\0\0\0\x0cJXL \r\n\x87\n";
    if input.starts_with(&[0xff, 0x0a]) || input.starts_with(JXL_CONTAINER_SIGNATURE) {
        return Ok(NativeImageFormat::JpegXl);
    }
    match image::guess_format(input)
        .map_err(|error| NativeImageError::InvalidImage(error.to_string()))?
    {
        image::ImageFormat::Jpeg => Ok(NativeImageFormat::Jpeg),
        image::ImageFormat::Png => Ok(NativeImageFormat::Png),
        image::ImageFormat::WebP => Ok(NativeImageFormat::WebP),
        image::ImageFormat::Avif => Ok(NativeImageFormat::Avif),
        format => Err(NativeImageError::UnsupportedFormat(format!("{format:?}"))),
    }
}

fn ensure_pixel_limit(image: &DynamicImage) -> Result<(), NativeImageError> {
    let (width, height) = image.dimensions();
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(NativeImageError::InvalidImage(
            "decoded pixel count exceeds the native limit".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, RgbImage, Rgba, RgbaImage};

    use super::{detect_format, has_transparency};

    #[test]
    fn transparency_detection_handles_rgb_and_rgba_without_conversion() {
        let rgb = DynamicImage::ImageRgb8(RgbImage::new(2, 2));
        let opaque = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let transparent =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 128])));

        assert!(!has_transparency(&rgb));
        assert!(!has_transparency(&opaque));
        assert!(has_transparency(&transparent));
    }

    #[test]
    fn jpeg_xl_detection_accepts_codestream_and_container_signatures() {
        assert_eq!(
            detect_format(&[0xff, 0x0a]).unwrap(),
            crate::NativeImageFormat::JpegXl
        );
        assert_eq!(
            detect_format(b"\0\0\0\x0cJXL \r\n\x87\n").unwrap(),
            crate::NativeImageFormat::JpegXl
        );
    }
}
