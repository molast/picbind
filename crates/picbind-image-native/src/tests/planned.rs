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
        assert_eq!(output.metadata, metadata);
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

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[test]
#[ignore = "manual Apple Silicon release benchmark using the local image corpus"]
fn benchmark_cross_format_avif_under_five_seconds() {
    use std::{fs, path::Path, time::Instant};

    let root = std::env::var("PICBIND_EMPIRICAL_ROOT").unwrap();
    let samples = [
        "压缩图2/ac47de90d79e7193a342232284347007.jpeg",
        "压缩图/pexels-photo-6206917.png",
        "压缩图/pexels-photo-20898616.webp",
    ];
    let mut avif = options(NativeImageFormat::Avif);
    avif.quality = 80;
    avif.allow_alpha_loss = false;

    for relative_path in samples {
        let input = fs::read(Path::new(&root).join(relative_path)).unwrap();
        let started = Instant::now();
        let output = encode_planned(&input, &avif).unwrap();
        let elapsed = started.elapsed();
        eprintln!(
            "{relative_path}: {} -> {} bytes in {} ms",
            input.len(),
            output.bytes.len(),
            elapsed.as_millis()
        );
        assert_eq!(output.metadata.format, NativeImageFormat::Avif);
        assert!(
            elapsed.as_secs_f64() < 5.0,
            "{relative_path} took {:.3}s",
            elapsed.as_secs_f64()
        );
    }
}
