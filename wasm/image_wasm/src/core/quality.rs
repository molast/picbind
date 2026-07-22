use image::DynamicImage;
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::JsValue;

use super::analysis::analyze_dynamic_image;

const PNG_TO_JPEG_MIN_QUALITY_FLOOR: u8 = 80;

pub struct JpegPerceptualThresholds {
    pub min_ms_ssim: f64,
    pub max_blur_loss_percent: f64,
    pub max_perceptual_distance: f64,
    pub max_p99_delta_e: f64,
    pub max_p95_luminance_error: f64,
    pub max_p95_chroma_error: f64,
}

pub struct PngQuantizationPlan {
    pub color_candidates: [u32; 4],
    pub dithering_level: f32,
    pub min_ms_ssim: f64,
    pub max_perceptual_distance: f64,
    pub max_p99_delta_e: f64,
    pub max_p95_luminance_error: f64,
    pub max_p95_chroma_error: f64,
    pub max_p95_alpha_error: f64,
    pub max_p99_alpha_error: f64,
}

pub struct AvifEncodingPlan {
    pub quality_candidates: Vec<u8>,
    pub speed: u8,
    pub bit_depth: u8,
    pub subsample: u8,
    pub tune: u8,
    pub chroma_delta_q: bool,
    pub sharpness: u8,
    pub enable_sharp_yuv: bool,
    pub tile_cols_log2: u8,
    pub tile_rows_log2: u8,
    pub alpha_quality_floor: u8,
    pub min_ms_ssim: f64,
    pub max_blur_loss_percent: f64,
    pub max_perceptual_distance: f64,
    pub max_p99_delta_e: f64,
    pub max_p95_luminance_error: f64,
    pub max_p95_chroma_error: f64,
    pub max_p95_alpha_error: f64,
    pub max_p99_alpha_error: f64,
}

impl AvifEncodingPlan {
    pub fn to_js_value(&self) -> Result<JsValue, JsValue> {
        let obj = Object::new();
        let candidates = Array::new();
        for quality in &self.quality_candidates {
            candidates.push(&JsValue::from_f64(*quality as f64));
        }
        Reflect::set(&obj, &"qualityCandidates".into(), &candidates)?;
        Reflect::set(&obj, &"speed".into(), &(self.speed as f64).into())?;
        Reflect::set(&obj, &"bitDepth".into(), &(self.bit_depth as f64).into())?;
        for (key, value) in [
            ("subsample", self.subsample as f64),
            ("tune", self.tune as f64),
            ("sharpness", self.sharpness as f64),
            ("tileColsLog2", self.tile_cols_log2 as f64),
            ("tileRowsLog2", self.tile_rows_log2 as f64),
            ("alphaQualityFloor", self.alpha_quality_floor as f64),
            ("minMsSsim", self.min_ms_ssim),
            ("maxBlurLossPercent", self.max_blur_loss_percent),
            ("maxPerceptualDistance", self.max_perceptual_distance),
            ("maxP99DeltaE", self.max_p99_delta_e),
            ("maxP95LuminanceError", self.max_p95_luminance_error),
            ("maxP95ChromaError", self.max_p95_chroma_error),
            ("maxP95AlphaError", self.max_p95_alpha_error),
            ("maxP99AlphaError", self.max_p99_alpha_error),
        ] {
            Reflect::set(&obj, &key.into(), &value.into())?;
        }
        Reflect::set(
            &obj,
            &"chromaDeltaQ".into(),
            &JsValue::from_bool(self.chroma_delta_q),
        )?;
        Reflect::set(
            &obj,
            &"enableSharpYuv".into(),
            &JsValue::from_bool(self.enable_sharp_yuv),
        )?;
        Ok(obj.into())
    }
}

