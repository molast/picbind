use image::DynamicImage;

const COLOR_HISTOGRAM_BINS: usize = 16 * 16 * 16;

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
    pub color_entropy: f64,
    pub noise_level: f64,
    pub gradient_coverage: f64,
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
    let mut noise_sum = 0.0f64;
    let mut color_histogram = [0usize; COLOR_HISTOGRAM_BINS];
    let mut noise_samples = 0usize;
    let mut gradient_samples = 0usize;
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
            let color_bin = ((current[0] as usize >> 4) << 8)
                | ((current[1] as usize >> 4) << 4)
                | (current[2] as usize >> 4);
            color_histogram[color_bin] += 1;

            let mut local_edge = 0.0f64;
            let mut neighbor_deltas = [0.0f64; 4];
            let mut neighbor_luma_sum = 0.0f64;
            let mut neighbor_count = 0usize;
            let mut add_neighbor = |neighbor_luma: f64| {
                let delta = (luma - neighbor_luma).abs();
                neighbor_deltas[neighbor_count] = delta;
                neighbor_luma_sum += neighbor_luma;
                neighbor_count += 1;
                delta
            };
            if x + stride < width as usize {
                let right = rgba.get_pixel((x + stride) as u32, y as u32).0;
                let delta = add_neighbor(to_luma(right[0], right[1], right[2]));
                edge_sum += delta;
                local_edge += delta;
            }
            if y + stride < height as usize {
                let bottom = rgba.get_pixel(x as u32, (y + stride) as u32).0;
                let delta = add_neighbor(to_luma(bottom[0], bottom[1], bottom[2]));
                edge_sum += delta;
                local_edge += delta;
            }
            if x >= stride {
                let left = rgba.get_pixel((x - stride) as u32, y as u32).0;
                add_neighbor(to_luma(left[0], left[1], left[2]));
            }
            if y >= stride {
                let top = rgba.get_pixel(x as u32, (y - stride) as u32).0;
                add_neighbor(to_luma(top[0], top[1], top[2]));
            }

            if neighbor_count >= 2 {
                let neighbor_mean = neighbor_luma_sum / neighbor_count as f64;
                let residual = (luma - neighbor_mean).abs();
                let mean_delta =
                    neighbor_deltas[..neighbor_count].iter().sum::<f64>() / neighbor_count as f64;
                let delta_spread = neighbor_deltas[..neighbor_count]
                    .iter()
                    .fold(0.0f64, |maximum, delta| maximum.max(*delta))
                    - neighbor_deltas[..neighbor_count]
                        .iter()
                        .fold(f64::MAX, |minimum, delta| minimum.min(*delta));

                // Smooth, coherent luminance changes are gradients. The residual
                // removes hard edges while the spread rejects irregular texture.
                if (0.75..=18.0).contains(&mean_delta) && residual <= 4.0 && delta_spread <= 10.0 {
                    gradient_samples += 1;
                }

                // Subtract the predictable part of the local gradient so that
                // sharp edges are not automatically classified as image noise.
                noise_sum += (residual - mean_delta * 0.35).max(0.0);
                noise_samples += 1;
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
    let color_entropy = normalized_entropy(&color_histogram, sample_count);

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
        color_entropy,
        noise_level: if noise_samples == 0 {
            0.0
        } else {
            (noise_sum / noise_samples as f64 / 24.0).clamp(0.0, 1.0)
        },
        gradient_coverage: ratio_with_denominator(gradient_samples, noise_samples),
        detail_coverage: ratio_with_denominator(detail_samples, sample_count),
        flat_coverage: if width < 2 || height < 2 {
            1.0
        } else {
            ratio_with_denominator(flat_samples, sample_count)
        },
    }
}

fn normalized_entropy(histogram: &[usize], sample_count: usize) -> f64 {
    if sample_count <= 1 {
        return 0.0;
    }
    let entropy = histogram
        .iter()
        .filter(|count| **count > 0)
        .map(|count| {
            let probability = *count as f64 / sample_count as f64;
            -probability * probability.log2()
        })
        .sum::<f64>();
    let maximum = (sample_count.min(histogram.len()) as f64).log2();
    if maximum == 0.0 {
        0.0
    } else {
        (entropy / maximum).clamp(0.0, 1.0)
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

    #[test]
    fn entropy_gradient_and_noise_are_distinguished() {
        let solid = DynamicImage::ImageRgb8(RgbImage::from_pixel(64, 64, image::Rgb([80, 80, 80])));
        let mut gradient = RgbImage::new(64, 64);
        let mut checker = RgbImage::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let value = (x * 4) as u8;
                gradient.put_pixel(x, y, image::Rgb([value, value, value]));
                let noise = if (x + y) % 2 == 0 { 0 } else { 255 };
                checker.put_pixel(x, y, image::Rgb([noise, noise, noise]));
            }
        }

        let solid = extract_dynamic_image_features(&solid, 1024, "png");
        let gradient =
            extract_dynamic_image_features(&DynamicImage::ImageRgb8(gradient), 1024, "png");
        let checker =
            extract_dynamic_image_features(&DynamicImage::ImageRgb8(checker), 1024, "png");

        assert_eq!(solid.color_entropy, 0.0);
        assert!(gradient.color_entropy > solid.color_entropy);
        assert!(gradient.gradient_coverage > 0.5);
        assert!(checker.noise_level > gradient.noise_level);
    }
}
