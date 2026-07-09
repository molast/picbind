use image::{DynamicImage, GrayImage, imageops::FilterType};
use js_sys::{Object, Reflect};
use wasm_bindgen::JsValue;

const SSIM_WINDOW: usize = 8;
const SSIM_K1: f64 = 0.01;
const SSIM_K2: f64 = 0.03;
const SSIM_L: f64 = 255.0;

pub struct QualityComparison {
    pub width: u32,
    pub height: u32,
    pub mse: f64,
    pub rmse: f64,
    pub psnr: f64,
    pub ssim: f64,
    pub ms_ssim: f64,
    pub edge_retention: f64,
    pub blur_loss_percent: f64,
    pub overall_quality_score: f64,
    pub original_edge_energy: f64,
    pub compressed_edge_energy: f64,
    pub original_laplacian_variance: f64,
    pub compressed_laplacian_variance: f64,
}

impl QualityComparison {
    pub fn to_js_value(&self) -> Result<JsValue, JsValue> {
        let obj = Object::new();
        set_number(&obj, "width", self.width as f64)?;
        set_number(&obj, "height", self.height as f64)?;
        set_number(&obj, "mse", self.mse)?;
        set_number(&obj, "rmse", self.rmse)?;
        set_number(&obj, "psnr", self.psnr)?;
        set_number(&obj, "ssim", self.ssim)?;
        set_number(&obj, "msSsim", self.ms_ssim)?;
        set_number(&obj, "edgeRetention", self.edge_retention)?;
        set_number(&obj, "blurLossPercent", self.blur_loss_percent)?;
        set_number(&obj, "overallQualityScore", self.overall_quality_score)?;
        set_number(&obj, "originalEdgeEnergy", self.original_edge_energy)?;
        set_number(&obj, "compressedEdgeEnergy", self.compressed_edge_energy)?;
        set_number(
            &obj,
            "originalLaplacianVariance",
            self.original_laplacian_variance,
        )?;
        set_number(
            &obj,
            "compressedLaplacianVariance",
            self.compressed_laplacian_variance,
        )?;
        Ok(obj.into())
    }
}