pub fn png_quantization_plan(img: &DynamicImage, source_size_bytes: usize) -> PngQuantizationPlan {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "png");
    let is_smooth_gradient = analysis.gradient_coverage >= 0.18 && analysis.noise_level <= 0.12;
    let is_color_rich = (analysis.color_entropy >= 0.72 || analysis.color_complexity >= 0.95)
        && analysis.detail_coverage >= 0.32;
    let is_edge_heavy = analysis.edge_strength >= 0.38 && analysis.flat_coverage < 0.18;

    if is_smooth_gradient {
        PngQuantizationPlan {
            color_candidates: [64, 128, 192, 256],
            dithering_level: 0.75,
            min_ms_ssim: 0.995,
            max_perceptual_distance: 1.80,
            max_p99_delta_e: 3.80,
            max_p95_luminance_error: 0.80,
            max_p95_chroma_error: 3.10,
            max_p95_alpha_error: 0.02,
            max_p99_alpha_error: 0.04,
        }
    } else if is_color_rich {
        PngQuantizationPlan {
            color_candidates: [64, 128, 192, 256],
            dithering_level: 0.75,
            min_ms_ssim: 0.992,
            max_perceptual_distance: 3.0,
            max_p99_delta_e: 5.30,
            max_p95_luminance_error: 1.30,
            max_p95_chroma_error: 4.80,
            max_p95_alpha_error: 0.02,
            max_p99_alpha_error: 0.04,
        }
    } else if is_edge_heavy {
        PngQuantizationPlan {
            color_candidates: [64, 128, 192, 256],
            dithering_level: 0.0,
            min_ms_ssim: 0.980,
            max_perceptual_distance: 5.0,
            max_p99_delta_e: 10.0,
            max_p95_luminance_error: 1.75,
            max_p95_chroma_error: 7.60,
            max_p95_alpha_error: 0.02,
            max_p99_alpha_error: 0.04,
        }
    } else {
        PngQuantizationPlan {
            color_candidates: [64, 128, 192, 256],
            dithering_level: 0.55,
            min_ms_ssim: 0.990,
            max_perceptual_distance: 3.20,
            max_p99_delta_e: 6.0,
            max_p95_luminance_error: 1.30,
            max_p95_chroma_error: 5.50,
            max_p95_alpha_error: 0.02,
            max_p99_alpha_error: 0.04,
        }
    }
}

pub fn png_to_jpeg_quality_candidates(
    img: &DynamicImage,
    requested_quality: u8,
    source_size_bytes: usize,
) -> Vec<u8> {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "png");
    let width = analysis.width;
    let height = analysis.height;
    let pixel_count = analysis.pixel_count;
    if width < 2 || height < 2 {
        return vec![requested_quality.max(95), requested_quality.max(93)];
    }
    let complexity = analysis.complexity_score;
    let source_size_mb = analysis.source_size_mb;
    let size_stage = if source_size_mb < 1.0 {
        0
    } else {
        (((source_size_mb - 1.0) / 0.5).floor() as u8).saturating_add(1)
    };
    let large_image_bias = match size_stage {
        0 => {
            if pixel_count >= 7_000_000 {
                2
            } else if pixel_count >= 4_000_000 {
                1
            } else {
                0
            }
        }
        1 => 1,
        2 => 2,
        3 => 4,
        4 => 6,
        5 => 9,
        _ => 12,
    };
    let min_quality = match size_stage {
        0 | 1 => 86,
        2 | 3 => 84,
        4 | 5 => 82,
        _ => PNG_TO_JPEG_MIN_QUALITY_FLOOR,
    }
    .max(PNG_TO_JPEG_MIN_QUALITY_FLOOR);

    let base = requested_quality.max(91) as i32;
    let mut adaptive = base;

    adaptive += match () {
        _ if analysis.detail_coverage >= 0.34 => 4,
        _ if analysis.detail_coverage >= 0.24 => 2,
        _ if analysis.detail_coverage >= 0.16 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.edge_strength >= 0.42 => 2,
        _ if analysis.edge_strength >= 0.30 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.color_complexity >= 0.34 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.gradient_coverage >= 0.35 => 2,
        _ if analysis.gradient_coverage >= 0.18 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if complexity >= 0.62 => 2,
        _ if complexity >= 0.48 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.alpha_ratio >= 0.08 => 2,
        _ if analysis.alpha_ratio >= 0.02 => 1,
        _ => 0,
    };

    adaptive -= match () {
        _ if analysis.flat_coverage >= 0.52 => 4,
        _ if analysis.flat_coverage >= 0.38 => 2,
        _ if analysis.flat_coverage >= 0.24 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.compressibility_score >= 0.72 => 4,
        _ if analysis.compressibility_score >= 0.58 => 2,
        _ if analysis.compressibility_score >= 0.44 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.noise_level >= 0.45 => 2,
        _ if analysis.noise_level >= 0.25 => 1,
        _ => 0,
    };
    adaptive -= large_image_bias as i32;
    adaptive -= match () {
        _ if pixel_count >= 8_000_000 => 2,
        _ if pixel_count >= 5_000_000 => 1,
        _ => 0,
    };

    let adaptive = adaptive
        .clamp(PNG_TO_JPEG_MIN_QUALITY_FLOOR as i32, 98)
        .max(min_quality as i32) as u8;

    let mut candidates = vec![
        adaptive,
        adaptive.saturating_sub(1),
        adaptive.saturating_sub(2),
        adaptive.saturating_sub(3),
        adaptive.saturating_sub(5),
    ];
    candidates.retain(|quality| *quality >= PNG_TO_JPEG_MIN_QUALITY_FLOOR);
    candidates.sort_unstable();
    candidates.dedup();
    candidates.reverse();
    candidates
}

