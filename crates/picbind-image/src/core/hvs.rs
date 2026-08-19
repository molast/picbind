use image::RgbaImage;

const HISTOGRAM_BINS: usize = 512;
const MAX_DELTA_E: f64 = 64.0;
const MAX_LAB_CHANNEL_ERROR: f64 = 48.0;

pub struct HvsMetrics {
    pub mean_delta_e: f64,
    pub p95_delta_e: f64,
    pub p99_delta_e: f64,
    pub p95_masked_delta_e: f64,
    pub p99_masked_delta_e: f64,
    pub p95_luminance_error: f64,
    pub p95_chroma_error: f64,
    pub mean_alpha_error: f64,
    pub p95_alpha_error: f64,
    pub p99_alpha_error: f64,
    pub perceptual_distance: f64,
}

pub fn compare_human_visual_distance(original: &RgbaImage, compressed: &RgbaImage) -> HvsMetrics {
    let width = original.width().min(compressed.width());
    let height = original.height().min(compressed.height());
    if width == 0 || height == 0 {
        return empty_metrics();
    }

    // Around 800 samples across the longest edge keeps the browser-side model fast.
    let stride = (width.max(height) / 800).max(1);
    let mut delta_histogram = Histogram::new(MAX_DELTA_E);
    let mut masked_histogram = Histogram::new(MAX_DELTA_E);
    let mut luminance_histogram = Histogram::new(MAX_LAB_CHANNEL_ERROR);
    let mut chroma_histogram = Histogram::new(MAX_LAB_CHANNEL_ERROR);
    let mut alpha_histogram = Histogram::new(1.0);
    let mut delta_sum = 0.0;
    let mut alpha_sum = 0.0;
    let mut samples = 0usize;

    for y in (0..height).step_by(stride as usize) {
        for x in (0..width).step_by(stride as usize) {
            let source = original.get_pixel(x, y).0;
            let encoded = compressed.get_pixel(x, y).0;
            let light_errors = perceptual_errors_on_background(source, encoded, 255);
            let dark_errors = perceptual_errors_on_background(source, encoded, 0);
            let (delta_e, luminance_error, chroma_error) = if light_errors.0 >= dark_errors.0 {
                light_errors
            } else {
                dark_errors
            };
            let alpha_error = (source[3] as f64 - encoded[3] as f64).abs() / 255.0;

            let local_contrast = local_luminance_contrast(original, x, y, stride);
            let texture_mask = 1.0 + (local_contrast * 7.5).min(2.25);
            let masked_delta_e = delta_e / texture_mask;

            delta_histogram.add(delta_e);
            masked_histogram.add(masked_delta_e);
            luminance_histogram.add(luminance_error);
            chroma_histogram.add(chroma_error);
            alpha_histogram.add(alpha_error);
            delta_sum += delta_e;
            alpha_sum += alpha_error;
            samples += 1;
        }
    }

    let mean_delta_e = if samples == 0 {
        0.0
    } else {
        delta_sum / samples as f64
    };
    let p95_delta_e = delta_histogram.percentile(0.95);
    let p99_delta_e = delta_histogram.percentile(0.99);
    let p95_masked_delta_e = masked_histogram.percentile(0.95);
    let p99_masked_delta_e = masked_histogram.percentile(0.99);
    let p95_luminance_error = luminance_histogram.percentile(0.95);
    let p95_chroma_error = chroma_histogram.percentile(0.95);
    let mean_alpha_error = if samples == 0 {
        0.0
    } else {
        alpha_sum / samples as f64
    };
    let p95_alpha_error = alpha_histogram.percentile(0.95);
    let p99_alpha_error = alpha_histogram.percentile(0.99);

    // Tail errors carry more weight because small local defects are visually obvious.
    let perceptual_distance =
        0.20 * mean_delta_e + 0.50 * p95_masked_delta_e + 0.30 * p99_masked_delta_e;

    HvsMetrics {
        mean_delta_e,
        p95_delta_e,
        p99_delta_e,
        p95_masked_delta_e,
        p99_masked_delta_e,
        p95_luminance_error,
        p95_chroma_error,
        mean_alpha_error,
        p95_alpha_error,
        p99_alpha_error,
        perceptual_distance,
    }
}

fn local_luminance_contrast(image: &RgbaImage, x: u32, y: u32, stride: u32) -> f64 {
    let center = srgb_luminance(composite_rgba(image.get_pixel(x, y).0, 127));
    let right = srgb_luminance(composite_rgba(
        image.get_pixel((x + stride).min(image.width() - 1), y).0,
        127,
    ));
    let bottom = srgb_luminance(composite_rgba(
        image.get_pixel(x, (y + stride).min(image.height() - 1)).0,
        127,
    ));
    ((center - right).abs() + (center - bottom).abs()) * 0.5
}

