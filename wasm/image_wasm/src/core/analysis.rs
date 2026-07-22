use image::DynamicImage;
use js_sys::{Object, Reflect};
use wasm_bindgen::JsValue;

use super::feature::{ImageFeature, extract_dynamic_image_features};

pub struct ImageAnalysis {
    pub width: u32,
    pub height: u32,
    pub pixel_count: usize,
    pub source_size_bytes: usize,
    pub source_size_mb: f64,
    pub source_format: String,
    pub has_alpha: bool,
    pub has_alpha_channel: bool,
    pub has_real_alpha: bool,
    pub alpha_min: u8,
    pub alpha_max: u8,
    pub alpha_ratio: f64,
    pub transparent_pixel_ratio: f64,
    pub semi_transparent_ratio: f64,
    pub sample_stride: usize,
    pub sample_count: usize,
    pub edge_strength: f64,
    pub brightness_variance: f64,
    pub color_complexity: f64,
    pub color_entropy: f64,
    pub noise_level: f64,
    pub gradient_coverage: f64,
    pub detail_coverage: f64,
    pub flat_coverage: f64,
    pub complexity_score: f64,
    pub compressibility_score: f64,
}

impl ImageAnalysis {
    pub fn to_js_value(&self) -> Result<JsValue, JsValue> {
        let obj = Object::new();
        set_number(&obj, "width", self.width as f64)?;
        set_number(&obj, "height", self.height as f64)?;
        set_number(&obj, "pixelCount", self.pixel_count as f64)?;
        set_number(&obj, "sourceSizeBytes", self.source_size_bytes as f64)?;
        set_number(&obj, "sourceSizeMb", self.source_size_mb)?;
        set_string(&obj, "sourceFormat", &self.source_format)?;
        set_bool(&obj, "hasAlpha", self.has_alpha)?;
        set_bool(&obj, "hasAlphaChannel", self.has_alpha_channel)?;
        set_bool(&obj, "hasRealAlpha", self.has_real_alpha)?;
        set_number(&obj, "alphaMin", self.alpha_min as f64)?;
        set_number(&obj, "alphaMax", self.alpha_max as f64)?;
        set_number(&obj, "alphaRatio", self.alpha_ratio)?;
        set_number(&obj, "transparentPixelRatio", self.transparent_pixel_ratio)?;
        set_number(&obj, "semiTransparentRatio", self.semi_transparent_ratio)?;
        set_number(&obj, "sampleStride", self.sample_stride as f64)?;
        set_number(&obj, "sampleCount", self.sample_count as f64)?;
        set_number(&obj, "edgeStrength", self.edge_strength)?;
        set_number(&obj, "brightnessVariance", self.brightness_variance)?;
        set_number(&obj, "colorComplexity", self.color_complexity)?;
        set_number(&obj, "colorEntropy", self.color_entropy)?;
        set_number(&obj, "noiseLevel", self.noise_level)?;
        set_number(&obj, "gradientCoverage", self.gradient_coverage)?;
        set_number(&obj, "detailCoverage", self.detail_coverage)?;
        set_number(&obj, "flatCoverage", self.flat_coverage)?;
        set_number(&obj, "complexityScore", self.complexity_score)?;
        set_number(&obj, "compressibilityScore", self.compressibility_score)?;
        Ok(obj.into())
    }
}

pub fn analyze_image_metrics(input: &[u8]) -> Result<ImageAnalysis, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(analyze_dynamic_image(
        &img,
        input.len(),
        &format_to_label(format),
    ))
}

pub fn analyze_dynamic_image(
    img: &DynamicImage,
    source_size_bytes: usize,
    source_format: &str,
) -> ImageAnalysis {
    analyze_image_features(extract_dynamic_image_features(
        img,
        source_size_bytes,
        source_format,
    ))
}

pub fn analyze_image_features(feature: ImageFeature) -> ImageAnalysis {
    let alpha_ratio = feature.alpha.non_opaque_pixel_ratio;
    let complexity_score = (0.24 * feature.edge_strength
        + 0.14 * feature.brightness_variance
        + 0.12 * feature.color_complexity
        + 0.16 * feature.color_entropy
        + 0.15 * feature.detail_coverage
        + 0.13 * feature.noise_level
        + 0.06 * feature.gradient_coverage
        - 0.12 * feature.flat_coverage)
        .clamp(0.0, 1.0);
    let size_pressure = (feature.source_size_mb / 4.0).clamp(0.0, 1.0);
    let compressibility_score = (0.30 * feature.flat_coverage
        + 0.10 * feature.gradient_coverage
        + 0.20 * (1.0 - complexity_score)
        + 0.14 * (1.0 - feature.detail_coverage)
        + 0.08 * (1.0 - feature.color_entropy)
        + 0.10 * (1.0 - alpha_ratio)
        + 0.08 * size_pressure)
        .clamp(0.0, 1.0);

    ImageAnalysis {
        width: feature.width,
        height: feature.height,
        pixel_count: feature.pixel_count,
        source_size_bytes: feature.source_size_bytes,
        source_size_mb: feature.source_size_mb,
        source_format: feature.source_format,
        has_alpha: feature.alpha.has_real_alpha,
        has_alpha_channel: feature.alpha.has_alpha_channel,
        has_real_alpha: feature.alpha.has_real_alpha,
        alpha_min: feature.alpha.alpha_min,
        alpha_max: feature.alpha.alpha_max,
        alpha_ratio,
        transparent_pixel_ratio: feature.alpha.transparent_pixel_ratio,
        semi_transparent_ratio: feature.alpha.semi_transparent_ratio,
        sample_stride: feature.sample_stride,
        sample_count: feature.sample_count,
        edge_strength: feature.edge_strength,
        brightness_variance: feature.brightness_variance,
        color_complexity: feature.color_complexity,
        color_entropy: feature.color_entropy,
        noise_level: feature.noise_level,
        gradient_coverage: feature.gradient_coverage,
        detail_coverage: feature.detail_coverage,
        flat_coverage: feature.flat_coverage,
        complexity_score,
        compressibility_score,
    }
}

fn format_to_label(format: image::ImageFormat) -> String {
    match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpeg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Gif => "gif",
        image::ImageFormat::Bmp => "bmp",
        image::ImageFormat::Tiff => "tiff",
        image::ImageFormat::Avif => "avif",
        _ => "unknown",
    }
    .to_string()
}

fn set_number(target: &Object, key: &str, value: f64) -> Result<(), JsValue> {
    Reflect::set(target, &JsValue::from_str(key), &JsValue::from_f64(value))
        .map(|_| ())
        .map_err(|_| JsValue::from_str(&format!("Failed to set analysis field: {}", key)))
}

fn set_string(target: &Object, key: &str, value: &str) -> Result<(), JsValue> {
    Reflect::set(target, &JsValue::from_str(key), &JsValue::from_str(value))
        .map(|_| ())
        .map_err(|_| JsValue::from_str(&format!("Failed to set analysis field: {}", key)))
}

fn set_bool(target: &Object, key: &str, value: bool) -> Result<(), JsValue> {
    Reflect::set(target, &JsValue::from_str(key), &JsValue::from_bool(value))
        .map(|_| ())
        .map_err(|_| JsValue::from_str(&format!("Failed to set analysis field: {}", key)))
}
