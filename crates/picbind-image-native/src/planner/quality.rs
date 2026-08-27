use std::borrow::Cow;

use image::{DynamicImage, RgbaImage};

use crate::NativeImageError;

const MAX_SAMPLES: usize = 160_000;

#[derive(Clone, Copy, Debug)]
pub(crate) struct QualityMetrics {
    pub(crate) ssim: f64,
    pub(crate) psnr: f64,
    pub(crate) edge_retention: f64,
    pub(crate) alpha_mean_error: f64,
    pub(crate) alpha_p95_error: f64,
}

pub(crate) fn compare(
    source: &DynamicImage,
    candidate: &DynamicImage,
) -> Result<QualityMetrics, NativeImageError> {
    let source: Cow<'_, RgbaImage> = match source.as_rgba8() {
        Some(source) => Cow::Borrowed(source),
        None => Cow::Owned(source.to_rgba8()),
    };
    let candidate: Cow<'_, RgbaImage> = match candidate.as_rgba8() {
        Some(candidate) => Cow::Borrowed(candidate),
        None => Cow::Owned(candidate.to_rgba8()),
    };
    if source.dimensions() != candidate.dimensions() {
        return Err(NativeImageError::EncodeFailed(
            "candidate dimensions differ from the source".into(),
        ));
    }

    let indexes = sample_indexes(source.width(), source.height());
    let source_raw = source.as_raw();
    let candidate_raw = candidate.as_raw();
    let mut source_sum = 0.0;
    let mut candidate_sum = 0.0;
    let mut color_squared_error = 0.0;
    let mut alpha_errors = Vec::with_capacity(indexes.len());

    for &index in &indexes {
        let offset = index * 4;
        let source_luma = luma(&source_raw[offset..offset + 3]);
        let candidate_luma = luma(&candidate_raw[offset..offset + 3]);
        source_sum += source_luma;
        candidate_sum += candidate_luma;
        for channel in 0..3 {
            let difference = f64::from(source_raw[offset + channel])
                - f64::from(candidate_raw[offset + channel]);
            color_squared_error += difference * difference;
        }
        alpha_errors.push(source_raw[offset + 3].abs_diff(candidate_raw[offset + 3]));
    }

    let count = indexes.len().max(1) as f64;
    let source_mean = source_sum / count;
    let candidate_mean = candidate_sum / count;
    let mut source_variance = 0.0;
    let mut candidate_variance = 0.0;
    let mut covariance = 0.0;
    for &index in &indexes {
        let offset = index * 4;
        let source_delta = luma(&source_raw[offset..offset + 3]) - source_mean;
        let candidate_delta = luma(&candidate_raw[offset..offset + 3]) - candidate_mean;
        source_variance += source_delta * source_delta;
        candidate_variance += candidate_delta * candidate_delta;
        covariance += source_delta * candidate_delta;
    }
    source_variance /= count;
    candidate_variance /= count;
    covariance /= count;
    let c1 = (0.01_f64 * 255.0).powi(2);
    let c2 = (0.03_f64 * 255.0).powi(2);
    let ssim = ((2.0 * source_mean * candidate_mean + c1) * (2.0 * covariance + c2)
        / ((source_mean.powi(2) + candidate_mean.powi(2) + c1)
            * (source_variance + candidate_variance + c2)))
        .clamp(0.0, 1.0);
    let mse = color_squared_error / (count * 3.0);
    let psnr = if mse == 0.0 {
        f64::INFINITY
    } else {
        10.0 * (255.0_f64.powi(2) / mse).log10()
    };

    alpha_errors.sort_unstable();
    let alpha_mean_error = alpha_errors
        .iter()
        .map(|value| f64::from(*value))
        .sum::<f64>()
        / count;
    let p95_index = ((alpha_errors.len().saturating_sub(1)) as f64 * 0.95).round() as usize;

    Ok(QualityMetrics {
        ssim,
        psnr,
        edge_retention: edge_retention(source.as_ref(), candidate.as_ref()),
        alpha_mean_error,
        alpha_p95_error: f64::from(alpha_errors[p95_index]),
    })
}

fn sample_indexes(width: u32, height: u32) -> Vec<usize> {
    let pixels = width as usize * height as usize;
    let step = pixels.div_ceil(MAX_SAMPLES).max(1);
    (0..pixels).step_by(step).collect()
}

fn luma(rgb: &[u8]) -> f64 {
    0.2126 * f64::from(rgb[0]) + 0.7152 * f64::from(rgb[1]) + 0.0722 * f64::from(rgb[2])
}

fn edge_retention(source: &RgbaImage, candidate: &RgbaImage) -> f64 {
    if source.width() < 2 || source.height() < 2 {
        return 1.0;
    }
    let pixel_count = source.width() as usize * source.height() as usize;
    let step = pixel_count.div_ceil(MAX_SAMPLES / 2).max(1);
    let mut source_energy = 0.0;
    let mut candidate_energy = 0.0;
    for index in (0..pixel_count).step_by(step) {
        let x = index as u32 % source.width();
        let y = index as u32 / source.width();
        if x + 1 >= source.width() || y + 1 >= source.height() {
            continue;
        }
        source_energy += gradient(source, x, y);
        candidate_energy += gradient(candidate, x, y);
    }
    if source_energy <= f64::EPSILON {
        1.0
    } else {
        (candidate_energy / source_energy).clamp(0.0, 2.0)
    }
}

fn gradient(image: &RgbaImage, x: u32, y: u32) -> f64 {
    let center = luma(&image.get_pixel(x, y).0[..3]);
    let horizontal = luma(&image.get_pixel(x + 1, y).0[..3]);
    let vertical = luma(&image.get_pixel(x, y + 1).0[..3]);
    (horizontal - center).abs() + (vertical - center).abs()
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, RgbaImage};

    use super::compare;

    #[test]
    fn identical_images_have_perfect_metrics() {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(32, 24, |x, y| {
            image::Rgba([(x * 7) as u8, (y * 9) as u8, 120, (x * 5) as u8])
        }));
        let metrics = compare(&image, &image).unwrap();
        assert!((metrics.ssim - 1.0).abs() < f64::EPSILON);
        assert!(metrics.psnr.is_infinite());
        assert!((metrics.edge_retention - 1.0).abs() < f64::EPSILON);
        assert_eq!(metrics.alpha_mean_error, 0.0);
        assert_eq!(metrics.alpha_p95_error, 0.0);
    }
}
