use crate::{NativeEncodeOptions, NativeImageFormat, encode_auto, inspect};

use super::seed;

#[test]
fn auto_encoding_returns_the_predicted_decodable_format() {
    let source = seed(NativeImageFormat::Jpeg);
    let output = encode_auto(
        &source,
        &NativeEncodeOptions {
            format: NativeImageFormat::WebP,
            quality: 80,
            compression_gain: 100,
            allow_alpha_loss: false,
            force_encode: false,
            dimensions: None,
        },
    )
    .unwrap();
    let metadata = inspect(&output.bytes).unwrap();
    assert_eq!(metadata.format, output.metadata.format);
    assert_eq!((metadata.width, metadata.height), (24, 18));
}