pub fn compare_image_quality(
    original_input: &[u8],
    compressed_input: &[u8],
) -> Result<QualityComparison, JsValue> {
    let original_format =
        image::guess_format(original_input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let compressed_format =
        image::guess_format(compressed_input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let original = image::load_from_memory_with_format(original_input, original_format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let compressed = image::load_from_memory_with_format(compressed_input, compressed_format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    compare_dynamic_images(&original, &compressed)
}

pub fn calculate_image_quality_score(
    original_input: &[u8],
    assessed_input: &[u8],
) -> Result<QualityComparison, JsValue> {
    compare_image_quality(original_input, assessed_input)
}

pub fn compare_dynamic_images(
    original: &DynamicImage,
    compressed: &DynamicImage,
) -> Result<QualityComparison, JsValue> {
    compare_dynamic_images_internal(original, compressed)
}

pub fn compare_dynamic_images_for_guardrails(
    original: &DynamicImage,
    compressed: &DynamicImage,
) -> Result<QualityComparison, JsValue> {
    let resized_original = downscale_for_guardrail_metrics(original, 1600);
    let resized_compressed = downscale_for_guardrail_metrics(compressed, 1600);
    compare_dynamic_images_internal(&resized_original, &resized_compressed)
}

fn compare_dynamic_images_internal(
    original: &DynamicImage,
    compressed: &DynamicImage,
) -> Result<QualityComparison, JsValue> {
    let (width, height) = original.to_rgb8().dimensions();
    if width < 3 || height < 3 {
        return Err(JsValue::from_str(
            "Image quality comparison requires images at least 3x3 pixels",
        ));
    }

    let aligned_compressed = align_to_dimensions(&compressed, width, height);
    let original_rgb = original.to_rgb8();
    let compressed_rgb = aligned_compressed.to_rgb8();
    let original_gray = original.to_luma8();
    let compressed_gray = aligned_compressed.to_luma8();

    let mse = mean_squared_error_rgb(&original_rgb, &compressed_rgb);
    let rmse = mse.sqrt();
    let psnr = psnr_from_mse(mse);
    let original_edge_energy = sobel_edge_energy(&original_gray);
    let compressed_edge_energy = sobel_edge_energy(&compressed_gray);
    let edge_retention = if original_edge_energy <= f64::EPSILON {
        1.0
    } else {
        (compressed_edge_energy / original_edge_energy).clamp(0.0, 1.0)
    };

    let original_laplacian_variance = laplacian_variance(&original_gray);
    let compressed_laplacian_variance = laplacian_variance(&compressed_gray);
    let laplacian_retention = if original_laplacian_variance <= f64::EPSILON {
        1.0
    } else {
        (compressed_laplacian_variance / original_laplacian_variance).clamp(0.0, 1.0)
    };

    let ssim = structural_similarity(&original_gray, &compressed_gray).clamp(0.0, 1.0);
    let ms_ssim =
        multi_scale_structural_similarity(&original_gray, &compressed_gray).clamp(0.0, 1.0);
    let blur_loss_percent =
        ((1.0 - (0.7 * edge_retention + 0.3 * laplacian_retention)).clamp(0.0, 1.0)) * 100.0;
    let overall_quality_score = (100.0
        * (0.44 * ssim + 0.24 * ms_ssim + 0.32 * (1.0 - blur_loss_percent / 100.0)))
        .clamp(0.0, 100.0);

    Ok(QualityComparison {
        width,
        height,
        mse,
        rmse,
        psnr,
        ssim,
        ms_ssim,
        edge_retention,
        blur_loss_percent,
        overall_quality_score,
        original_edge_energy,
        compressed_edge_energy,
        original_laplacian_variance,
        compressed_laplacian_variance,
    })
}

fn mean_squared_error_rgb(original: &image::RgbImage, compressed: &image::RgbImage) -> f64 {
    let width = original.width().min(compressed.width());
    let height = original.height().min(compressed.height());
    if width == 0 || height == 0 {
        return 0.0;
    }

    let mut squared_error_sum = 0.0f64;
    let mut sample_count = 0usize;
    for y in 0..height {
        for x in 0..width {
            let a = original.get_pixel(x, y).0;
            let b = compressed.get_pixel(x, y).0;
            for channel in 0..3 {
                let diff = a[channel] as f64 - b[channel] as f64;
                squared_error_sum += diff * diff;
                sample_count += 1;
            }
        }
    }

    if sample_count == 0 {
        0.0
    } else {
        squared_error_sum / sample_count as f64
    }
}

fn psnr_from_mse(mse: f64) -> f64 {
    if mse <= f64::EPSILON {
        f64::INFINITY
    } else {
        10.0 * ((255.0 * 255.0) / mse).log10()
    }
}

fn downscale_for_guardrail_metrics(img: &DynamicImage, max_dimension: u32) -> DynamicImage {
    let width = img.width();
    let height = img.height();
    let longest_edge = width.max(height);
    if longest_edge <= max_dimension {
        return img.clone();
    }

    let scale = max_dimension as f64 / longest_edge as f64;
    let target_width = ((width as f64 * scale).round() as u32).max(1);
    let target_height = ((height as f64 * scale).round() as u32).max(1);
    img.resize_exact(target_width, target_height, FilterType::Triangle)
}

fn set_number(target: &Object, key: &str, value: f64) -> Result<(), JsValue> {
    Reflect::set(target, &JsValue::from_str(key), &JsValue::from_f64(value))
        .map(|_| ())
        .map_err(|_| JsValue::from_str(&format!("Failed to set metric field: {}", key)))
}

fn align_to_dimensions(img: &DynamicImage, width: u32, height: u32) -> DynamicImage {
    if img.width() == width && img.height() == height {
        return img.clone();
    }

    img.resize_exact(width, height, FilterType::Triangle)
}

fn sobel_edge_energy(img: &GrayImage) -> f64 {
    let width = img.width() as i32;
    let height = img.height() as i32;
    let mut total = 0.0f64;
    let mut count = 0usize;

    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let p = |dx: i32, dy: i32| -> f64 {
                img.get_pixel((x + dx) as u32, (y + dy) as u32).0[0] as f64
            };

            let gx = -p(-1, -1) + p(1, -1) - 2.0 * p(-1, 0) + 2.0 * p(1, 0) - p(-1, 1) + p(1, 1);
            let gy = p(-1, -1) + 2.0 * p(0, -1) + p(1, -1) - p(-1, 1) - 2.0 * p(0, 1) - p(1, 1);

            total += (gx * gx + gy * gy).sqrt();
            count += 1;
        }
    }

    if count == 0 {
        0.0
    } else {
        total / count as f64
    }
}

fn laplacian_variance(img: &GrayImage) -> f64 {
    let width = img.width() as i32;
    let height = img.height() as i32;
    let mut values = Vec::with_capacity(((width - 2).max(0) * (height - 2).max(0)) as usize);

    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let center = img.get_pixel(x as u32, y as u32).0[0] as f64;
            let top = img.get_pixel(x as u32, (y - 1) as u32).0[0] as f64;
            let bottom = img.get_pixel(x as u32, (y + 1) as u32).0[0] as f64;
            let left = img.get_pixel((x - 1) as u32, y as u32).0[0] as f64;
            let right = img.get_pixel((x + 1) as u32, y as u32).0[0] as f64;
            let lap = top + bottom + left + right - 4.0 * center;
            values.push(lap);
        }
    }

    if values.is_empty() {
        return 0.0;
    }

    let mean = values.iter().sum::<f64>() / values.len() as f64;
    values
        .iter()
        .map(|value| {
            let diff = *value - mean;
            diff * diff
        })
        .sum::<f64>()
        / values.len() as f64
}

