use image::DynamicImage;
use wasm_bindgen::JsValue;

use crate::CompressionResult;

use super::super::{
    avif::{encode_avif_from_pixels, is_opaque_rgba, rgba_to_ravif_pixels},
    candidate::Candidate,
    jpeg::{encode_jpeg_from_image, is_opaque},
    png::encode_quantized_png_from_image,
    quality::{
        avif_bit_depth_for_pixels, avif_quality_candidates, avif_speed_for_pixels, quality_candidates,
    },
};

fn encode_candidate_for_format(
    img: &DynamicImage,
    target_format: &str,
    quality: u8,
) -> Result<Candidate, JsValue> {
    match target_format {
        "jpeg" | "jpg" => {
            if !is_opaque(img) {
                return Err(JsValue::from_str(
                    "JPEG target is unavailable because the source image contains transparency",
                ));
            }

            let mut best_bytes: Option<Vec<u8>> = None;
            for candidate_quality in quality_candidates(quality).into_iter().filter(|q| *q >= 35) {
                if let Ok(bytes) = encode_jpeg_from_image(img, candidate_quality) {
                    let should_replace = best_bytes
                        .as_ref()
                        .map(|current| bytes.len() < current.len())
                        .unwrap_or(true);
                    if should_replace {
                        best_bytes = Some(bytes);
                    }
                }
            }

            best_bytes
                .map(|bytes| Candidate {
                    bytes,
                    mime: "image/jpeg",
                    ext: "jpg",
                })
                .ok_or_else(|| JsValue::from_str("JPEG encode failed"))
        }
        "png" => encode_quantized_png_from_image(img, quality).map(|bytes| Candidate {
            bytes,
            mime: "image/png",
            ext: "png",
        }),
        "webp" => Err(JsValue::from_str("WebP compression is handled outside WASM")),
        "avif" => {
            let rgba = img.to_rgba8();
            let (width, height) = rgba.dimensions();
            let pixel_count = (width as usize) * (height as usize);
            let encode_speed = avif_speed_for_pixels(pixel_count);
            let bit_depth = avif_bit_depth_for_pixels(pixel_count);
            let base_alpha_quality = if is_opaque_rgba(&rgba) {
                quality
            } else {
                quality.saturating_sub(8).max(20)
            };
            let pixels = rgba_to_ravif_pixels(&rgba);

            let mut best_bytes: Option<Vec<u8>> = None;
            for candidate_quality in avif_quality_candidates(quality, pixel_count) {
                let candidate_alpha_quality = base_alpha_quality.min(candidate_quality);
                if let Ok(bytes) = encode_avif_from_pixels(
                    pixels.as_slice(),
                    width as usize,
                    height as usize,
                    candidate_quality,
                    candidate_alpha_quality,
                    encode_speed,
                    bit_depth,
                ) {
                    let should_replace = best_bytes
                        .as_ref()
                        .map(|current| bytes.len() < current.len())
                        .unwrap_or(true);
                    if should_replace {
                        best_bytes = Some(bytes);
                    }
                }
            }

            best_bytes
                .map(|bytes| Candidate {
                    bytes,
                    mime: "image/avif",
                    ext: "avif",
                })
                .ok_or_else(|| JsValue::from_str("AVIF encode failed"))
        }
        _ => Err(JsValue::from_str("Unsupported target format")),
    }
}

pub fn compress_image_to_target_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
) -> Result<CompressionResult, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let candidate = encode_candidate_for_format(&img, &target_format.to_ascii_lowercase(), quality)?;
    Ok(candidate.into_result())
}
