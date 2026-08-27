use image::{DynamicImage, Rgba, RgbaImage};

#[test]
fn webp_uses_a_riff_container() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    assert!(bytes.starts_with(b"RIFF"));
    assert!(bytes.windows(4).any(|bytes| bytes == b"WEBP"));
}

#[test]
fn custom_options_preserve_dimensions_and_alpha() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(12, 8, |x, y| {
        Rgba([
            (x * 17) as u8,
            (y * 23) as u8,
            90,
            if x < 6 { 48 } else { 255 },
        ])
    }));
    let options = super::encoder::WebPEncoderOptions {
        quality: 70,
        method: 0,
        alpha_quality: 100,
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();

    assert_eq!(decoded.dimensions(), (12, 8));
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}
