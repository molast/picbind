mod auto;
mod to_format;

use wasm_bindgen::JsValue;

use crate::CompressionResult;

pub fn compress_image(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    auto::compress_image_auto(input, quality)
}

pub fn compress_png_with_deflate(
    input: &[u8],
    compression_level: u8,
) -> Result<CompressionResult, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let bytes = super::png::encode_deflated_png_from_image(&img, compression_level)?;

    Ok(CompressionResult {
        bytes,
        mime: "image/png".to_string(),
        ext: "png".to_string(),
    })
}

pub fn compress_image_to_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_image_to_target_format(input, quality, target_format, false)
}

pub fn compress_image_to_format_with_options(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_image_to_target_format(input, quality, target_format, allow_alpha_loss)
}

pub fn compress_dynamic_image_to_png(
    img: &image::DynamicImage,
    quality: u8,
    source_size_bytes: usize,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_dynamic_image_to_png(img, quality, source_size_bytes)
}

pub fn compress_dynamic_image_to_png_with_gain(
    img: &image::DynamicImage,
    quality: u8,
    source_size_bytes: usize,
    compression_gain: f64,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_dynamic_image_to_png_with_gain(
        img,
        quality,
        source_size_bytes,
        compression_gain,
    )
}

pub fn compress_image_to_format_with_plan_options(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
    compression_gain: f64,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_image_to_target_format_with_gain(
        input,
        quality,
        target_format,
        allow_alpha_loss,
        compression_gain,
    )
}

pub fn compress_image_to_format_with_resize_options(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
    compression_gain: f64,
    target_width: u32,
    target_height: u32,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_image_to_target_format_with_resize(
        input,
        quality,
        target_format,
        allow_alpha_loss,
        compression_gain,
        target_width,
        target_height,
    )
}
