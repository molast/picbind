use image::DynamicImage;

use crate::NativeImageFormat;

use super::NativeImageAnalysis;

const HISTOGRAM_BINS: usize = 16 * 16 * 16;

pub(super) fn analyze(
    image: &DynamicImage,
    source_size_bytes: usize,
    format: NativeImageFormat,
) -> NativeImageAnalysis {
    let width = image.width();
    let height = image.height();
    let pixel_count = width as usize * height as usize;
    let sample_stride = width.max(height).div_ceil(1_600).max(1) as usize;
    let rgba = image.thumbnail(1_600, 1_600).to_rgba8();
    let mut histogram = [0usize; HISTOGRAM_BINS];
    let mut luminance = Vec::new();
    let mut alpha_min = u8::MAX;
    let mut alpha_max = 0u8;
    let mut transparent = 0usize;
    let mut semi_transparent = 0usize;
    let mut non_opaque = 0usize;
    let mut edge_total = 0.0;
    let mut edge_count = 0usize;
    let mut gradient = 0usize;
    let mut detail = 0usize;
    let mut flat = 0usize;

    for y in 0..rgba.height() {
        for x in 0..rgba.width() {
            let pixel = rgba.get_pixel(x, y).0;
            let alpha = pixel[3];
            alpha_min = alpha_min.min(alpha);
            alpha_max = alpha_max.max(alpha);
            non_opaque += usize::from(alpha < 255);
            transparent += usize::from(alpha == 0);
            semi_transparent += usize::from(alpha > 0 && alpha < 255);
            let bin = (usize::from(pixel[0] >> 4) << 8)
                | (usize::from(pixel[1] >> 4) << 4)
                | usize::from(pixel[2] >> 4);
            histogram[bin] += 1;
            let value = luma(pixel[0], pixel[1], pixel[2]);
            luminance.push(value);
            if x + 1 < rgba.width() && y + 1 < rgba.height() {
                let right = rgba.get_pixel(x + 1, y).0;
                let below = rgba.get_pixel(x, y + 1).0;
                let edge = ((value - luma(right[0], right[1], right[2])).abs()
                    + (value - luma(below[0], below[1], below[2])).abs())
                    / 2.0;
                edge_total += edge;
                edge_count += 1;
                if edge < 0.025 {
                    flat += 1;
                } else if edge < 0.12 {
                    gradient += 1;
                } else {
                    detail += 1;
                }
            }
        }
    }
    let sample_count = luminance.len().max(1);
    let mean = luminance.iter().sum::<f64>() / sample_count as f64;
    let brightness_variance = luminance
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / sample_count as f64;
    let occupied = histogram.iter().filter(|count| **count > 0).count();
    let color_complexity = occupied as f64 / sample_count.min(HISTOGRAM_BINS) as f64;
    let color_entropy = histogram
        .iter()
        .filter(|count| **count > 0)
        .map(|count| {
            let probability = *count as f64 / sample_count as f64;
            -probability * probability.log2()
        })
        .sum::<f64>()
        / 12.0;
    let edge_strength = edge_total / edge_count.max(1) as f64;
    let classified = (flat + gradient + detail).max(1) as f64;
    let flat_coverage = flat as f64 / classified;
    let gradient_coverage = gradient as f64 / classified;
    let detail_coverage = detail as f64 / classified;
    let noise_level = local_noise(&luminance).clamp(0.0, 1.0);
    let alpha_ratio = non_opaque as f64 / sample_count as f64;
    let complexity_score = (0.24 * edge_strength
        + 0.14 * brightness_variance
        + 0.12 * color_complexity
        + 0.16 * color_entropy
        + 0.15 * detail_coverage
        + 0.13 * noise_level
        + 0.06 * gradient_coverage
        - 0.12 * flat_coverage)
        .clamp(0.0, 1.0);
    let source_size_mb = source_size_bytes as f64 / (1024.0 * 1024.0);
    let compressibility_score = (0.30 * flat_coverage
        + 0.10 * gradient_coverage
        + 0.20 * (1.0 - complexity_score)
        + 0.14 * (1.0 - detail_coverage)
        + 0.08 * (1.0 - color_entropy)
        + 0.10 * (1.0 - alpha_ratio)
        + 0.08 * (source_size_mb / 4.0).clamp(0.0, 1.0))
    .clamp(0.0, 1.0);
    NativeImageAnalysis {
        width,
        height,
        pixel_count,
        source_size_bytes,
        source_size_mb,
        source_format: match format {
            NativeImageFormat::Jpeg => "jpeg",
            NativeImageFormat::JpegXl => "jxl",
            NativeImageFormat::Png => "png",
            NativeImageFormat::WebP => "webp",
            NativeImageFormat::Avif => "avif",
        }
        .to_string(),
        has_alpha: non_opaque > 0,
        has_alpha_channel: image.color().has_alpha(),
        has_real_alpha: non_opaque > 0,
        alpha_min: if luminance.is_empty() { 255 } else { alpha_min },
        alpha_max: if luminance.is_empty() { 255 } else { alpha_max },
        alpha_ratio,
        transparent_pixel_ratio: transparent as f64 / sample_count as f64,
        semi_transparent_ratio: semi_transparent as f64 / sample_count as f64,
        sample_stride,
        sample_count: luminance.len(),
        edge_strength,
        brightness_variance,
        color_complexity,
        color_entropy: color_entropy.clamp(0.0, 1.0),
        noise_level,
        gradient_coverage,
        detail_coverage,
        flat_coverage,
        complexity_score,
        compressibility_score,
    }
}

fn luma(red: u8, green: u8, blue: u8) -> f64 {
    (0.2126 * f64::from(red) + 0.7152 * f64::from(green) + 0.0722 * f64::from(blue)) / 255.0
}

fn local_noise(values: &[f64]) -> f64 {
    if values.len() < 3 {
        return 0.0;
    }
    values
        .windows(3)
        .map(|window| (window[1] - (window[0] + window[2]) / 2.0).abs())
        .sum::<f64>()
        / (values.len() - 2) as f64
}
