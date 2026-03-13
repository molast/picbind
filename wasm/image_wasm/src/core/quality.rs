use image::DynamicImage;
use ravif::BitDepth as RavifBitDepth;

const PNG_TO_JPEG_MIN_QUALITY_FLOOR: u8 = 80;

pub fn quality_candidates(quality: u8) -> [u8; 5] {
    [
        quality,
        quality.saturating_sub(5),
        quality.saturating_sub(10),
        quality.saturating_sub(20),
        quality.saturating_sub(30),
    ]
}

pub fn png_to_jpeg_quality_candidates(
    img: &DynamicImage,
    requested_quality: u8,
    source_size_bytes: usize,
) -> Vec<u8> {
    let rgb = img.to_rgb8();
    let (width, height) = rgb.dimensions();
    let pixel_count = (width as usize) * (height as usize);
    if width < 2 || height < 2 {
        return vec![requested_quality.max(95), requested_quality.max(93)];
    }

    // Sample the image on a coarse grid to estimate how much detail and color variation it contains.
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

    if sample_count == 0 {
        return vec![requested_quality.max(95), requested_quality.max(93)];
    }

    let mean_luma = luminance_sum / sample_count as f64;
    let variance = (luminance_sq_sum / sample_count as f64) - mean_luma * mean_luma;
    let normalized_variance = (variance.sqrt() / 64.0).clamp(0.0, 1.0);
    let normalized_edge = (edge_sum / sample_count as f64 / 48.0).clamp(0.0, 1.0);
    let normalized_color = (color_sum / sample_count as f64 / 48.0).clamp(0.0, 1.0);
    let detail_coverage = (detail_samples as f64 / sample_count as f64).clamp(0.0, 1.0);
    let flat_coverage = (flat_samples as f64 / sample_count as f64).clamp(0.0, 1.0);

    // Averages alone overrate scenes with a few sharp regions plus large smooth areas.
    // Coverage makes us more tolerant of images like landscape + sky/water, and more
    // conservative on images where detailed structures occupy a larger share of the frame.
    let complexity = (0.32 * normalized_edge
        + 0.22 * normalized_variance
        + 0.16 * normalized_color
        + 0.22 * detail_coverage
        - 0.14 * flat_coverage)
        .clamp(0.0, 1.0);

    let base = requested_quality.max(91);
    let adaptive = if complexity >= 0.58 {
        base.saturating_add(3).min(97)
    } else if complexity >= 0.42 {
        base.saturating_add(1).min(96)
    } else if complexity >= 0.24 {
        base
    } else {
        base.saturating_sub(1).max(92)
    };

    let source_size_mb = source_size_bytes as f64 / (1024.0 * 1024.0);
    let size_stage = if source_size_mb < 1.0 {
        0
    } else {
        (((source_size_mb - 1.0) / 0.5).floor() as u8).saturating_add(1)
    };
    let large_image_bias = match size_stage {
        0 => {
            if pixel_count >= 7_000_000 {
                2
            } else if pixel_count >= 4_000_000 {
                1
            } else {
                0
            }
        }
        1 => 1,
        2 => 2,
        3 => 4,
        4 => 6,
        5 => 9,
        _ => 12,
    };
    let min_quality = match size_stage {
        0 | 1 => 86,
        2 | 3 => 84,
        4 | 5 => 82,
        _ => PNG_TO_JPEG_MIN_QUALITY_FLOOR,
    }
    .max(PNG_TO_JPEG_MIN_QUALITY_FLOOR);
    let adaptive = adaptive
        .saturating_sub(large_image_bias)
        .max(PNG_TO_JPEG_MIN_QUALITY_FLOOR)
        .max(min_quality)
        .saturating_add(2)
        .min(98);

    let mut candidates = vec![
        adaptive,
        adaptive.saturating_sub(1),
        adaptive.saturating_sub(2),
        adaptive.saturating_sub(3),
    ];
    candidates.retain(|quality| *quality >= PNG_TO_JPEG_MIN_QUALITY_FLOOR);
    candidates.sort_unstable();
    candidates.dedup();
    candidates.reverse();
    candidates
}

pub fn avif_speed_for_pixels(pixel_count: usize) -> u8 {
    if pixel_count <= 900_000 {
        5
    } else if pixel_count <= 2_500_000 {
        6
    } else if pixel_count <= 5_000_000 {
        7
    } else {
        8
    }
}

pub fn avif_quality_candidates(quality: u8, pixel_count: usize) -> Vec<u8> {
    // AVIF at the same "quality" number is often visually stronger than JPEG/WebP.
    // Slightly lowering target quality tends to improve byte size while keeping acceptable output.
    let base = quality.clamp(1, 100).saturating_sub(10).clamp(24, 92);
    let mut candidates = vec![base];

    if pixel_count <= 3_000_000 {
        candidates.push(base.saturating_sub(8).clamp(20, 88));
    }
    if pixel_count <= 1_200_000 {
        candidates.push(base.saturating_sub(14).clamp(18, 84));
    }

    candidates.sort_unstable();
    candidates.dedup();
    candidates
}

pub fn avif_bit_depth_for_pixels(_pixel_count: usize) -> RavifBitDepth {
    RavifBitDepth::Auto
}
