use std::borrow::Cow;

use image::{DynamicImage, ExtendedColorType, ImageEncoder, RgbaImage};
use rgb::FromSlice;

use crate::NativeImageError;

#[derive(Clone, Debug)]
pub(crate) struct PngEncoderOptions {
    pub quality: u8,
    pub quantize: bool,
    pub compare_lossless: bool,
    pub max_colors: u32,
    pub quantization_speed: i32,
    pub dithering_level: f32,
    pub oxipng_options: oxipng::Options,
}

impl PngEncoderOptions {
    pub(crate) fn new(quality: u8) -> Self {
        Self {
            quality,
            ..Self::default()
        }
    }

    fn validate(&self) -> Result<(), NativeImageError> {
        if !(1..=100).contains(&self.quality) {
            return Err(NativeImageError::InvalidParameters(
                "PNG quality must be between 1 and 100".into(),
            ));
        }
        if !(2..=256).contains(&self.max_colors) {
            return Err(NativeImageError::InvalidParameters(
                "PNG palette size must be between 2 and 256".into(),
            ));
        }
        if !(1..=10).contains(&self.quantization_speed) {
            return Err(NativeImageError::InvalidParameters(
                "PNG quantization speed must be between 1 and 10".into(),
            ));
        }
        if !(0.0..=1.0).contains(&self.dithering_level) {
            return Err(NativeImageError::InvalidParameters(
                "PNG dithering level must be between 0 and 1".into(),
            ));
        }
        Ok(())
    }
}

impl Default for PngEncoderOptions {
    fn default() -> Self {
        let mut oxipng_options = oxipng::Options::from_preset(1);
        oxipng_options.force = true;
        Self {
            quality: 80,
            quantize: true,
            compare_lossless: true,
            max_colors: 256,
            quantization_speed: 5,
            dithering_level: 0.0,
            oxipng_options,
        }
    }
}

pub(crate) fn encode(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &PngEncoderOptions::new(quality))
}

pub(crate) fn encode_with_options(
    image: &DynamicImage,
    options: &PngEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    let rgba: Cow<'_, RgbaImage> = match image.as_rgba8() {
        Some(rgba) => Cow::Borrowed(rgba),
        None => Cow::Owned(image.to_rgba8()),
    };
    if !options.quantize {
        return Ok(optimize(encode_lossless(rgba.as_ref())?, options));
    }
    if !options.compare_lossless {
        return encode_quantized_rgba_with_options(rgba.as_ref(), options);
    }

    let lossless = optimize(encode_lossless(rgba.as_ref())?, options);
    let quantized = encode_quantized_rgba_with_options(rgba.as_ref(), options);
    Ok(match quantized {
        Ok(candidate) if candidate.len() < lossless.len() => candidate,
        _ => lossless,
    })
}

pub(crate) fn encode_quantized_rgba(
    image: &RgbaImage,
    quality: u8,
) -> Result<Vec<u8>, NativeImageError> {
    encode_quantized_rgba_with_options(image, &PngEncoderOptions::new(quality))
}

pub(crate) fn encode_quantized_rgba_with_options(
    image: &RgbaImage,
    options: &PngEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    encode_quantized(image, options).map(|bytes| optimize(bytes, options))
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

fn encode_quantized(
    image: &RgbaImage,
    options: &PngEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    use imagequant::Attributes;
    use lodepng::{Encoder, FilterStrategy, RGBA};

    let mut attributes = Attributes::new();
    attributes
        .set_max_colors(options.max_colors)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quantizer: {error}")))?;
    attributes
        .set_quality(0, options.quality)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quality: {error}")))?;
    attributes
        .set_speed(options.quantization_speed)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG speed: {error}")))?;
    let pixels = image.as_raw().as_slice().as_rgba();
    let mut quant_image = attributes
        .new_image_borrowed(pixels, image.width() as usize, image.height() as usize, 0.0)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quantizer image: {error}")))?;
    let mut result = attributes
        .quantize(&mut quant_image)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG quantization: {error}")))?;
    result
        .set_dithering_level(options.dithering_level)
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

fn optimize(bytes: Vec<u8>, options: &PngEncoderOptions) -> Vec<u8> {
    match oxipng::optimize_from_memory(&bytes, &options.oxipng_options) {
        Ok(optimized) if optimized.len() < bytes.len() => optimized,
        _ => bytes,
    }
}