fn perceptual_errors_on_background(
    source: [u8; 4],
    encoded: [u8; 4],
    background: u8,
) -> (f64, f64, f64) {
    let source_lab = srgb_to_lab(composite_rgba(source, background));
    let encoded_lab = srgb_to_lab(composite_rgba(encoded, background));
    let luminance_error = (source_lab[0] - encoded_lab[0]).abs();
    let chroma_error = ((source_lab[1] - encoded_lab[1]).powi(2)
        + (source_lab[2] - encoded_lab[2]).powi(2))
    .sqrt();
    (
        delta_e_2000(source_lab, encoded_lab),
        luminance_error,
        chroma_error,
    )
}

fn composite_rgba(pixel: [u8; 4], background: u8) -> [u8; 3] {
    let alpha = pixel[3] as u16;
    let inverse = 255 - alpha;
    [
        ((pixel[0] as u16 * alpha + background as u16 * inverse + 127) / 255) as u8,
        ((pixel[1] as u16 * alpha + background as u16 * inverse + 127) / 255) as u8,
        ((pixel[2] as u16 * alpha + background as u16 * inverse + 127) / 255) as u8,
    ]
}

fn srgb_luminance(pixel: [u8; 3]) -> f64 {
    (0.2126 * pixel[0] as f64 + 0.7152 * pixel[1] as f64 + 0.0722 * pixel[2] as f64) / 255.0
}