pub fn jpeg_to_jpeg_quality_candidates(
    img: &DynamicImage,
    requested_quality: u8,
    source_size_bytes: usize,
) -> Vec<u8> {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "jpeg");
    let (width, height) = (analysis.width, analysis.height);
    if width < 2 || height < 2 {
        return vec![requested_quality.max(92), requested_quality.max(90)];
    }

    let base = requested_quality.max(84) as i32;
    let mut adaptive = base;

    adaptive += match () {
        _ if analysis.detail_coverage >= 0.30 => 3,
        _ if analysis.detail_coverage >= 0.20 => 2,
        _ if analysis.detail_coverage >= 0.12 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.edge_strength >= 0.40 => 1,
        _ if analysis.edge_strength >= 0.28 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.complexity_score >= 0.60 => 1,
        _ if analysis.complexity_score >= 0.46 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.gradient_coverage >= 0.35 => 2,
        _ if analysis.gradient_coverage >= 0.18 => 1,
        _ => 0,
    };

    adaptive -= match () {
        _ if analysis.flat_coverage >= 0.52 => 4,
        _ if analysis.flat_coverage >= 0.40 => 3,
        _ if analysis.flat_coverage >= 0.28 => 2,
        _ if analysis.flat_coverage >= 0.18 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.source_size_mb >= 3.0 => 5,
        _ if analysis.source_size_mb >= 2.5 => 4,
        _ if analysis.source_size_mb >= 2.0 => 3,
        _ if analysis.source_size_mb >= 1.5 => 2,
        _ if analysis.source_size_mb >= 1.0 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.compressibility_score >= 0.72 => 5,
        _ if analysis.compressibility_score >= 0.60 => 3,
        _ if analysis.compressibility_score >= 0.48 => 2,
        _ if analysis.compressibility_score >= 0.36 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.noise_level >= 0.45 => 2,
        _ if analysis.noise_level >= 0.25 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.pixel_count >= 8_000_000 => 2,
        _ if analysis.pixel_count >= 4_000_000 => 1,
        _ => 0,
    };

    let adaptive = adaptive.clamp(78, 94) as u8;
    let mut candidates = vec![
        adaptive,
        adaptive.saturating_sub(7),
        adaptive.saturating_sub(13),
        adaptive.saturating_sub(19),
        adaptive.saturating_sub(25),
    ];
    candidates.retain(|quality| *quality >= 52);
    candidates.sort_unstable();
    candidates.dedup();
    candidates.reverse();
    candidates
}

pub fn jpeg_to_jpeg_quality_thresholds(
    img: &DynamicImage,
    source_size_bytes: usize,
) -> JpegPerceptualThresholds {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "jpeg");
    if analysis.flat_coverage >= 0.44 || analysis.compressibility_score >= 0.62 {
        JpegPerceptualThresholds {
            min_ms_ssim: 0.975,
            max_blur_loss_percent: 5.0,
            max_perceptual_distance: 2.40,
            max_p99_delta_e: 4.80,
            max_p95_luminance_error: 1.0,
            max_p95_chroma_error: 4.30,
        }
    } else if analysis.detail_coverage >= 0.30 || analysis.edge_strength >= 0.38 {
        JpegPerceptualThresholds {
            min_ms_ssim: 0.982,
            max_blur_loss_percent: 6.0,
            max_perceptual_distance: 3.20,
            max_p99_delta_e: 6.0,
            max_p95_luminance_error: 1.25,
            max_p95_chroma_error: 5.50,
        }
    } else {
        JpegPerceptualThresholds {
            min_ms_ssim: 0.978,
            max_blur_loss_percent: 5.5,
            max_perceptual_distance: 2.80,
            max_p99_delta_e: 5.50,
            max_p95_luminance_error: 1.10,
            max_p95_chroma_error: 5.0,
        }
    }
}

pub fn avif_speed_for_pixels(pixel_count: usize) -> u8 {
    if pixel_count <= 900_000 {
        4
    } else if pixel_count <= 2_500_000 {
        5
    } else {
        6
    }
}

