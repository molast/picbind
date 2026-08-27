use image::{DynamicImage, RgbaImage};

#[test]
fn png_preserves_transparency() {
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 8, image::Rgba([40, 80, 120, 96])));
    let bytes = super::encode(&image, 80).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}

#[test]
fn custom_options_encode_a_transparent_palette_png() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(16, 12, |x, y| {
        image::Rgba([
            (x % 4 * 60) as u8,
            (y % 4 * 60) as u8,
            120,
            if x < 8 { 80 } else { 255 },
        ])
    }));
    let options = super::encoder::PngEncoderOptions {
        quality: 75,
        compare_lossless: false,
        max_colors: 16,
        quantization_speed: 10,
        dithering_level: 0.5,
        oxipng_options: oxipng::Options::from_preset(0),
        ..Default::default()
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();

    assert_eq!(bytes[25], 3, "custom options should emit palette PNG");
    assert_eq!(decoded.dimensions(), (16, 12));
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}
