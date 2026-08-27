use crate::{NativeImageFormat, inspect};

use super::{seed, transform};

#[test]
fn supports_the_complete_five_by_five_codec_matrix() {
    for source_format in NativeImageFormat::ALL {
        let source = seed(source_format);
        assert_eq!(inspect(&source).unwrap().format, source_format);
        for target_format in NativeImageFormat::ALL {
            let output = transform(&source, target_format, true);
            let metadata = inspect(&output.bytes).unwrap();
            assert_eq!(metadata.format, target_format);
            assert_eq!((metadata.width, metadata.height), (24, 18));
        }
    }
}
