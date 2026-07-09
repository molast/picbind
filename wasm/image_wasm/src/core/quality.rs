use image::DynamicImage;
use ravif::BitDepth as RavifBitDepth;

use super::analysis::analyze_dynamic_image;

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
    let analysis = analyze_dynamic_image(img, source_size_bytes, "png");
    let width = analysis.width;
    let height = analysis.height;
    let pixel_count = analysis.pixel_count;
    if width < 2 || height < 2 {
        return vec![requested_quality.max(95), requested_quality.max(93)];
    }
    let complexity = analysis.complexity_score;
    let source_size_mb = analysis.source_size_mb;
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

    let base = requested_quality.max(91) as i32;
    let mut adaptive = base;

    adaptive += match () {
        _ if analysis.detail_coverage >= 0.34 => 4,
        _ if analysis.detail_coverage >= 0.24 => 2,
        _ if analysis.detail_coverage >= 0.16 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.edge_strength >= 0.42 => 2,
        _ if analysis.edge_strength >= 0.30 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.color_complexity >= 0.34 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if complexity >= 0.62 => 2,
        _ if complexity >= 0.48 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.alpha_ratio >= 0.08 => 2,
        _ if analysis.alpha_ratio >= 0.02 => 1,
        _ => 0,
    };

    adaptive -= match () {
        _ if analysis.flat_coverage >= 0.52 => 4,
        _ if analysis.flat_coverage >= 0.38 => 2,
        _ if analysis.flat_coverage >= 0.24 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.compressibility_score >= 0.72 => 4,
        _ if analysis.compressibility_score >= 0.58 => 2,
        _ if analysis.compressibility_score >= 0.44 => 1,
        _ => 0,
    };
    adaptive -= large_image_bias as i32;
    adaptive -= match () {
        _ if pixel_count >= 8_000_000 => 2,
        _ if pixel_count >= 5_000_000 => 1,
        _ => 0,
    };

    let adaptive = adaptive
        .clamp(PNG_TO_JPEG_MIN_QUALITY_FLOOR as i32, 98)
        .max(min_quality as i32) as u8;

    let mut candidates = vec![
        adaptive,
        adaptive.saturating_sub(1),
        adaptive.saturating_sub(2),
        adaptive.saturating_sub(3),
        adaptive.saturating_sub(5),
    ];
    candidates.retain(|quality| *quality >= PNG_TO_JPEG_MIN_QUALITY_FLOOR);
    candidates.sort_unstable();
    candidates.dedup();
    candidates.reverse();
    candidates
}

pub fn jpeg_to_jpeg_quality_candidates(
    img: &DynamicImage,
    requested_quality: u8,
    source_size_bytes: usize,
) -> Vec<u8> {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "jpeg");
    let (width, height) = (analysis.width, analysis.height);
    if width < 2 || height < 2 {
        return vec![requested_quality.max(92), requested_quality.max(90)];
    }

    let base = requested_quality.max(84) as i32;
    let mut adaptive = base;

    adaptive += match () {
        _ if analysis.detail_coverage >= 0.30 => 3,
        _ if analysis.detail_coverage >= 0.20 => 2,
        _ if analysis.detail_coverage >= 0.12 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.edge_strength >= 0.40 => 1,
        _ if analysis.edge_strength >= 0.28 => 1,
        _ => 0,
    };
    adaptive += match () {
        _ if analysis.complexity_score >= 0.60 => 1,
        _ if analysis.complexity_score >= 0.46 => 1,
        _ => 0,
    };

    adaptive -= match () {
        _ if analysis.flat_coverage >= 0.52 => 4,
        _ if analysis.flat_coverage >= 0.40 => 3,
        _ if analysis.flat_coverage >= 0.28 => 2,
        _ if analysis.flat_coverage >= 0.18 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.source_size_mb >= 3.0 => 5,
        _ if analysis.source_size_mb >= 2.5 => 4,
        _ if analysis.source_size_mb >= 2.0 => 3,
        _ if analysis.source_size_mb >= 1.5 => 2,
        _ if analysis.source_size_mb >= 1.0 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.compressibility_score >= 0.72 => 5,
        _ if analysis.compressibility_score >= 0.60 => 3,
        _ if analysis.compressibility_score >= 0.48 => 2,
        _ if analysis.compressibility_score >= 0.36 => 1,
        _ => 0,
    };
    adaptive -= match () {
        _ if analysis.pixel_count >= 8_000_000 => 2,
        _ if analysis.pixel_count >= 4_000_000 => 1,
        _ => 0,
    };

    let adaptive = adaptive.clamp(78, 94) as u8;
    let mut candidates = vec![
        adaptive,
        adaptive.saturating_sub(1),
        adaptive.saturating_sub(3),
        adaptive.saturating_sub(5),
        adaptive.saturating_sub(7),
        adaptive.saturating_sub(9),
        adaptive.saturating_sub(12),
        adaptive.saturating_sub(15),
        adaptive.saturating_sub(18),
        adaptive.saturating_sub(22),
        adaptive.saturating_sub(26),
    ];
    candidates.retain(|quality| *quality >= 60);
    candidates.sort_unstable();
    candidates.dedup();
    candidates.reverse();
    candidates
}

pub fn jpeg_to_jpeg_quality_thresholds(img: &DynamicImage, source_size_bytes: usize) -> (f64, f64) {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "jpeg");
    let min_ms_ssim = if analysis.detail_coverage >= 0.30 || analysis.edge_strength >= 0.38 {
        0.982
    } else if analysis.flat_coverage >= 0.44 || analysis.compressibility_score >= 0.62 {
        0.966
    } else {
        0.972
    };

    let max_blur_loss_percent = if analysis.detail_coverage >= 0.30 {
        5.5
    } else if analysis.flat_coverage >= 0.44 || analysis.compressibility_score >= 0.62 {
        9.0
    } else {
        7.0
    };

    (min_ms_ssim, max_blur_loss_percent)
}

pub fn jpeg_to_jpeg_rescue_qualities(
    img: &DynamicImage,
    source_size_bytes: usize,
    min_candidate_quality: u8,
) -> Vec<u8> {
    let analysis = analyze_dynamic_image(img, source_size_bytes, "jpeg");
    let mut rescue_qualities = vec![58u8, 54, 50, 46, 42];
    let is_large_jpeg = analysis.source_size_mb >= 1.5 || analysis.pixel_count >= 3_000_000;
    let is_medium_jpeg = analysis.source_size_mb >= 0.8 || analysis.pixel_count >= 1_500_000;

    if is_large_jpeg {
        let mut search_quality = min_candidate_quality.saturating_sub(2);
        while search_quality >= 6 {
            rescue_qualities.push(search_quality);
            if search_quality <= 7 {
                break;
            }
            search_quality = search_quality.saturating_sub(2);
        }
    } else if is_medium_jpeg {
        rescue_qualities.extend([38u8, 34, 30, 26, 22, 18, 14, 10]);
    } else {
        rescue_qualities = vec![58u8, 50, 42, 34, 26, 18];
    }

    rescue_qualities.sort_unstable();
    rescue_qualities.dedup();
    rescue_qualities.reverse();
    rescue_qualities
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
