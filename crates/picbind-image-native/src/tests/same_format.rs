use crate::NativeImageFormat;

use super::{seed, transform};

#[test]
fn same_format_never_grows_without_force_encode() {
    for format in NativeImageFormat::ALL {
        let source = seed(format);
        let output = transform(&source, format, false);
        assert!(output.bytes.len() <= source.len(), "format: {format:?}");
    }
}
