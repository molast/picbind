use std::io::Cursor;

use image::{DynamicImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};

use super::{NativeMessagingCompressionOptions, compress_for_messaging, luban_sample_size};
use crate::{NativeImageFormat, inspect};

fn png_fixture(width: u32, height: u32, transparent: bool) -> Vec<u8> {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        Rgba([
            (x.wrapping_mul(17).wrapping_add(y * 3) % 256) as u8,
            (x.wrapping_mul(5).wrapping_add(y * 11) % 256) as u8,
            ((x ^ y) % 256) as u8,
            if transparent && (x + y) % 3 == 0 {
                96
            } else {
                255
            },
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn jpeg_fixture(width: u32, height: u32) -> Vec<u8> {
    let image = RgbImage::from_fn(width, height, |x, y| {
        Rgb([
            (x.wrapping_mul(13).wrapping_add(y * 7) % 256) as u8,
            (x.wrapping_mul(3).wrapping_add(y * 19) % 256) as u8,
            ((x ^ y) % 256) as u8,
        ])
    });
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 92)
        .encode_image(&image)
        .unwrap();
    bytes
}

#[test]
fn luban_sample_size_matches_classic_dimension_bands() {
    assert_eq!(luban_sample_size(1_600, 1_000), 1);
    assert_eq!(luban_sample_size(1_664, 1_000), 2);
    assert_eq!(luban_sample_size(4_990, 3_000), 4);
    assert_eq!(luban_sample_size(10_240, 7_000), 8);
    assert_eq!(luban_sample_size(4_000, 400), 1);
    assert_eq!(luban_sample_size(12_000, 1_200), 1);
}

#[test]
fn small_compatible_images_are_returned_unchanged() {
    let source = png_fixture(24, 16, false);
    let output =
        compress_for_messaging(&source, &NativeMessagingCompressionOptions::default()).unwrap();
    assert!(output.returned_original);
    assert_eq!(output.bytes, source);
    assert_eq!(output.metadata.format, NativeImageFormat::Png);
}

#[test]
fn large_photos_are_downsampled_and_encoded_as_jpeg() {
    let source = jpeg_fixture(1_664, 1_000);
    let options = NativeMessagingCompressionOptions {
        ignore_below_bytes: 0,
        ..NativeMessagingCompressionOptions::default()
    };
    let output = compress_for_messaging(&source, &options).unwrap();
    assert!(!output.returned_original);
    assert_eq!(output.metadata.format, NativeImageFormat::Jpeg);
    assert_eq!((output.metadata.width, output.metadata.height), (832, 500));
    assert_eq!(
        inspect(&output.bytes).unwrap().format,
        NativeImageFormat::Jpeg
    );
}

#[test]
fn transparent_images_use_fast_webp_without_flattening_alpha() {
    let source = png_fixture(64, 48, true);
    let options = NativeMessagingCompressionOptions {
        ignore_below_bytes: 0,
        ..NativeMessagingCompressionOptions::default()
    };
    let output = compress_for_messaging(&source, &options).unwrap();
    assert!(!output.returned_original);
    assert_eq!(output.metadata.format, NativeImageFormat::WebP);
    assert!(output.metadata.has_alpha);
    assert!(inspect(&output.bytes).unwrap().has_alpha);
}