pub fn avif_encoding_plan(
    img: &DynamicImage,
    requested_quality: u8,
    source_size_bytes: usize,
) -> AvifEncodingPlan {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "avif");
    let photo_like = analysis.detail_coverage >= 0.24
        || analysis.brightness_variance >= 0.30
        || analysis.color_entropy >= 0.58
        || analysis.noise_level >= 0.18
        || (analysis.color_complexity >= 0.34 && analysis.flat_coverage < 0.28);
    let ui_like = analysis.edge_strength >= 0.30
        && analysis.flat_coverage >= 0.18
        && analysis.detail_coverage < 0.34
        && analysis.noise_level < 0.18;
    let near_lossless_candidate = analysis.pixel_count <= 1_500_000
        && analysis.flat_coverage >= 0.52
        && analysis.color_complexity <= 0.24
        && analysis.color_entropy <= 0.40;

    let mut predicted = requested_quality.clamp(55, 96) as i32 - if photo_like { 35 } else { 22 };
    predicted += if analysis.detail_coverage >= 0.36 {
        if photo_like { 7 } else { 8 }
    } else if analysis.detail_coverage >= 0.24 {
        if photo_like { 4 } else { 5 }
    } else {
        0
    };
    predicted += if analysis.edge_strength >= 0.40 {
        5
    } else if analysis.edge_strength >= 0.28 {
        2
    } else {
        0
    };
    predicted += if analysis.gradient_coverage >= 0.35 {
        3
    } else if analysis.gradient_coverage >= 0.18 {
        1
    } else {
        0
    };
    predicted -= if analysis.noise_level >= 0.45 {
        3
    } else if analysis.noise_level >= 0.25 {
        1
    } else {
        0
    };
    predicted += if ui_like { 5 } else { 0 };
    let predicted = predicted.clamp(if photo_like { 36 } else { 48 }, 94) as u8;

    // Search from the smallest likely acceptable candidate toward conservative quality.
    // Most photos pass on the first or second encode; the final candidate is the guardrail.
    let mut quality_candidates = if near_lossless_candidate {
        vec![predicted.max(76), predicted.saturating_add(8).min(96)]
    } else if photo_like {
        vec![
            predicted.saturating_sub(6).max(32),
            predicted,
            predicted.saturating_add(3).min(96),
            predicted.saturating_add(6).min(98),
        ]
    } else {
        vec![
            predicted.saturating_sub(8).max(32),
            predicted,
            predicted.saturating_add(7).min(97),
        ]
    };
    // Quality 100 is the final near-lossless guardrail. It is only encoded if
    // all predicted lossy candidates fail the visual comparison.
    quality_candidates.push(100);
    quality_candidates.sort_unstable();
    quality_candidates.dedup();

    AvifEncodingPlan {
        quality_candidates,
        speed: avif_speed_for_pixels(analysis.pixel_count),
        bit_depth: 8,
        subsample: if analysis.gradient_coverage >= 0.25 && analysis.noise_level < 0.18 {
            3
        } else if ui_like && !photo_like {
            3
        } else if !photo_like && analysis.color_complexity >= 0.42 {
            2
        } else {
            1
        },
        tune: 2,
        chroma_delta_q: photo_like,
        sharpness: if photo_like { 1 } else { 0 },
        enable_sharp_yuv: true,
        tile_cols_log2: if analysis.pixel_count >= 2_000_000 {
            1
        } else {
            0
        },
        tile_rows_log2: if analysis.pixel_count >= 4_000_000 {
            1
        } else {
            0
        },
        alpha_quality_floor: if analysis.has_alpha { 90 } else { 1 },
        // AVIF's transform and 4:2:0 chroma subsampling naturally score lower
        // than PNG/JPEG on pixel-distance metrics even when the visual result is
        // transparent to the eye. Keep UI assets conservative, but let photos
        // use the same practical HVS envelope as the adaptive JPEG path.
        min_ms_ssim: if ui_like { 0.985 } else { 0.980 },
        max_blur_loss_percent: if ui_like { 4.0 } else { 7.5 },
        max_perceptual_distance: if ui_like { 2.5 } else { 5.5 },
        max_p99_delta_e: if ui_like { 4.5 } else { 8.5 },
        max_p95_luminance_error: if ui_like { 1.0 } else { 3.1 },
        max_p95_chroma_error: if ui_like { 4.0 } else { 10.0 },
        max_p95_alpha_error: 0.02,
        max_p99_alpha_error: 0.04,
    }
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgb, RgbImage};

    use super::{avif_encoding_plan, png_quantization_plan};

    fn horizontal_gradient() -> DynamicImage {
        let mut image = RgbImage::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let value = (x * 4) as u8;
                image.put_pixel(x, y, Rgb([value, value, value]));
            }
        }
        DynamicImage::ImageRgb8(image)
    }

    fn checker_noise() -> DynamicImage {
        let mut image = RgbImage::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let value = if (x + y) % 2 == 0 { 0 } else { 255 };
                image.put_pixel(x, y, Rgb([value, value, value]));
            }
        }
        DynamicImage::ImageRgb8(image)
    }

    #[test]
    fn smooth_gradient_uses_gradient_safe_plans() {
        let image = horizontal_gradient();
        let png = png_quantization_plan(&image, 4096);
        let avif = avif_encoding_plan(&image, 80, 4096);

        assert_eq!(png.dithering_level, 0.75);
        assert_eq!(avif.subsample, 3);
    }

    #[test]
    fn noise_is_not_planned_as_a_smooth_gradient() {
        let plan = png_quantization_plan(&checker_noise(), 4096);
        assert_eq!(plan.dithering_level, 0.0);
    }
}
