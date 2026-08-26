use crate::{NativeEncodeOptions, NativeImageFormat, encode_auto_planned, encode_planned, inspect};

use super::seed;

fn options(format: NativeImageFormat) -> NativeEncodeOptions {
    NativeEncodeOptions {
        format,
        quality: 88,
        compression_gain: 100,
        allow_alpha_loss: true,
        force_encode: true,
        dimensions: None,
    }
}

#[test]
fn planned_outputs_are_decodable_in_all_formats() {
    let source = seed(NativeImageFormat::Png);
    for format in NativeImageFormat::ALL {
        let output = encode_planned(&source, &options(format)).unwrap();
        let metadata = inspect(&output.bytes).unwrap();
        assert_eq!(metadata.format, format);
        assert_eq!((metadata.width, metadata.height), (24, 18));
    }
}

#[test]
fn planned_auto_uses_a_decodable_predicted_format() {
    let source = seed(NativeImageFormat::Jpeg);
    let output = encode_auto_planned(&source, &options(NativeImageFormat::WebP)).unwrap();
    assert_eq!(
        inspect(&output.bytes).unwrap().format,
        output.metadata.format
    );
}

#[test]
fn planned_jpeg_rejects_transparency_without_permission() {
    let transparent = crate::formats::encode(
        &image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            16,
            16,
            image::Rgba([20, 40, 80, 120]),
        )),
        NativeImageFormat::Png,
        100,
        false,
    )
    .unwrap();
    let mut jpeg = options(NativeImageFormat::Jpeg);
    jpeg.allow_alpha_loss = false;
    assert_eq!(
        encode_planned(&transparent, &jpeg).unwrap_err(),
        crate::NativeImageError::AlphaLossDenied
    );
}

#[test]
fn same_format_planner_keeps_smaller_original() {
    let source = seed(NativeImageFormat::Jpeg);
    let mut jpeg = options(NativeImageFormat::Jpeg);
    jpeg.force_encode = false;
    let output = encode_planned(&source, &jpeg).unwrap();
    assert!(output.bytes.len() <= source.len());
    if output.returned_original {
        assert_eq!(output.bytes, source);
    }
}
