use image::DynamicImage;

pub struct AlphaFeature {
    pub has_alpha_channel: bool,
    pub has_real_alpha: bool,
    pub alpha_min: u8,
    pub alpha_max: u8,
    pub transparent_pixel_ratio: f64,
    pub semi_transparent_ratio: f64,
    pub non_opaque_pixel_ratio: f64,
}

pub struct ImageFeature {
    pub width: u32,
    pub height: u32,
    pub pixel_count: usize,
    pub source_size_bytes: usize,
    pub source_size_mb: f64,
    pub source_format: String,
    pub alpha: AlphaFeature,
    pub sample_stride: usize,
    pub sample_count: usize,
    pub edge_strength: f64,
    pub brightness_variance: f64,
    pub color_complexity: f64,
    pub detail_coverage: f64,
    pub flat_coverage: f64,
}

pub fn has_real_alpha(pixels: &[u8]) -> bool {
    pixels.iter().skip(3).step_by(4).any(|alpha| *alpha < 255)
}

pub fn extract_dynamic_image_features(
    img: &DynamicImage,
    source_size_bytes: usize,
    source_format: &str,
) -> ImageFeature {
    let has_alpha_channel = img.color().has_alpha();
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let pixel_count = (width as usize) * (height as usize);
    let source_size_mb = source_size_bytes as f64 / (1024.0 * 1024.0);
    let stride = ((width.max(height) / 320).max(1)) as usize;
    let has_real_alpha = has_alpha_channel && has_real_alpha(rgba.as_raw());

    let mut alpha_min = 255u8;
    let mut alpha_max = 255u8;
    let mut transparent_pixels = 0usize;
    let mut semi_transparent_pixels = 0usize;
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

    if has_real_alpha {
        alpha_min = u8::MAX;
        alpha_max = u8::MIN;
        for alpha in rgba.as_raw().iter().skip(3).step_by(4) {
            alpha_min = alpha_min.min(*alpha);
            alpha_max = alpha_max.max(*alpha);
            if *alpha == 0 {
                transparent_pixels += 1;
            } else if *alpha < 255 {
                semi_transparent_pixels += 1;
            }
        }
    }

    for y in (0..height as usize).step_by(stride) {
        for x in (0..width as usize).step_by(stride) {
            let current = rgba.get_pixel(x as u32, y as u32).0;
            let luma = to_luma(current[0], current[1], current[2]);
            luminance_sum += luma;
            luminance_sq_sum += luma * luma;
            let local_color = ((current[0] as f64 - current[1] as f64).abs()
                + (current[1] as f64 - current[2] as f64).abs()
                + (current[0] as f64 - current[2] as f64).abs())
                / 3.0;
            color_sum += local_color;

            let mut local_edge = 0.0f64;
            if x + stride < width as usize {
                let right = rgba.get_pixel((x + stride) as u32, y as u32).0;
                let delta = (luma - to_luma(right[0], right[1], right[2])).abs();
                edge_sum += delta;
                local_edge += delta;
            }
            if y + stride < height as usize {
                let bottom = rgba.get_pixel(x as u32, (y + stride) as u32).0;
                let delta = (luma - to_luma(bottom[0], bottom[1], bottom[2])).abs();
                edge_sum += delta;
                local_edge += delta;
            }

            if local_edge >= 22.0 || (local_edge >= 14.0 && local_color >= 18.0) {
                detail_samples += 1;
            } else if local_edge <= 6.0 && local_color <= 10.0 {
                flat_samples += 1;
            }
            sample_count += 1;
        }
    }

    if has_alpha_channel && pixel_count == 0 {
        alpha_min = 255;
        alpha_max = 255;
    }
    let ratio = |count: usize| {
        if pixel_count == 0 {
            0.0
        } else {
            count as f64 / pixel_count as f64
        }
    };
    let transparent_pixel_ratio = ratio(transparent_pixels);
    let semi_transparent_ratio = ratio(semi_transparent_pixels);
    let non_opaque_pixel_ratio = transparent_pixel_ratio + semi_transparent_ratio;
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
    let normalized_sample = |value: f64, divisor: f64| {
        if sample_count == 0 {
            0.0
        } else {
            (value / sample_count as f64 / divisor).clamp(0.0, 1.0)
        }
    };

    ImageFeature {
        width,
        height,
        pixel_count,
        source_size_bytes,
        source_size_mb,
        source_format: source_format.to_string(),
        alpha: AlphaFeature {
            has_alpha_channel,
            has_real_alpha,
            alpha_min,
            alpha_max,
            transparent_pixel_ratio,
            semi_transparent_ratio,
            non_opaque_pixel_ratio,
        },
        sample_stride: stride,
        sample_count,
        edge_strength: normalized_sample(edge_sum, 48.0),
        brightness_variance: (variance.max(0.0).sqrt() / 64.0).clamp(0.0, 1.0),
        color_complexity: normalized_sample(color_sum, 48.0),
        detail_coverage: ratio_with_denominator(detail_samples, sample_count),
        flat_coverage: if width < 2 || height < 2 {
            1.0
        } else {
            ratio_with_denominator(flat_samples, sample_count)
        },
    }
}

fn ratio_with_denominator(value: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        (value as f64 / denominator as f64).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, RgbImage, Rgba, RgbaImage};

    use super::{extract_dynamic_image_features, has_real_alpha};

    #[test]
    fn real_alpha_detection_exits_on_non_opaque_value() {
        assert!(!has_real_alpha(&[10, 20, 30, 255, 40, 50, 60, 255]));
        assert!(has_real_alpha(&[10, 20, 30, 255, 40, 50, 60, 128]));
    }

    #[test]
    fn opaque_rgb_has_no_alpha_channel() {
        let image = DynamicImage::ImageRgb8(RgbImage::new(2, 2));
        let feature = extract_dynamic_image_features(&image, 12, "jpeg");

        assert!(!feature.alpha.has_alpha_channel);
        assert!(!feature.alpha.has_real_alpha);
        assert_eq!(feature.alpha.alpha_min, 255);
        assert_eq!(feature.alpha.alpha_max, 255);
        assert_eq!(feature.alpha.non_opaque_pixel_ratio, 0.0);
    }

    #[test]
    fn rgba_alpha_distribution_is_measured_exactly() {
        let mut pixels = RgbaImage::new(2, 2);
        pixels.put_pixel(0, 0, Rgba([0, 0, 0, 255]));
        pixels.put_pixel(1, 0, Rgba([0, 0, 0, 0]));
        pixels.put_pixel(0, 1, Rgba([0, 0, 0, 128]));
        pixels.put_pixel(1, 1, Rgba([0, 0, 0, 64]));
        let image = DynamicImage::ImageRgba8(pixels);
        let feature = extract_dynamic_image_features(&image, 16, "png");

        assert!(feature.alpha.has_alpha_channel);
        assert!(feature.alpha.has_real_alpha);
        assert_eq!(feature.alpha.alpha_min, 0);
        assert_eq!(feature.alpha.alpha_max, 255);
        assert_eq!(feature.alpha.transparent_pixel_ratio, 0.25);
        assert_eq!(feature.alpha.semi_transparent_ratio, 0.5);
        assert_eq!(feature.alpha.non_opaque_pixel_ratio, 0.75);
    }
}
