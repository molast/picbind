use image::{DynamicImage, RgbaImage};

#[test]
fn png_preserves_transparency() {
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 8, image::Rgba([40, 80, 120, 96])));
    let bytes = super::encode(&image, 80).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}
