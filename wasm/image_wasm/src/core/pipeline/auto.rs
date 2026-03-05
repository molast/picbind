use image::ImageFormat;
use wasm_bindgen::JsValue;

use crate::CompressionResult;

use super::super::{
    candidate::{best_candidate, original_candidate, Candidate},
    jpeg::{encode_jpeg_from_image, is_opaque},
    png::encode_quantized_png_from_image,
    quality::quality_candidates,
};

fn compress_jpeg(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = ImageFormat::Jpeg;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut candidates = Vec::new();

    for candidate_quality in quality_candidates(quality).into_iter().filter(|q| *q >= 35) {
        if let Ok(bytes) = encode_jpeg_from_image(&img, candidate_quality) {
            candidates.push(Candidate {
                bytes,
                mime: "image/jpeg",
                ext: "jpg",
            });
        }
    }

    Ok(best_candidate(original_candidate(input, format), candidates).into_result())
}

fn compress_png(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = ImageFormat::Png;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut candidates = Vec::new();

    if let Ok(bytes) = encode_quantized_png_from_image(&img, quality) {
        candidates.push(Candidate {
            bytes,
            mime: "image/png",
            ext: "png",
        });
    }

    if is_opaque(&img) {
        for candidate_quality in quality_candidates(quality).into_iter().filter(|q| *q >= 35) {
            if let Ok(bytes) = encode_jpeg_from_image(&img, candidate_quality) {
                candidates.push(Candidate {
                    bytes,
                    mime: "image/jpeg",
                    ext: "jpg",
                });
            }
        }
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
