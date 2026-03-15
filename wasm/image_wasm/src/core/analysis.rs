use image::DynamicImage;
use js_sys::{Object, Reflect};
use wasm_bindgen::JsValue;

pub struct ImageAnalysis {
    pub width: u32,
    pub height: u32,
    pub pixel_count: usize,
    pub source_size_bytes: usize,
    pub source_size_mb: f64,
    pub source_format: String,
    pub has_alpha: bool,
    pub alpha_ratio: f64,
    pub sample_stride: usize,
    pub sample_count: usize,
    pub edge_strength: f64,
    pub brightness_variance: f64,
    pub color_complexity: f64,
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
        set_number(&obj, "alphaRatio", self.alpha_ratio)?;
        set_number(&obj, "sampleStride", self.sample_stride as f64)?;
        set_number(&obj, "sampleCount", self.sample_count as f64)?;
        set_number(&obj, "edgeStrength", self.edge_strength)?;
        set_number(&obj, "brightnessVariance", self.brightness_variance)?;
        set_number(&obj, "colorComplexity", self.color_complexity)?;
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
    Ok(analyze_dynamic_image(&img, input.len(), &format_to_label(format)))
}

pub fn analyze_dynamic_image(
    img: &DynamicImage,
    source_size_bytes: usize,
    source_format: &str,
) -> ImageAnalysis {
    let rgba = img.to_rgba8();
    let rgb = img.to_rgb8();
    let (width, height) = rgb.dimensions();
    let pixel_count = (width as usize) * (height as usize);
    let source_size_mb = source_size_bytes as f64 / (1024.0 * 1024.0);

    let alpha_ratio = if pixel_count == 0 {
        0.0
    } else {
        rgba.pixels().filter(|pixel| pixel[3] < 255).count() as f64 / pixel_count as f64
    };

    if width < 2 || height < 2 {
        return ImageAnalysis {
            width,
            height,
            pixel_count,
            source_size_bytes,
            source_size_mb,
            source_format: source_format.to_string(),
            has_alpha: alpha_ratio > 0.0,
            alpha_ratio,
            sample_stride: 1,
            sample_count: pixel_count,
            edge_strength: 0.0,
            brightness_variance: 0.0,
            color_complexity: 0.0,
            detail_coverage: 0.0,
            flat_coverage: 1.0,
            complexity_score: 0.0,
            compressibility_score: 1.0,
        };
    }

    let stride = ((width.max(height) / 320).max(1)) as usize;
    let mut sample_count = 0usize;
    let mut luminance_sum = 0.0f64;
    let mut luminance_sq_sum = 0.0f64;
    let mut edge_sum = 0.0f64;
    let mut color_sum = 0.0f64;
    let mut detail_samples = 0usize;
    let mut flat_samples = 0usize;

    let to_luma = |r: u8, g: u8, b: u8| -> f64 {
        0.2126 * (r as f64) + 0.7152 * (g as f64) + 0.0722 * (b as f64)
    };

    for y in (0..height as usize).step_by(stride) {
        for x in (0..width as usize).step_by(stride) {
            let current = rgb.get_pixel(x as u32, y as u32).0;
            let luma = to_luma(current[0], current[1], current[2]);
            luminance_sum += luma;
            luminance_sq_sum += luma * luma;
            color_sum += ((current[0] as f64 - current[1] as f64).abs()
                + (current[1] as f64 - current[2] as f64).abs()
                + (current[0] as f64 - current[2] as f64).abs())
                / 3.0;

            let mut local_edge = 0.0f64;
            if x + stride < width as usize {
                let right = rgb.get_pixel((x + stride) as u32, y as u32).0;
                let right_luma = to_luma(right[0], right[1], right[2]);
                let delta = (luma - right_luma).abs();
                edge_sum += delta;
                local_edge += delta;
            }
            if y + stride < height as usize {
                let bottom = rgb.get_pixel(x as u32, (y + stride) as u32).0;
                let bottom_luma = to_luma(bottom[0], bottom[1], bottom[2]);
                let delta = (luma - bottom_luma).abs();
                edge_sum += delta;
                local_edge += delta;
            }

            let local_color = ((current[0] as f64 - current[1] as f64).abs()
                + (current[1] as f64 - current[2] as f64).abs()
                + (current[0] as f64 - current[2] as f64).abs())
                / 3.0;

            if local_edge >= 22.0 || (local_edge >= 14.0 && local_color >= 18.0) {
                detail_samples += 1;
            } else if local_edge <= 6.0 && local_color <= 10.0 {
                flat_samples += 1;
            }

            sample_count += 1;
        }
    }

    let mean_luma = if sample_count == 0 {
        0.0
    } else {
        luminance_sum / sample_count as f64
    };
    let variance = if sample_count == 0 {
        0.0
    } else {
        (luminance_sq_sum / sample_count as f64) - mean_luma * mean_luma
    };
    let brightness_variance = (variance.sqrt() / 64.0).clamp(0.0, 1.0);
    let edge_strength = if sample_count == 0 {
        0.0
    } else {
        (edge_sum / sample_count as f64 / 48.0).clamp(0.0, 1.0)
    };
    let color_complexity = if sample_count == 0 {
        0.0
    } else {
        (color_sum / sample_count as f64 / 48.0).clamp(0.0, 1.0)
    };
    let detail_coverage = if sample_count == 0 {
        0.0
    } else {
        (detail_samples as f64 / sample_count as f64).clamp(0.0, 1.0)
    };
    let flat_coverage = if sample_count == 0 {
        0.0
    } else {
        (flat_samples as f64 / sample_count as f64).clamp(0.0, 1.0)
    };

    let complexity_score = (0.32 * edge_strength
        + 0.22 * brightness_variance
        + 0.16 * color_complexity
        + 0.22 * detail_coverage
        - 0.14 * flat_coverage)
        .clamp(0.0, 1.0);

    let size_pressure = (source_size_mb / 4.0).clamp(0.0, 1.0);
    let compressibility_score = (0.38 * flat_coverage
        + 0.22 * (1.0 - complexity_score)
        + 0.18 * (1.0 - detail_coverage)
        + 0.12 * (1.0 - alpha_ratio)
        + 0.10 * size_pressure)
        .clamp(0.0, 1.0);

    ImageAnalysis {
        width,
        height,
        pixel_count,
        source_size_bytes,
        source_size_mb,
        source_format: source_format.to_string(),
        has_alpha: alpha_ratio > 0.0,
        alpha_ratio,
        sample_stride: stride,
        sample_count,
        edge_strength,
        brightness_variance,
        color_complexity,
        detail_coverage,
        flat_coverage,
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
