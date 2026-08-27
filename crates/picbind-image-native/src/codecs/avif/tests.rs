use image::{Rgba, RgbaImage};

#[test]
fn avif_uses_an_avif_brand() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    assert!(bytes.windows(8).any(|bytes| bytes == b"ftypavif"));
}

#[test]
fn custom_options_preserve_dimensions_and_alpha() {
    let image = RgbaImage::from_fn(8, 6, |x, y| {
        Rgba([
            (x * 23) as u8,
            (y * 31) as u8,
            140,
            if x < 4 { 64 } else { 255 },
        ])
    });
    let options = super::encoder::AvifEncoderOptions {
        quality: 72,
        alpha_quality: Some(100),
        speed: 10,
        num_threads: Some(2),
        ..Default::default()
    };

    let bytes = super::encoder::encode_rgba_with_options(&image, &options).unwrap();
    let decoded =
        super::decoder::decode_with_options(&bytes, &super::decoder::AvifDecoderOptions::default())
            .unwrap()
            .to_rgba8();

    assert_eq!(decoded.dimensions(), image.dimensions());
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}
