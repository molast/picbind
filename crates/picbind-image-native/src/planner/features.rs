use image::DynamicImage;

const HISTOGRAM_BINS: usize = 16 * 16 * 16;

#[derive(Clone, Debug, PartialEq)]
pub struct NativeImageFeatures {
    pub has_alpha: bool,
    pub color_entropy: f64,
    pub detail_coverage: f64,
    pub flat_coverage: f64,
    pub sample_count: usize,
}

impl NativeImageFeatures {
    pub fn extract(image: &DynamicImage) -> Self {
        let rgba = image.to_rgba8();
        let width = rgba.width();
        let height = rgba.height();
        let stride = (width.max(height) / 320).max(1);
        let mut histogram = [0usize; HISTOGRAM_BINS];
        let mut samples = 0usize;
        let mut detail = 0usize;
        let mut flat = 0usize;

        for y in (0..height).step_by(stride as usize) {
            for x in (0..width).step_by(stride as usize) {
                let pixel = rgba.get_pixel(x, y);
                let bin = ((usize::from(pixel[0]) >> 4) << 8)
                    | ((usize::from(pixel[1]) >> 4) << 4)
                    | (usize::from(pixel[2]) >> 4);
                histogram[bin] += 1;
                let current_luma = luma(pixel.0);
                let mut delta = 0.0_f64;
                let mut neighbors = 0_u8;
                if x + stride < width {
                    delta += (current_luma - luma(rgba.get_pixel(x + stride, y).0)).abs();
                    neighbors += 1;
                }
                if y + stride < height {
                    delta += (current_luma - luma(rgba.get_pixel(x, y + stride).0)).abs();
                    neighbors += 1;
                }
                if neighbors > 0 {
                    let average = delta / f64::from(neighbors);
                    if average >= 20.0 {
                        detail += 1;
                    } else if average <= 6.0 {
                        flat += 1;
                    }
                }
                samples += 1;
            }
        }

        Self {
            has_alpha: rgba.pixels().any(|pixel| pixel[3] < 255),
            color_entropy: normalized_entropy(&histogram, samples),
            detail_coverage: ratio(detail, samples),
            flat_coverage: ratio(flat, samples),
            sample_count: samples,
        }
    }
}

fn luma(pixel: [u8; 4]) -> f64 {
    0.2126 * f64::from(pixel[0]) + 0.7152 * f64::from(pixel[1]) + 0.0722 * f64::from(pixel[2])
}

fn ratio(value: usize, total: usize) -> f64 {
    if total == 0 {
        0.0
    } else {
        value as f64 / total as f64
    }
}

fn normalized_entropy(histogram: &[usize], total: usize) -> f64 {
    if total <= 1 {
        return 0.0;
    }
    let entropy = histogram
        .iter()
        .filter(|count| **count > 0)
        .fold(0.0, |sum, count| {
            let probability = *count as f64 / total as f64;
            sum - probability * probability.log2()
        });
    (entropy / (total.min(HISTOGRAM_BINS) as f64).log2().max(1.0)).clamp(0.0, 1.0)
}
