use image::ImageFormat;
use wasm_bindgen::JsValue;

use crate::CompressionResult;

use super::super::candidate::{best_candidate, original_candidate, Candidate};

use super::to_format::compress_image_to_target_format;

fn candidate_from_result(result: CompressionResult, mime: &'static str, ext: &'static str) -> Candidate {
    Candidate {
        bytes: result.bytes,
        mime,
        ext,
    }
}

fn compress_jpeg(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    compress_image_to_target_format(input, quality, "jpeg", false)
}

fn compress_png(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = ImageFormat::Png;
    let mut candidates = Vec::new();

    if let Ok(result) = compress_image_to_target_format(input, quality, "png", false) {
        candidates.push(candidate_from_result(result, "image/png", "png"));
    }

    if let Ok(result) = compress_image_to_target_format(input, quality, "jpeg", false) {
        candidates.push(candidate_from_result(result, "image/jpeg", "jpg"));
    }

    Ok(best_candidate(original_candidate(input, format), candidates).into_result())
}

pub fn compress_image_auto(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;

    match format {
        ImageFormat::Jpeg => compress_jpeg(input, quality),
        ImageFormat::Png => compress_png(input, quality),
        ImageFormat::WebP => Ok(original_candidate(input, format).into_result()),
        _ => Ok(original_candidate(input, format).into_result()),
    }
}
