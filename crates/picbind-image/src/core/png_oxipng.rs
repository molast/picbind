use oxipng::{Options, optimize_from_memory};

const LARGE_IMAGE_PIXEL_THRESHOLD: u64 = 8_000_000;

/// Applies lossless PNG optimization after perceptual palette quantization.
/// Large PNGs use a lighter preset to keep browser memory and latency bounded.
pub fn optimize_quantized_png(input: Vec<u8>, pixel_count: u64) -> Vec<u8> {
    let preset = if pixel_count > LARGE_IMAGE_PIXEL_THRESHOLD {
        1
    } else {
        3
    };
    let options = Options::from_preset(preset);

    match optimize_from_memory(&input, &options) {
        Ok(optimized) if optimized.len() < input.len() => optimized,
        _ => input,
    }
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgba, RgbaImage};

    use super::optimize_quantized_png;

    #[test]
    fn optimized_png_preserves_pixels_and_never_grows() {
        let mut image = RgbaImage::new(128, 128);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = Rgba([(x / 8) as u8, (y / 8) as u8, ((x + y) / 16) as u8, 255]);
        }
        let encoded = crate::core::png::encode_quantized_png_with_options(
            &DynamicImage::ImageRgba8(image),
            64,
            100,
            0.0,
            4,
        )
        .unwrap();
        let optimized = optimize_quantized_png(encoded.clone(), 128 * 128);

        assert!(optimized.len() <= encoded.len());
        let before = image::load_from_memory(&encoded).unwrap().to_rgba8();
        let after = image::load_from_memory(&optimized).unwrap().to_rgba8();
        assert_eq!(before, after);
    }
}