fn srgb_to_lab(pixel: [u8; 3]) -> [f64; 3] {
    let r = srgb_channel_to_linear(pixel[0]);
    let g = srgb_channel_to_linear(pixel[1]);
    let b = srgb_channel_to_linear(pixel[2]);

    let x = (0.412_456_4 * r + 0.357_576_1 * g + 0.180_437_5 * b) / 0.950_47;
    let y = 0.212_672_9 * r + 0.715_152_2 * g + 0.072_175 * b;
    let z = (0.019_333_9 * r + 0.119_192 * g + 0.950_304_1 * b) / 1.088_83;

    let fx = lab_curve(x);
    let fy = lab_curve(y);
    let fz = lab_curve(z);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn srgb_channel_to_linear(channel: u8) -> f64 {
    let value = channel as f64 / 255.0;
    if value <= 0.040_45 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn lab_curve(value: f64) -> f64 {
    const EPSILON: f64 = 216.0 / 24_389.0;
    const KAPPA: f64 = 24_389.0 / 27.0;
    if value > EPSILON {
        value.cbrt()
    } else {
        (KAPPA * value + 16.0) / 116.0
    }
}

fn delta_e_2000(first: [f64; 3], second: [f64; 3]) -> f64 {
    let [l1, a1, b1] = first;
    let [l2, a2, b2] = second;
    let c1 = (a1 * a1 + b1 * b1).sqrt();
    let c2 = (a2 * a2 + b2 * b2).sqrt();
    let mean_c = (c1 + c2) * 0.5;
    let mean_c_pow7 = mean_c.powi(7);
    let g = 0.5 * (1.0 - (mean_c_pow7 / (mean_c_pow7 + 25.0f64.powi(7))).sqrt());
    let a1_prime = (1.0 + g) * a1;
    let a2_prime = (1.0 + g) * a2;
    let c1_prime = (a1_prime * a1_prime + b1 * b1).sqrt();
    let c2_prime = (a2_prime * a2_prime + b2 * b2).sqrt();
    let h1_prime = hue_angle(a1_prime, b1);
    let h2_prime = hue_angle(a2_prime, b2);

    let delta_l_prime = l2 - l1;
    let delta_c_prime = c2_prime - c1_prime;
    let mut delta_h_angle = h2_prime - h1_prime;
    if c1_prime * c2_prime <= f64::EPSILON {
        delta_h_angle = 0.0;
    } else if delta_h_angle > std::f64::consts::PI {
        delta_h_angle -= std::f64::consts::TAU;
    } else if delta_h_angle < -std::f64::consts::PI {
        delta_h_angle += std::f64::consts::TAU;
    }
    let delta_h_prime = 2.0 * (c1_prime * c2_prime).sqrt() * (delta_h_angle * 0.5).sin();

    let mean_l_prime = (l1 + l2) * 0.5;
    let mean_c_prime = (c1_prime + c2_prime) * 0.5;
    let mean_h_prime = if c1_prime * c2_prime <= f64::EPSILON {
        h1_prime + h2_prime
    } else if (h1_prime - h2_prime).abs() <= std::f64::consts::PI {
        (h1_prime + h2_prime) * 0.5
    } else if h1_prime + h2_prime < std::f64::consts::TAU {
        (h1_prime + h2_prime + std::f64::consts::TAU) * 0.5
    } else {
        (h1_prime + h2_prime - std::f64::consts::TAU) * 0.5
    };

    let t = 1.0 - 0.17 * (mean_h_prime - degrees(30.0)).cos()
        + 0.24 * (2.0 * mean_h_prime).cos()
        + 0.32 * (3.0 * mean_h_prime + degrees(6.0)).cos()
        - 0.20 * (4.0 * mean_h_prime - degrees(63.0)).cos();
    let lightness_offset = mean_l_prime - 50.0;
    let s_l = 1.0
        + 0.015 * lightness_offset * lightness_offset
            / (20.0 + lightness_offset * lightness_offset).sqrt();
    let s_c = 1.0 + 0.045 * mean_c_prime;
    let s_h = 1.0 + 0.015 * mean_c_prime * t;
    let delta_theta = degrees(30.0) * (-((mean_h_prime.to_degrees() - 275.0) / 25.0).powi(2)).exp();
    let mean_c_prime_pow7 = mean_c_prime.powi(7);
    let r_c = 2.0 * (mean_c_prime_pow7 / (mean_c_prime_pow7 + 25.0f64.powi(7))).sqrt();
    let r_t = -r_c * (2.0 * delta_theta).sin();

    let l_term = delta_l_prime / s_l;
    let c_term = delta_c_prime / s_c;
    let h_term = delta_h_prime / s_h;
    (l_term * l_term + c_term * c_term + h_term * h_term + r_t * c_term * h_term)
        .max(0.0)
        .sqrt()
}

fn hue_angle(a: f64, b: f64) -> f64 {
    let angle = b.atan2(a);
    if angle < 0.0 {
        angle + std::f64::consts::TAU
    } else {
        angle
    }
}

fn degrees(value: f64) -> f64 {
    value.to_radians()
}

struct Histogram {
    bins: [u32; HISTOGRAM_BINS],
    max_value: f64,
    count: usize,
}

impl Histogram {
    fn new(max_value: f64) -> Self {
        Self {
            bins: [0; HISTOGRAM_BINS],
            max_value,
            count: 0,
        }
    }

    fn add(&mut self, value: f64) {
        let normalized = (value / self.max_value).clamp(0.0, 1.0);
        let index = (normalized * (HISTOGRAM_BINS - 1) as f64).round() as usize;
        self.bins[index] += 1;
        self.count += 1;
    }

    fn percentile(&self, percentile: f64) -> f64 {
        if self.count == 0 {
            return 0.0;
        }
        let target = (self.count as f64 * percentile.clamp(0.0, 1.0)).ceil() as usize;
        let mut seen = 0usize;
        for (index, count) in self.bins.iter().enumerate() {
            seen += *count as usize;
            if seen >= target {
                return index as f64 / (HISTOGRAM_BINS - 1) as f64 * self.max_value;
            }
        }
        self.max_value
    }
}

fn empty_metrics() -> HvsMetrics {
    HvsMetrics {
        mean_delta_e: 0.0,
        p95_delta_e: 0.0,
        p99_delta_e: 0.0,
        p95_masked_delta_e: 0.0,
        p99_masked_delta_e: 0.0,
        p95_luminance_error: 0.0,
        p95_chroma_error: 0.0,
        mean_alpha_error: 0.0,
        p95_alpha_error: 0.0,
        p99_alpha_error: 0.0,
        perceptual_distance: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use image::{Rgba, RgbaImage};

    use super::compare_human_visual_distance;

    #[test]
    fn identical_images_have_zero_visual_distance() {
        let image = RgbaImage::from_pixel(16, 16, Rgba([80, 120, 160, 255]));
        let metrics = compare_human_visual_distance(&image, &image);
        assert_eq!(metrics.perceptual_distance, 0.0);
        assert_eq!(metrics.p99_delta_e, 0.0);
    }

    #[test]
    fn percentile_model_detects_local_color_damage() {
        let original = RgbaImage::from_pixel(20, 20, Rgba([90, 120, 150, 255]));
        let mut damaged = original.clone();
        for y in 0..5 {
            for x in 0..5 {
                damaged.put_pixel(x, y, Rgba([170, 70, 80, 255]));
            }
        }
        let metrics = compare_human_visual_distance(&original, &damaged);
        assert!(metrics.p99_delta_e > 10.0);
        assert!(metrics.perceptual_distance > 1.0);
    }

    #[test]
    fn ciede2000_matches_reference_pair() {
        let distance = super::delta_e_2000([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485]);
        assert!((distance - 2.0425).abs() < 0.0001);
    }

    #[test]
    fn alpha_damage_is_measured_on_light_and_dark_backgrounds() {
        let original = RgbaImage::from_pixel(20, 20, Rgba([220, 80, 120, 96]));
        let damaged = RgbaImage::from_pixel(20, 20, Rgba([220, 80, 120, 48]));
        let metrics = compare_human_visual_distance(&original, &damaged);
        assert!(metrics.p95_alpha_error > 0.15);
        assert!(metrics.perceptual_distance > 1.0);
    }
}
