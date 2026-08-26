use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbaImage};

use crate::NativeImageError;

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    image::load_from_memory_with_format(input, image::ImageFormat::Png)
        .map_err(|error| NativeImageError::InvalidImage(error.to_string()))
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    let rgba = image.to_rgba8();
    let lossless = optimize(encode_lossless(&rgba)?, rgba.width(), rgba.height());
    let quantized =
        encode_quantized(&rgba, quality).map(|bytes| optimize(bytes, rgba.width(), rgba.height()));
    Ok(match quantized {
        Ok(candidate) if candidate.len() < lossless.len() => candidate,
        _ => lossless,
    })
}

fn encode_lossless(image: &RgbaImage) -> Result<Vec<u8>, NativeImageError> {
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut bytes,
        image::codecs::png::CompressionType::Best,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        image,
        image.width(),
        image.height(),
        ExtendedColorType::Rgba8,
    )
    .map_err(|error| NativeImageError::EncodeFailed(format!("PNG: {error}")))?;
    Ok(bytes)
}

fn encode_quantized(image: &RgbaImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    use imagequant::{Attributes, RGBA as QuantRgba};
    use lodepng::{Encoder, FilterStrategy, RGBA};

    let mut attributes = Attributes::new();
    attributes
        .set_max_colors(256)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quantizer: {error}")))?;
    attributes
        .set_quality(0, quality.clamp(1, 100))
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quality: {error}")))?;
    attributes
        .set_speed(5)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG speed: {error}")))?;
    let pixels = image
        .pixels()
        .map(|pixel| QuantRgba::new(pixel[0], pixel[1], pixel[2], pixel[3]))
        .collect::<Vec<_>>();
    let mut quant_image = attributes
        .new_image(pixels, image.width() as usize, image.height() as usize, 0.0)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quantizer image: {error}")))?;
    let mut result = attributes
        .quantize(&mut quant_image)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quantization: {error}")))?;
    result
        .set_dithering_level(0.0)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG dithering: {error}")))?;
    let (palette, indexes) = result
        .remapped(&mut quant_image)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG palette: {error}")))?;
    let palette = palette
        .into_iter()
        .map(|color| RGBA::new(color.r, color.g, color.b, color.a))
        .collect::<Vec<_>>();
    let mut encoder = Encoder::new();
    encoder.set_auto_convert(false);
    encoder
        .set_palette(&palette)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG palette setup: {error}")))?;
    encoder.set_filter_strategy(FilterStrategy::MINSUM, true);
    encoder.settings_mut().set_level(9);
    encoder
        .encode(&indexes, image.width() as usize, image.height() as usize)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG palette encode: {error}")))
}

fn optimize(bytes: Vec<u8>, width: u32, height: u32) -> Vec<u8> {
    let preset = if u64::from(width) * u64::from(height) > 8_000_000 {
        1
    } else {
        3
    };
    match oxipng::optimize_from_memory(&bytes, &oxipng::Options::from_preset(preset)) {
        Ok(optimized) if optimized.len() < bytes.len() => optimized,
        _ => bytes,
    }
}

#[cfg(test)]
mod tests;
