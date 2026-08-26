use image::{DynamicImage, GrayImage, RgbaImage, imageops::FilterType};

use crate::NativeImageError;

use super::NativeImageQualityComparison;

pub(super) fn compare(
    source: &DynamicImage,
    assessed: &DynamicImage,
) -> Result<NativeImageQualityComparison, NativeImageError> {
    let width = source.width();
    let height = source.height();
    if width < 3 || height < 3 {
        return Err(NativeImageError::InvalidParameters(
            "image quality comparison requires images at least 3x3 pixels".into(),
        ));
    }
    let source = bounded_metrics_image(source, 1_600);
    let assessed = assessed.resize_exact(source.width(), source.height(), FilterType::Triangle);
    let source_rgba = source.to_rgba8();
    let assessed_rgba = assessed.to_rgba8();
    let source_gray = source.to_luma8();
    let assessed_gray = assessed.to_luma8();
    let mse = mse_rgb(&source_rgba, &assessed_rgba);
    let rmse = mse.sqrt();
    let psnr = if mse <= f64::EPSILON {
        100.0
    } else {
        10.0 * ((255.0 * 255.0) / mse).log10()
    };
    let original_edge_energy = sobel_energy(&source_gray);
    let compressed_edge_energy = sobel_energy(&assessed_gray);
    let edge_retention = ratio(compressed_edge_energy, original_edge_energy);
    let original_laplacian_variance = laplacian_variance(&source_gray);
    let compressed_laplacian_variance = laplacian_variance(&assessed_gray);
    let laplacian_retention = ratio(compressed_laplacian_variance, original_laplacian_variance);
    let ssim = global_ssim(&source_gray, &assessed_gray);
    let ms_ssim = multi_scale_ssim(source_gray.clone(), assessed_gray.clone());
    let blur_loss_percent =
        (1.0 - (0.7 * edge_retention + 0.3 * laplacian_retention)).clamp(0.0, 1.0) * 100.0;
    let perceptual = perceptual_errors(&source_rgba, &assessed_rgba);
    let overall_quality_score = (100.0
        * (0.38 * ssim
            + 0.22 * ms_ssim
            + 0.24 * (1.0 - blur_loss_percent / 100.0)
            + 0.16 * (1.0 - perceptual.perceptual_distance)))
        .clamp(0.0, 100.0);
    Ok(NativeImageQualityComparison {
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
        mean_delta_e: perceptual.mean_delta_e,
        p95_delta_e: perceptual.p95_delta_e,
        p99_delta_e: perceptual.p99_delta_e,
        p95_masked_delta_e: perceptual.p95_masked_delta_e,
        p99_masked_delta_e: perceptual.p99_masked_delta_e,
        p95_luminance_error: perceptual.p95_luminance_error,
        p95_chroma_error: perceptual.p95_chroma_error,
        perceptual_distance: perceptual.perceptual_distance,
        mean_alpha_error: perceptual.mean_alpha_error,
        p95_alpha_error: perceptual.p95_alpha_error,
        p99_alpha_error: perceptual.p99_alpha_error,
    })
}

fn bounded_metrics_image(image: &DynamicImage, max_dimension: u32) -> DynamicImage {
    if image.width().max(image.height()) <= max_dimension {
        image.clone()
    } else {
        image.thumbnail(max_dimension, max_dimension)
    }
}

fn mse_rgb(source: &RgbaImage, assessed: &RgbaImage) -> f64 {
    source
        .pixels()
        .zip(assessed.pixels())
        .flat_map(|(source, assessed)| {
            (0..3).map(move |channel| {
                let delta = f64::from(source[channel]) - f64::from(assessed[channel]);
                delta * delta
            })
        })
        .sum::<f64>()
        / (source.width() as f64 * source.height() as f64 * 3.0)
}

fn ratio(value: f64, base: f64) -> f64 {
    if base <= f64::EPSILON {
        1.0
    } else {
        (value / base).clamp(0.0, 1.0)
    }
}

fn sobel_energy(image: &GrayImage) -> f64 {
    let mut total = 0.0;
    let mut count = 0usize;
    for y in 1..image.height() - 1 {
        for x in 1..image.width() - 1 {
            let pixel = |dx: i32, dy: i32| {
                f64::from(image.get_pixel((x as i32 + dx) as u32, (y as i32 + dy) as u32)[0])
            };
            let gx = -pixel(-1, -1) + pixel(1, -1) - 2.0 * pixel(-1, 0) + 2.0 * pixel(1, 0)
                - pixel(-1, 1)
                + pixel(1, 1);
            let gy = -pixel(-1, -1) - 2.0 * pixel(0, -1) - pixel(1, -1)
                + pixel(-1, 1)
                + 2.0 * pixel(0, 1)
                + pixel(1, 1);
            total += (gx * gx + gy * gy).sqrt();
            count += 1;
        }
    }
    total / count.max(1) as f64
}

fn laplacian_variance(image: &GrayImage) -> f64 {
    let mut values = Vec::with_capacity((image.width() * image.height()) as usize);
    for y in 1..image.height() - 1 {
        for x in 1..image.width() - 1 {
            let center = 4.0 * f64::from(image.get_pixel(x, y)[0]);
            let neighbors = f64::from(image.get_pixel(x - 1, y)[0])
                + f64::from(image.get_pixel(x + 1, y)[0])
                + f64::from(image.get_pixel(x, y - 1)[0])
                + f64::from(image.get_pixel(x, y + 1)[0]);
            values.push(center - neighbors);
        }
    }
    variance(&values)
}

