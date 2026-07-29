use image::DynamicImage;
use wasm_bindgen::JsValue;

use crate::CompressionResult;

use super::super::{
    candidate::Candidate,
    gain::{DEFAULT_COMPRESSION_GAIN, amplify_quality_loss},
    jpeg::{
        encode_jpeg_from_image, encode_jpeg_from_image_with_white_background,
        encode_jpeg_from_rgb_image_with_subsampling, is_opaque, jpeg_subsampling,
    },
    metrics::compare_dynamic_images_for_guardrails,
    png::{
        encode_quantized_png_from_image, encode_quantized_png_with_options,
        encode_sampled_quantized_png_from_image,
    },
    png_oxipng::optimize_quantized_png,
    quality::{
        jpeg_to_jpeg_quality_candidates_with_gain, jpeg_to_jpeg_quality_thresholds_with_gain,
        png_quantization_plan_with_gain, png_to_jpeg_quality_candidates_with_gain,
    },
};

fn encode_candidate_for_format(
    img: &DynamicImage,
    input: &[u8],
    source_format: image::ImageFormat,
    target_format: &str,
    quality: u8,
    allow_alpha_loss: bool,
    compression_gain: f64,
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
                png_to_jpeg_quality_candidates_with_gain(img, quality, input_len, compression_gain)
            } else if is_jpeg_to_jpeg {
                jpeg_to_jpeg_quality_candidates_with_gain(img, quality, input_len, compression_gain)
            } else {
                // Cross-format Butteraugli retries are controlled by the caller.
                // Encode the requested quality exactly so 80 -> 90 -> 100 is a
                // real quality increase instead of selecting 50 -> 60 -> 70.
                vec![amplify_quality_loss(
                    quality.clamp(35, 100),
                    compression_gain,
                    35,
                )]
            };
            if is_jpeg_to_jpeg {
                let rgb = img.to_rgb8();
                let source_subsampling = jpeg_subsampling(input);
                let thresholds =
                    jpeg_to_jpeg_quality_thresholds_with_gain(img, input_len, compression_gain);

                // Search from the smallest likely acceptable candidate upward. In the
                // common case this performs one encode and one perceptual comparison.
                for candidate_quality in candidate_qualities.iter().rev().copied() {
                    let Ok(bytes) = encode_jpeg_from_rgb_image_with_subsampling(
                        &rgb,
                        candidate_quality,
                        source_subsampling,
                    ) else {
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
                let plan = png_quantization_plan_with_gain(img, input.len(), compression_gain);
                let effective_quality = amplify_quality_loss(quality, compression_gain, 1);
                let minimum_colors = if effective_quality >= 100 {
                    256
                } else if effective_quality >= 90 {
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
                let effective_quality = amplify_quality_loss(quality, compression_gain, 1);
                let encoded = if pixel_count > 8_000_000 {
                    encode_sampled_quantized_png_from_image(img, 256, effective_quality)
                } else {
                    encode_quantized_png_from_image(img, effective_quality)
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

pub fn compress_dynamic_image_to_png(
    img: &DynamicImage,
    quality: u8,
    source_size_bytes: usize,
) -> Result<CompressionResult, JsValue> {
    compress_dynamic_image_to_png_with_gain(
        img,
        quality,
        source_size_bytes,
        DEFAULT_COMPRESSION_GAIN,
    )
}

pub fn compress_dynamic_image_to_png_with_gain(
    img: &DynamicImage,
    quality: u8,
    source_size_bytes: usize,
    compression_gain: f64,
) -> Result<CompressionResult, JsValue> {
    let pixel_count = u64::from(img.width()) * u64::from(img.height());
    let plan = png_quantization_plan_with_gain(img, source_size_bytes, compression_gain);
    let effective_quality = amplify_quality_loss(quality.max(85), compression_gain, 1);

    if pixel_count > 8_000_000 {
        let colors = *plan.color_candidates.last().unwrap_or(&256);
        let bytes = encode_sampled_quantized_png_from_image(img, colors, effective_quality)?;
        return Ok(Candidate {
            bytes: optimize_quantized_png(bytes, pixel_count),
            mime: "image/png",
            ext: "png",
        }
        .into_result());
    }

    for colors in plan.color_candidates {
        let Ok(bytes) =
            encode_quantized_png_with_options(img, colors, 100, plan.dithering_level, 4)
        else {
            continue;
        };
        let Ok(decoded_candidate) =
            image::load_from_memory_with_format(bytes.as_slice(), image::ImageFormat::Png)
        else {
            continue;
        };
        let Ok(comparison) = compare_dynamic_images_for_guardrails(img, &decoded_candidate) else {
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
            return Ok(Candidate {
                bytes: optimize_quantized_png(bytes, pixel_count),
                mime: "image/png",
                ext: "png",
            }
            .into_result());
        }
    }

    // Keep cross-format conversion available even when the conservative visual
    // guardrails reject every smaller palette. The 256-color candidate remains
    // perceptually bounded by imagequant's quality target.
    let colors = *plan.color_candidates.last().unwrap_or(&256);
    let bytes =
        encode_quantized_png_with_options(img, colors, effective_quality, plan.dithering_level, 4)?;
    Ok(Candidate {
        bytes: optimize_quantized_png(bytes, pixel_count),
        mime: "image/png",
        ext: "png",
    }
    .into_result())
}

pub fn compress_image_to_target_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
) -> Result<CompressionResult, JsValue> {
    compress_image_to_target_format_with_gain(
        input,
        quality,
        target_format,
        allow_alpha_loss,
        DEFAULT_COMPRESSION_GAIN,
    )
}

pub fn compress_image_to_target_format_with_gain(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
    compression_gain: f64,
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
        compression_gain,
    )?;
    Ok(candidate.into_result())
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgba, RgbaImage};

    use super::compress_dynamic_image_to_png;

    #[test]
    fn rgba_cross_format_png_uses_an_indexed_palette() {
        let mut pixels = RgbaImage::new(128, 64);
        for (x, y, pixel) in pixels.enumerate_pixels_mut() {
            *pixel = Rgba([(x * 2) as u8, (y * 4) as u8, ((x + y) % 256) as u8, 255]);
        }

        let result =
            compress_dynamic_image_to_png(&DynamicImage::ImageRgba8(pixels), 80, 32 * 1024)
                .unwrap();

        assert_eq!(&result.bytes[1..4], b"PNG");
        assert_eq!(result.bytes[24], 8);
        assert_eq!(result.bytes[25], 3);
    }
}
