use image::DynamicImage;
use wasm_bindgen::JsValue;

use crate::CompressionResult;

use super::super::{
    candidate::Candidate,
    jpeg::{
        encode_jpeg_from_image, encode_jpeg_from_image_with_white_background,
        encode_jpeg_from_rgb_image, is_opaque,
    },
    metrics::compare_dynamic_images_for_guardrails,
    png::{
        encode_quantized_png_from_image, encode_quantized_png_with_options,
        encode_sampled_quantized_png_from_image,
    },
    png_oxipng::optimize_quantized_png,
    quality::{
        jpeg_to_jpeg_quality_candidates, jpeg_to_jpeg_quality_thresholds, png_quantization_plan,
        png_to_jpeg_quality_candidates,
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
            if source_format != image::ImageFormat::Jpeg && !allow_alpha_loss && !is_opaque(img) {
                return Err(JsValue::from_str(
                    "JPEG target is unavailable because the source image contains transparency",
                ));
            }

            let is_png_to_jpeg = source_format == image::ImageFormat::Png;
            let is_jpeg_to_jpeg = source_format == image::ImageFormat::Jpeg;
            let input_len = input.len();
            let mut best_bytes: Option<Vec<u8>> = None;
            let candidate_qualities: Vec<u8> = if is_png_to_jpeg {
                png_to_jpeg_quality_candidates(img, quality, input_len)
            } else if is_jpeg_to_jpeg {
                jpeg_to_jpeg_quality_candidates(img, quality, input_len)
            } else {
                // Cross-format Butteraugli retries are controlled by the caller.
                // Encode the requested quality exactly so 80 -> 90 -> 100 is a
                // real quality increase instead of selecting 50 -> 60 -> 70.
                vec![quality.clamp(35, 100)]
            };
            if is_jpeg_to_jpeg {
                let rgb = img.to_rgb8();
                let thresholds = jpeg_to_jpeg_quality_thresholds(img, input_len);

                // Search from the smallest likely acceptable candidate upward. In the
                // common case this performs one encode and one perceptual comparison.
                for candidate_quality in candidate_qualities.iter().rev().copied() {
                    let Ok(bytes) = encode_jpeg_from_rgb_image(&rgb, candidate_quality) else {
                        continue;
                    };
                    if bytes.len() >= input_len {
                        continue;
                    }

                    let Ok(decoded_candidate) = image::load_from_memory_with_format(
                        bytes.as_slice(),
                        image::ImageFormat::Jpeg,
                    ) else {
                        continue;
                    };
                    let Ok(comparison) =
                        compare_dynamic_images_for_guardrails(img, &decoded_candidate)
                    else {
                        continue;
                    };
                    if comparison.ms_ssim >= thresholds.min_ms_ssim
                        && comparison.blur_loss_percent <= thresholds.max_blur_loss_percent
                        && comparison.perceptual_distance <= thresholds.max_perceptual_distance
                        && comparison.p99_delta_e <= thresholds.max_p99_delta_e
                        && comparison.p95_luminance_error <= thresholds.max_p95_luminance_error
                        && comparison.p95_chroma_error <= thresholds.max_p95_chroma_error
                    {
                        return Ok(Candidate {
                            bytes,
                            mime: "image/jpeg",
                            ext: "jpg",
                        });
                    }
                }

                return Err(JsValue::from_str(
                    "JPEG compression could not satisfy perceptual quality guardrails",
                ));
            }

            for candidate_quality in candidate_qualities {
                let encoded = if allow_alpha_loss {
                    encode_jpeg_from_image_with_white_background(img, candidate_quality)
                } else {
                    encode_jpeg_from_image(img, candidate_quality)
                };
                if let Ok(bytes) = encoded {
                    let should_replace_best = best_bytes
                        .as_ref()
                        .map(|current| bytes.len() < current.len())
                        .unwrap_or(true);
                    if should_replace_best {
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
        "png" => {
            let pixel_count = u64::from(img.width()) * u64::from(img.height());
            if source_format == image::ImageFormat::Png {
                let plan = png_quantization_plan(img, input.len());
                let minimum_colors = if quality >= 100 {
                    256
                } else if quality >= 90 {
                    128
                } else {
                    0
                };
                for colors in plan
                    .color_candidates
                    .into_iter()
                    .filter(|colors| *colors >= minimum_colors)
                {
                    let Ok(bytes) = encode_quantized_png_with_options(
                        img,
                        colors,
                        100,
                        plan.dithering_level,
                        4,
                    ) else {
                        continue;
                    };
                    if bytes.len() >= input.len() {
                        continue;
                    }
                    let Ok(decoded_candidate) = image::load_from_memory_with_format(
                        bytes.as_slice(),
                        image::ImageFormat::Png,
                    ) else {
                        continue;
                    };
                    let Ok(comparison) =
                        compare_dynamic_images_for_guardrails(img, &decoded_candidate)
                    else {
                        continue;
                    };
                    if comparison.ms_ssim >= plan.min_ms_ssim
                        && comparison.perceptual_distance <= plan.max_perceptual_distance
                        && comparison.p99_delta_e <= plan.max_p99_delta_e
                        && comparison.p95_luminance_error <= plan.max_p95_luminance_error
                        && comparison.p95_chroma_error <= plan.max_p95_chroma_error
                        && comparison.p95_alpha_error <= plan.max_p95_alpha_error
                        && comparison.p99_alpha_error <= plan.max_p99_alpha_error
                    {
                        let bytes = optimize_quantized_png(bytes, pixel_count);
                        return Ok(Candidate {
                            bytes,
                            mime: "image/png",
                            ext: "png",
                        });
                    }
                }
                Err(JsValue::from_str(
                    "PNG compression could not satisfy perceptual quality guardrails",
                ))
            } else {
                let encoded = if pixel_count > 8_000_000 {
                    encode_sampled_quantized_png_from_image(img, 256, quality)
                } else {
                    encode_quantized_png_from_image(img, quality)
                };
                encoded.map(|bytes| {
                    let bytes = optimize_quantized_png(bytes, pixel_count);
                    Candidate {
                        bytes,
                        mime: "image/png",
                        ext: "png",
                    }
                })
            }
        }
        "webp" => Err(JsValue::from_str(
            "WebP compression is handled outside WASM",
        )),
        "avif" => Err(JsValue::from_str(
            "AVIF compression is handled by libavif/libaom WASM",
        )),
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