fn global_ssim(source: &GrayImage, assessed: &GrayImage) -> f64 {
    let source = source
        .pixels()
        .map(|pixel| f64::from(pixel[0]))
        .collect::<Vec<_>>();
    let assessed = assessed
        .pixels()
        .map(|pixel| f64::from(pixel[0]))
        .collect::<Vec<_>>();
    let source_mean = mean(&source);
    let assessed_mean = mean(&assessed);
    let source_variance = variance(&source);
    let assessed_variance = variance(&assessed);
    let covariance = source
        .iter()
        .zip(&assessed)
        .map(|(source, assessed)| (source - source_mean) * (assessed - assessed_mean))
        .sum::<f64>()
        / source.len().max(1) as f64;
    let c1 = (0.01_f64 * 255.0).powi(2);
    let c2 = (0.03_f64 * 255.0).powi(2);
    (((2.0 * source_mean * assessed_mean + c1) * (2.0 * covariance + c2))
        / ((source_mean.powi(2) + assessed_mean.powi(2) + c1)
            * (source_variance + assessed_variance + c2)))
        .clamp(0.0, 1.0)
}

fn multi_scale_ssim(mut source: GrayImage, mut assessed: GrayImage) -> f64 {
    let mut weighted = 0.0;
    let mut weight_sum = 0.0;
    for weight in [0.5, 0.3, 0.2] {
        weighted += global_ssim(&source, &assessed) * weight;
        weight_sum += weight;
        if source.width() < 6 || source.height() < 6 {
            break;
        }
        let width = (source.width() / 2).max(3);
        let height = (source.height() / 2).max(3);
        source = image::imageops::resize(&source, width, height, FilterType::Triangle);
        assessed = image::imageops::resize(&assessed, width, height, FilterType::Triangle);
    }
    weighted / weight_sum
}

struct PerceptualErrors {
    mean_delta_e: f64,
    p95_delta_e: f64,
    p99_delta_e: f64,
    p95_masked_delta_e: f64,
    p99_masked_delta_e: f64,
    p95_luminance_error: f64,
    p95_chroma_error: f64,
    perceptual_distance: f64,
    mean_alpha_error: f64,
    p95_alpha_error: f64,
    p99_alpha_error: f64,
}

fn perceptual_errors(source: &RgbaImage, assessed: &RgbaImage) -> PerceptualErrors {
    let mut delta_e = Vec::with_capacity(source.len() / 4);
    let mut masked_delta_e = Vec::new();
    let mut luminance = Vec::with_capacity(source.len() / 4);
    let mut chroma = Vec::with_capacity(source.len() / 4);
    let mut alpha = Vec::with_capacity(source.len() / 4);
    for (source, assessed) in source.pixels().zip(assessed.pixels()) {
        let source_lab = rgb_to_lab(source[0], source[1], source[2]);
        let assessed_lab = rgb_to_lab(assessed[0], assessed[1], assessed[2]);
        let lightness = (source_lab[0] - assessed_lab[0]).abs();
        let chroma_error = ((source_lab[1] - assessed_lab[1]).powi(2)
            + (source_lab[2] - assessed_lab[2]).powi(2))
        .sqrt();
        let difference = (lightness.powi(2) + chroma_error.powi(2)).sqrt();
        delta_e.push(difference);
        if source[3] > 16 || assessed[3] > 16 {
            masked_delta_e.push(difference);
        }
        luminance.push(lightness);
        chroma.push(chroma_error);
        alpha.push((f64::from(source[3]) - f64::from(assessed[3])).abs() / 255.0);
    }
    sort_finite(&mut delta_e);
    sort_finite(&mut masked_delta_e);
    sort_finite(&mut luminance);
    sort_finite(&mut chroma);
    sort_finite(&mut alpha);
    let mean_delta_e = mean(&delta_e);
    let p95_delta_e = percentile(&delta_e, 0.95);
    let mean_alpha_error = mean(&alpha);
    PerceptualErrors {
        mean_delta_e,
        p95_delta_e,
        p99_delta_e: percentile(&delta_e, 0.99),
        p95_masked_delta_e: percentile(&masked_delta_e, 0.95),
        p99_masked_delta_e: percentile(&masked_delta_e, 0.99),
        p95_luminance_error: percentile(&luminance, 0.95),
        p95_chroma_error: percentile(&chroma, 0.95),
        perceptual_distance: (0.55 * mean_delta_e / 100.0
            + 0.35 * p95_delta_e / 100.0
            + 0.10 * mean_alpha_error)
            .clamp(0.0, 1.0),
        mean_alpha_error,
        p95_alpha_error: percentile(&alpha, 0.95),
        p99_alpha_error: percentile(&alpha, 0.99),
    }
}

fn rgb_to_lab(red: u8, green: u8, blue: u8) -> [f64; 3] {
    let linear = |value: u8| {
        let value = f64::from(value) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    let red = linear(red);
    let green = linear(green);
    let blue = linear(blue);
    let x = (0.412_456_4 * red + 0.357_576_1 * green + 0.180_437_5 * blue) / 0.95047;
    let y = 0.212_672_9 * red + 0.715_152_2 * green + 0.072_175 * blue;
    let z = (0.019_333_9 * red + 0.119_192 * green + 0.950_304_1 * blue) / 1.08883;
    let convert = |value: f64| {
        if value > 0.008_856 {
            value.cbrt()
        } else {
            7.787 * value + 16.0 / 116.0
        }
    };
    let x = convert(x);
    let y = convert(y);
    let z = convert(z);
    [116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z)]
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len().max(1) as f64
}

fn variance(values: &[f64]) -> f64 {
    let mean = mean(values);
    values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / values.len().max(1) as f64
}

fn sort_finite(values: &mut [f64]) {
    values.sort_by(|left, right| left.total_cmp(right));
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values[((values.len() - 1) as f64 * percentile).round() as usize]
}
