use crate::{
    NativeEncodeOptions, NativeImageDimensions, NativeImageError, NativeImageFormat, encode,
    encode_auto, encode_planned, inspect,
};

use super::seed;

fn resized_options(format: NativeImageFormat) -> NativeEncodeOptions {
    NativeEncodeOptions {
        format,
        quality: 84,
        compression_gain: 100,
        allow_alpha_loss: true,
        force_encode: false,
        dimensions: Some(NativeImageDimensions {
            width: 12,
            height: 9,
        }),
    }
}

#[test]
fn resizes_to_exact_dimensions_for_every_output_format() {
    let source = seed(NativeImageFormat::Png);
    for format in NativeImageFormat::ALL {
        let output = encode(&source, &resized_options(format)).unwrap();
        let metadata = inspect(&output.bytes).unwrap();
        assert_eq!(metadata.format, format);
        assert_eq!((metadata.width, metadata.height), (12, 9));
        assert!(!output.returned_original);
    }
}

#[test]
fn resized_auto_output_uses_the_requested_dimensions() {
    let source = seed(NativeImageFormat::Jpeg);
    let output = encode_auto(&source, &resized_options(NativeImageFormat::WebP)).unwrap();
    assert_eq!((output.metadata.width, output.metadata.height), (12, 9));
    assert!(!output.returned_original);
}

#[test]
fn changed_dimensions_never_return_the_original_same_format_file() {
    let source = seed(NativeImageFormat::Jpeg);
    let output = encode(&source, &resized_options(NativeImageFormat::Jpeg)).unwrap();
    assert!(!output.returned_original);
    assert_ne!(output.bytes, source);
    assert_eq!((output.metadata.width, output.metadata.height), (12, 9));
}

#[test]
fn invalid_resize_dimensions_fail_before_allocation() {
    let source = seed(NativeImageFormat::Png);
    let mut options = resized_options(NativeImageFormat::Png);
    options.dimensions = Some(NativeImageDimensions {
        width: 16_384,
        height: 16_384,
    });
    assert!(matches!(
        encode(&source, &options),
        Err(NativeImageError::InvalidDimensions(_))
    ));
}

#[test]
fn planner_rejects_resize_dimensions() {
    let source = seed(NativeImageFormat::Png);
    assert!(matches!(
        encode_planned(&source, &resized_options(NativeImageFormat::Png)),
        Err(NativeImageError::InvalidDimensions(_))
    ));
}
