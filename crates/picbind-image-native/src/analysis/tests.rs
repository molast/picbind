use crate::{NativeEncodeOptions, NativeImageFormat, compare_quality, encode};

fn fixture() -> Vec<u8> {
    let image = image::RgbImage::from_fn(32, 24, |x, y| {
        image::Rgb([(x * 7) as u8, (y * 9) as u8, ((x + y) * 4) as u8])
    });
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgb8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

#[test]
fn reports_complete_metrics_for_identical_images() {
    let input = fixture();
    let result = compare_quality(&input, &input).unwrap();
    assert_eq!(result.comparison.ssim, 1.0);
    assert_eq!(result.comparison.mean_delta_e, 0.0);
    assert_eq!(result.comparison.mean_alpha_error, 0.0);
    assert_eq!(result.source_metrics.source_size_bytes, input.len());
}

#[test]
fn aligns_assessed_dimensions_without_mutating_metrics_dimensions() {
    let input = fixture();
    let mut options = NativeEncodeOptions::new(NativeImageFormat::Jpeg);
    options.allow_alpha_loss = true;
    options.dimensions = Some(crate::NativeImageDimensions {
        width: 16,
        height: 12,
    });
    let assessed = encode(&input, &options).unwrap();
    let result = compare_quality(&input, &assessed.bytes).unwrap();
    assert_eq!(
        (result.comparison.width, result.comparison.height),
        (32, 24)
    );
    assert_eq!(
        (
            result.assessed_metrics.width,
            result.assessed_metrics.height
        ),
        (16, 12)
    );
}
