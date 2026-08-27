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

#[test]
fn custom_options_encode_a_baseline_jpeg() {
    let options = super::encoder::JpegEncoderOptions {
        quality: 88,
        preset: mozjpeg_rs::Preset::BaselineBalanced,
        progressive: false,
        subsampling: Some(mozjpeg_rs::Subsampling::S444),
        ..Default::default()
    };

    let bytes =
        super::encoder::encode_with_options(&crate::tests::source_image(), &options).unwrap();
    let decoded = super::decode(&bytes).unwrap();

    assert_eq!((decoded.width(), decoded.height()), (24, 18));
    assert!(bytes.windows(2).any(|marker| marker == [0xff, 0xc0]));
    assert!(!bytes.windows(2).any(|marker| marker == [0xff, 0xc2]));
}
