use ravif::BitDepth as RavifBitDepth;

pub fn quality_candidates(quality: u8) -> [u8; 5] {
    [
        quality,
        quality.saturating_sub(5),
        quality.saturating_sub(10),
        quality.saturating_sub(20),
        quality.saturating_sub(30),
    ]
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
