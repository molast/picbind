use image::DynamicImage;
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::JsValue;

use super::analysis::{ImageAnalysis, analyze_dynamic_image};

const FORMAT_NAMES: [&str; 4] = ["jpeg", "webp", "avif", "png"];
const MIN_SWITCH_SAVING_RATIO: f64 = 0.10;
const MAX_SWITCH_QUALITY_DROP: f64 = 2.5;

#[derive(Clone, Debug)]
pub struct FormatPrediction {
    pub format: &'static str,
    pub estimated_size_bytes: usize,
    pub estimated_visual_quality: f64,
    pub available: bool,
}

pub struct CompressionPrediction {
    pub source_format: String,
    pub recommended_format: String,
    pub should_switch_encoder: bool,
    pub predictions: Vec<FormatPrediction>,
}

impl CompressionPrediction {
    pub fn to_js_value(&self) -> Result<JsValue, JsValue> {
        let obj = Object::new();
        Reflect::set(
            &obj,
            &"sourceFormat".into(),
            &JsValue::from_str(&self.source_format),
        )?;
        Reflect::set(
            &obj,
            &"recommendedFormat".into(),
            &JsValue::from_str(&self.recommended_format),
        )?;
        Reflect::set(
            &obj,
            &"shouldSwitchEncoder".into(),
            &JsValue::from_bool(self.should_switch_encoder),
        )?;

        let predictions = Array::new();
        for prediction in &self.predictions {
            let item = Object::new();
            Reflect::set(
                &item,
                &"format".into(),
                &JsValue::from_str(prediction.format),
            )?;
            Reflect::set(
                &item,
                &"estimatedSizeBytes".into(),
                &JsValue::from_f64(prediction.estimated_size_bytes as f64),
            )?;
            Reflect::set(
                &item,
                &"estimatedVisualQuality".into(),
                &JsValue::from_f64(prediction.estimated_visual_quality),
            )?;
            Reflect::set(
                &item,
                &"available".into(),
                &JsValue::from_bool(prediction.available),
            )?;
            predictions.push(&item);
        }
        Reflect::set(&obj, &"predictions".into(), &predictions)?;
        Ok(obj.into())
    }
}

fn estimate_size(analysis: &ImageAnalysis, format: &str) -> usize {
    let complexity = analysis.complexity_score;
    let detail = analysis.detail_coverage;
    let noise = analysis.noise_level;
    let entropy = analysis.color_entropy;
    let gradient = analysis.gradient_coverage;
    let flat = analysis.flat_coverage;
    let alpha = analysis.alpha_ratio;

    let bytes_per_pixel = match format {
        "jpeg" => 0.18 + 0.34 * complexity + 0.26 * detail + 0.22 * noise + 0.08 * gradient,
        "webp" => {
            0.13 + 0.27 * complexity + 0.20 * detail + 0.14 * noise + 0.06 * gradient + 0.08 * alpha
        }
        "avif" => {
            0.09 + 0.22 * complexity + 0.16 * detail + 0.10 * noise + 0.05 * gradient + 0.10 * alpha
        }
        "png" => {
            (0.16 + 0.82 * entropy + 0.52 * noise + 0.32 * detail + 0.20 * gradient + 0.24 * alpha
                - 0.16 * flat)
                .max(0.10)
        }
        _ => 1.0,
    };

    let model_size = (analysis.pixel_count as f64 * bytes_per_pixel + 2048.0).round() as usize;
    if format == analysis.source_format {
        model_size.min((analysis.source_size_bytes as f64 * 0.98).round() as usize)
    } else {
        model_size
    }
    .max(1024)
}

fn estimate_visual_quality(analysis: &ImageAnalysis, format: &str) -> f64 {
    let edge = analysis.edge_strength;
    let gradient = analysis.gradient_coverage;
    let detail = analysis.detail_coverage;
    let flat = analysis.flat_coverage;
    let entropy = analysis.color_entropy;

    let quality = match format {
        "jpeg" => 97.4 - 1.6 * edge - 1.2 * gradient - 0.6 * detail,
        "webp" => 98.2 - 0.9 * edge - 0.6 * gradient - 0.4 * detail,
        "avif" => {
            98.0 - 1.0 * edge
                - 0.7 * gradient
                - 0.4 * detail
                - if edge >= 0.30 && flat >= 0.18 {
                    0.8
                } else {
                    0.0
                }
        }
        "png" => 99.5 - 0.35 * entropy - 0.45 * gradient - 0.20 * detail,
        _ => 0.0,
    };
    quality.clamp(0.0, 100.0)
}

