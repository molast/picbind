use std::borrow::Cow;

use image::{DynamicImage, GenericImageView, RgbaImage};
use rgb::FromSlice;

use crate::NativeImageError;

pub(crate) type OxiPngOptions = oxipng::Options;

#[derive(Clone, Debug)]
pub(crate) struct PngEncoderOptions {
    pub quality: u8,
    pub quantize: bool,
    pub compare_lossless: bool,
    pub max_colors: u32,
    pub quantization_speed: i32,
    pub dithering_level: f32,
    pub oxipng_options: OxiPngOptions,
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
    if !options.quantize {
        return encode_lossless(image, options);
    }

    let rgba: Cow<'_, RgbaImage> = match image.as_rgba8() {
        Some(rgba) => Cow::Borrowed(rgba),
        None => Cow::Owned(image.to_rgba8()),
    };
    if !options.compare_lossless {
        return encode_quantized_rgba_with_options(rgba.as_ref(), options);
    }

    let lossless = encode_lossless(image, options);
    let quantized = encode_quantized_rgba_with_options(rgba.as_ref(), options);
    select_smaller_valid(lossless, quantized)
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
    ensure_dimensions(image.width(), image.height())?;
    encode_quantized(image, options).map(|bytes| optimize(bytes, options))
}

fn encode_lossless(
    image: &DynamicImage,
    options: &PngEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    use image::DynamicImage::{
        ImageLuma8, ImageLuma16, ImageLumaA8, ImageLumaA16, ImageRgb8, ImageRgb16, ImageRgb32F,
        ImageRgba8, ImageRgba16, ImageRgba32F,
    };
    use oxipng::{BitDepth, ColorType, RawImage};

    let (width, height) = image.dimensions();
    ensure_dimensions(width, height)?;
    let (color_type, bit_depth, data) = match image {
        ImageLuma8(image) => (
            ColorType::Grayscale {
                transparent_shade: None,
            },
            BitDepth::Eight,
            image.as_raw().clone(),
        ),
        ImageLumaA8(image) => (
            ColorType::GrayscaleAlpha,
            BitDepth::Eight,
            image.as_raw().clone(),
        ),
        ImageRgb8(image) => (
            ColorType::RGB {
                transparent_color: None,
            },
            BitDepth::Eight,
            image.as_raw().clone(),
        ),
        ImageRgba8(image) => (ColorType::RGBA, BitDepth::Eight, image.as_raw().clone()),
        ImageLuma16(image) => (
            ColorType::Grayscale {
                transparent_shade: None,
            },
            BitDepth::Sixteen,
            samples_to_big_endian(image.as_raw()),
        ),
        ImageLumaA16(image) => (
            ColorType::GrayscaleAlpha,
            BitDepth::Sixteen,
            samples_to_big_endian(image.as_raw()),
        ),
        ImageRgb16(image) => (
            ColorType::RGB {
                transparent_color: None,
            },
            BitDepth::Sixteen,
            samples_to_big_endian(image.as_raw()),
        ),
        ImageRgba16(image) => (
            ColorType::RGBA,
            BitDepth::Sixteen,
            samples_to_big_endian(image.as_raw()),
        ),
        ImageRgb32F(_) => {
            let image = image.to_rgb16();
            (
                ColorType::RGB {
                    transparent_color: None,
                },
                BitDepth::Sixteen,
                samples_to_big_endian(image.as_raw()),
            )
        }
        ImageRgba32F(_) => {
            let image = image.to_rgba16();
            (
                ColorType::RGBA,
                BitDepth::Sixteen,
                samples_to_big_endian(image.as_raw()),
            )
        }
        _ => {
            let image = image.to_rgba16();
            (
                ColorType::RGBA,
                BitDepth::Sixteen,
                samples_to_big_endian(image.as_raw()),
            )
        }
    };
    let raw = RawImage::new(width, height, color_type, bit_depth, data)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG raw image: {error}")))?;
    raw.create_optimized_png(&options.oxipng_options)
        .map_err(|error| NativeImageError::EncodeFailed(format!("PNG optimization: {error}")))
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

pub(super) fn select_smaller_valid(
    lossless: Result<Vec<u8>, NativeImageError>,
    quantized: Result<Vec<u8>, NativeImageError>,
) -> Result<Vec<u8>, NativeImageError> {
    match (lossless, quantized) {
        (Ok(lossless), Ok(quantized)) => Ok(if quantized.len() < lossless.len() {
            quantized
        } else {
            lossless
        }),
        (Ok(lossless), Err(_)) => Ok(lossless),
        (Err(_), Ok(quantized)) => Ok(quantized),
        (Err(lossless_error), Err(_)) => Err(lossless_error),
    }
}

fn samples_to_big_endian(samples: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_be_bytes());
    }
    bytes
}

fn ensure_dimensions(width: u32, height: u32) -> Result<(), NativeImageError> {
    if width == 0 || height == 0 {
        return Err(NativeImageError::InvalidImage(
            "PNG encoder cannot encode an empty image".into(),
        ));
    }
    Ok(())
}
