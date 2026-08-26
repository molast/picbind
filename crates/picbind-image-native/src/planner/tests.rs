use image::{DynamicImage, Rgba, RgbaImage};

use crate::NativeImageFormat;

use super::predict_format;

#[test]
fn flat_images_prefer_png() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(64, 64, Rgba([30, 60, 90, 255])));
    assert_eq!(predict_format(&image), NativeImageFormat::Png);
}

#[test]
fn detailed_opaque_images_prefer_avif() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(96, 96, |x, y| {
        Rgba([
            ((x * 17 + y * 11) % 256) as u8,
            ((x * 7 + y * 23) % 256) as u8,
            ((x * 29 + y * 3) % 256) as u8,
            255,
        ])
    }));
    assert_eq!(predict_format(&image), NativeImageFormat::Avif);
}

#[test]
fn transparent_auto_never_selects_jpeg() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(64, 64, Rgba([30, 60, 90, 96])));
    assert_ne!(predict_format(&image), NativeImageFormat::Jpeg);
}