fn decision_score(analysis: &ImageAnalysis, prediction: &FormatPrediction) -> f64 {
    let size_ratio =
        prediction.estimated_size_bytes as f64 / analysis.source_size_bytes.max(1) as f64;
    let quality_penalty = (100.0 - prediction.estimated_visual_quality) * 0.045;
    let photo_like = analysis.detail_coverage >= 0.24
        || analysis.color_entropy >= 0.58
        || analysis.noise_level >= 0.18;
    let palette_friendly = analysis.flat_coverage >= 0.48
        && analysis.color_entropy <= 0.48
        && analysis.noise_level <= 0.12;

    let format_bias = match prediction.format {
        "avif" if photo_like && !analysis.has_real_alpha => -0.16,
        "png" if palette_friendly => -0.20,
        "webp" if analysis.has_real_alpha => -0.08,
        "avif" if analysis.has_real_alpha && analysis.edge_strength >= 0.30 => 0.08,
        _ => 0.0,
    };
    size_ratio + quality_penalty + format_bias
}

pub fn predict_from_analysis(analysis: &ImageAnalysis) -> CompressionPrediction {
    let predictions: Vec<FormatPrediction> = FORMAT_NAMES
        .iter()
        .map(|format| FormatPrediction {
            format,
            estimated_size_bytes: estimate_size(analysis, format),
            estimated_visual_quality: estimate_visual_quality(analysis, format),
            available: *format != "jpeg" || !analysis.has_real_alpha,
        })
        .collect();

    let source_prediction = predictions
        .iter()
        .find(|prediction| prediction.format == analysis.source_format)
        .filter(|prediction| prediction.available);
    let best_prediction = predictions
        .iter()
        .filter(|prediction| prediction.available)
        .min_by(|left, right| {
            decision_score(analysis, left).total_cmp(&decision_score(analysis, right))
        });

    let should_switch_encoder = match (source_prediction, best_prediction) {
        (Some(source), Some(best)) if source.format != best.format => {
            let saving_ratio =
                1.0 - best.estimated_size_bytes as f64 / source.estimated_size_bytes.max(1) as f64;
            saving_ratio >= MIN_SWITCH_SAVING_RATIO
                && best.estimated_visual_quality + MAX_SWITCH_QUALITY_DROP
                    >= source.estimated_visual_quality
        }
        (None, Some(_)) => true,
        _ => false,
    };
    let recommended_format = if should_switch_encoder {
        best_prediction
            .map(|prediction| prediction.format)
            .unwrap_or(analysis.source_format.as_str())
    } else {
        source_prediction
            .map(|prediction| prediction.format)
            .or_else(|| best_prediction.map(|prediction| prediction.format))
            .unwrap_or("webp")
    };

    CompressionPrediction {
        source_format: analysis.source_format.clone(),
        recommended_format: recommended_format.to_string(),
        should_switch_encoder,
        predictions,
    }
}

pub fn predict_dynamic_image(
    img: &DynamicImage,
    source_size_bytes: usize,
    source_format: &str,
) -> CompressionPrediction {
    let analysis = analyze_dynamic_image(img, source_size_bytes, source_format);
    predict_from_analysis(&analysis)
}

pub fn predict_image(input: &[u8]) -> Result<CompressionPrediction, JsValue> {
    let format =
        image::guess_format(input).map_err(|error| JsValue::from_str(&error.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let source_format = match format {
        image::ImageFormat::Jpeg => "jpeg",
        image::ImageFormat::Png => "png",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Avif => "avif",
        _ => "unknown",
    };
    Ok(predict_dynamic_image(&img, input.len(), source_format))
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};

    use super::predict_dynamic_image;

    #[test]
    fn photo_like_jpeg_recommends_avif() {
        let mut pixels = RgbImage::new(640, 480);
        for (x, y, pixel) in pixels.enumerate_pixels_mut() {
            *pixel = Rgb([
                ((x * 13 + y * 7) % 256) as u8,
                ((x * 5 + y * 17) % 256) as u8,
                ((x * 19 + y * 3) % 256) as u8,
            ]);
        }
        let prediction =
            predict_dynamic_image(&DynamicImage::ImageRgb8(pixels), 5 * 1024 * 1024, "jpeg");

        assert_eq!(prediction.recommended_format, "avif");
        assert!(prediction.should_switch_encoder);
    }

    #[test]
    fn transparent_source_never_offers_jpeg() {
        let pixels = RgbaImage::from_pixel(64, 64, Rgba([40, 120, 220, 128]));
        let prediction = predict_dynamic_image(&DynamicImage::ImageRgba8(pixels), 32 * 1024, "png");
        let jpeg = prediction
            .predictions
            .iter()
            .find(|item| item.format == "jpeg")
            .unwrap();

        assert!(!jpeg.available);
        assert_ne!(prediction.recommended_format, "jpeg");
    }
}
