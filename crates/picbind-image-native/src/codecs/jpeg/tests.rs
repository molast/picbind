use image::{DynamicImage, RgbaImage};

use crate::{NativeEncodeOptions, NativeImageError, NativeImageFormat, encode};

#[test]
fn jpeg_requires_explicit_alpha_loss() {
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 4, image::Rgba([20, 40, 60, 80])));
    let source = crate::codecs::png::encode(&image, 80).unwrap();
    let error = encode(&source, &NativeEncodeOptions::new(NativeImageFormat::Jpeg)).unwrap_err();
    assert_eq!(error, NativeImageError::AlphaLossDenied);
}