fn structural_similarity(original: &GrayImage, compressed: &GrayImage) -> f64 {
    let width = original.width() as usize;
    let height = original.height() as usize;
    let step = (SSIM_WINDOW / 2).max(1);
    let c1 = (SSIM_K1 * SSIM_L).powi(2);
    let c2 = (SSIM_K2 * SSIM_L).powi(2);

    let mut total = 0.0f64;
    let mut count = 0usize;

    let max_y = height.saturating_sub(SSIM_WINDOW);
    let max_x = width.saturating_sub(SSIM_WINDOW);

    for y in (0..=max_y).step_by(step) {
        for x in (0..=max_x).step_by(step) {
            let mut mean_x = 0.0f64;
            let mut mean_y = 0.0f64;
            let mut samples = 0usize;

            for wy in 0..SSIM_WINDOW {
                for wx in 0..SSIM_WINDOW {
                    mean_x += original.get_pixel((x + wx) as u32, (y + wy) as u32).0[0] as f64;
                    mean_y += compressed.get_pixel((x + wx) as u32, (y + wy) as u32).0[0] as f64;
                    samples += 1;
                }
            }

            mean_x /= samples as f64;
            mean_y /= samples as f64;

            let mut variance_x = 0.0f64;
            let mut variance_y = 0.0f64;
            let mut covariance = 0.0f64;

            for wy in 0..SSIM_WINDOW {
                for wx in 0..SSIM_WINDOW {
                    let px =
                        original.get_pixel((x + wx) as u32, (y + wy) as u32).0[0] as f64 - mean_x;
                    let py =
                        compressed.get_pixel((x + wx) as u32, (y + wy) as u32).0[0] as f64 - mean_y;
                    variance_x += px * px;
                    variance_y += py * py;
                    covariance += px * py;
                }
            }

            let denom = (samples as f64 - 1.0).max(1.0);
            variance_x /= denom;
            variance_y /= denom;
            covariance /= denom;

            let numerator = (2.0 * mean_x * mean_y + c1) * (2.0 * covariance + c2);
            let denominator =
                (mean_x * mean_x + mean_y * mean_y + c1) * (variance_x + variance_y + c2);
            total += if denominator <= f64::EPSILON {
                1.0
            } else {
                (numerator / denominator).clamp(0.0, 1.0)
            };
            count += 1;
        }
    }

    if count == 0 {
        1.0
    } else {
        total / count as f64
    }
}

fn multi_scale_structural_similarity(original: &GrayImage, compressed: &GrayImage) -> f64 {
    let mut scales = vec![(original.clone(), compressed.clone())];
    let mut current_original = original.clone();
    let mut current_compressed = compressed.clone();

    for _ in 0..3 {
        if current_original.width() < (SSIM_WINDOW as u32 * 2)
            || current_original.height() < (SSIM_WINDOW as u32 * 2)
        {
            break;
        }

        let next_width = (current_original.width() / 2).max(1);
        let next_height = (current_original.height() / 2).max(1);
        current_original = image::imageops::resize(
            &current_original,
            next_width,
            next_height,
            FilterType::Triangle,
        );
        current_compressed = image::imageops::resize(
            &current_compressed,
            next_width,
            next_height,
            FilterType::Triangle,
        );
        scales.push((current_original.clone(), current_compressed.clone()));
    }

    let weights = [0.40, 0.30, 0.20, 0.10];
    let mut weighted_sum = 0.0f64;
    let mut weight_total = 0.0f64;

    for (index, (scale_original, scale_compressed)) in scales.iter().enumerate() {
        let weight = weights.get(index).copied().unwrap_or(0.08);
        weighted_sum += structural_similarity(scale_original, scale_compressed) * weight;
        weight_total += weight;
    }

    if weight_total <= f64::EPSILON {
        1.0
    } else {
        (weighted_sum / weight_total).clamp(0.0, 1.0)
    }
}
