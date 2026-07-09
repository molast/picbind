use image::DynamicImage;
use wasm_bindgen::JsValue;

use crate::CompressionResult;

use super::super::{
    avif::{encode_avif_from_pixels, is_opaque_rgba, rgba_to_ravif_pixels},
    candidate::Candidate,
    jpeg::{encode_jpeg_from_image, encode_jpeg_from_image_with_white_background, is_opaque},
    metrics::compare_dynamic_images_for_guardrails,
    png::encode_quantized_png_from_image,
    quality::{
        avif_bit_depth_for_pixels, avif_quality_candidates, avif_speed_for_pixels,
        jpeg_to_jpeg_quality_candidates, jpeg_to_jpeg_quality_thresholds,
        jpeg_to_jpeg_rescue_qualities, png_to_jpeg_quality_candidates, quality_candidates,
    },
};

fn encode_candidate_for_format(
    img: &DynamicImage,
    input: &[u8],
    source_format: image::ImageFormat,
    target_format: &str,
    quality: u8,
    allow_alpha_loss: bool,
) -> Result<Candidate, JsValue> {
    match target_format {
        "jpeg" | "jpg" => {
            if !allow_alpha_loss && !is_opaque(img) {
                return Err(JsValue::from_str(
                    "JPEG target is unavailable because the source image contains transparency",
                ));
            }

            let is_png_to_jpeg = source_format == image::ImageFormat::Png;
            let is_jpeg_to_jpeg = source_format == image::ImageFormat::Jpeg;
            let input_len = input.len();
            let mut best_bytes: Option<Vec<u8>> = None;
            let mut best_guarded_bytes: Option<Vec<u8>> = None;
            let candidate_qualities: Vec<u8> = if is_png_to_jpeg {
                png_to_jpeg_quality_candidates(img, quality, input_len)
            } else if is_jpeg_to_jpeg {
                jpeg_to_jpeg_quality_candidates(img, quality, input_len)
            } else {
                quality_candidates(quality)
                    .into_iter()
                    .filter(|q| *q >= 35)
                    .collect()
            };
            let jpeg_guardrails = if is_jpeg_to_jpeg {
                Some(jpeg_to_jpeg_quality_thresholds(img, input_len))
            } else {
                None
            };
            let min_candidate_quality = candidate_qualities.iter().copied().min().unwrap_or(60);
            let try_candidate =
                |candidate_quality: u8,
                 evaluate_guardrails: bool,
                 best_bytes: &mut Option<Vec<u8>>,
                 best_guarded_bytes: &mut Option<Vec<u8>>| {
                    let encoded = if allow_alpha_loss {
                        encode_jpeg_from_image_with_white_background(img, candidate_quality)
                    } else {
                        encode_jpeg_from_image(img, candidate_quality)
                    };
                    if let Ok(bytes) = encoded {
                        if is_jpeg_to_jpeg && bytes.len() >= input_len {
                            return;
                        }

                        let should_replace_best = best_bytes
                            .as_ref()
                            .map(|current| bytes.len() < current.len())
                            .unwrap_or(true);
                        if should_replace_best {
                            *best_bytes = Some(bytes.clone());
                        }

                        if evaluate_guardrails {
                            if let Some((min_ms_ssim, max_blur_loss_percent)) = jpeg_guardrails {
                                if let Ok(decoded_candidate) = image::load_from_memory_with_format(
                                    bytes.as_slice(),
                                    image::ImageFormat::Jpeg,
                                ) {
                                    if let Ok(comparison) = compare_dynamic_images_for_guardrails(
                                        img,
                                        &decoded_candidate,
                                    ) {
                                        let passes_guardrails = comparison.ms_ssim >= min_ms_ssim
                                            && comparison.blur_loss_percent
                                                <= max_blur_loss_percent;
                                        if passes_guardrails {
                                            let should_replace_guarded = best_guarded_bytes
                                                .as_ref()
                                                .map(|current| bytes.len() < current.len())
                                                .unwrap_or(true);
                                            if should_replace_guarded {
                                                *best_guarded_bytes = Some(bytes);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                };

            for (index, candidate_quality) in candidate_qualities.iter().copied().enumerate() {
                let evaluate_guardrails = !is_jpeg_to_jpeg || index < 4;
                try_candidate(
                    candidate_quality,
                    evaluate_guardrails,
                    &mut best_bytes,
                    &mut best_guarded_bytes,
                );
            }

            if is_jpeg_to_jpeg && best_bytes.is_none() {
                for rescue_quality in
                    jpeg_to_jpeg_rescue_qualities(img, input_len, min_candidate_quality)
                {
                    try_candidate(
                        rescue_quality,
                        false,
                        &mut best_bytes,
                        &mut best_guarded_bytes,
                    );
                    if best_bytes.is_some() {
                        break;
                    }
                }
            }

            best_guarded_bytes
                .or(best_bytes)
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
        "webp" => Err(JsValue::from_str(
            "WebP compression is handled outside WASM",
        )),
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
    allow_alpha_loss: bool,
) -> Result<CompressionResult, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let candidate = encode_candidate_for_format(
        &img,
        input,
        format,
        &target_format.to_ascii_lowercase(),
        quality,
        allow_alpha_loss,
    )?;
    Ok(candidate.into_result())
}
