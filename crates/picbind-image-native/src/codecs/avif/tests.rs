use std::borrow::Cow;

use image::{DynamicImage, GenericImageView, GrayImage, Luma, Rgb, RgbImage, Rgba, RgbaImage};

use super::encoder::PreparedAvifPixels;

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

#[test]
fn rgb_input_uses_the_borrowed_rgb_path() {
    let image = DynamicImage::ImageRgb8(RgbImage::from_fn(8, 6, |x, y| {
        Rgb([(x * 23) as u8, (y * 31) as u8, 140])
    }));

    let prepared = PreparedAvifPixels::from_image(&image).unwrap();
    assert!(matches!(
        prepared,
        PreparedAvifPixels::Rgb(Cow::Borrowed(_))
    ));

    let decoded = super::decode(&prepared.encode(80).unwrap())
        .unwrap()
        .to_rgba8();
    assert_eq!(decoded.dimensions(), image.dimensions());
    assert!(decoded.pixels().all(|pixel| pixel[3] == 255));
}

#[test]
fn rgba_input_uses_the_borrowed_rgba_path() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 3, Rgba([1, 2, 3, 128])));

    let prepared = PreparedAvifPixels::from_image(&image).unwrap();
    assert!(matches!(
        prepared,
        PreparedAvifPixels::Rgba(Cow::Borrowed(_))
    ));
}

#[test]
fn non_alpha_layout_is_materialized_once_as_rgb8() {
    let image = DynamicImage::ImageLuma8(GrayImage::from_pixel(4, 3, Luma([127])));

    let prepared = PreparedAvifPixels::from_image(&image).unwrap();
    assert!(matches!(prepared, PreparedAvifPixels::Rgb(Cow::Owned(_))));
}

#[test]
fn empty_images_are_rejected_before_encoding() {
    let image = DynamicImage::ImageRgb8(RgbImage::new(0, 1));
    let error = PreparedAvifPixels::from_image(&image).unwrap_err();
    assert!(matches!(error, crate::NativeImageError::InvalidImage(_)));
}
