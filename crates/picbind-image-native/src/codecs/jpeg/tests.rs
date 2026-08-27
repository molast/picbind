use image::{DynamicImage, GrayImage, ImageEncoder, RgbaImage};

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

#[test]
fn jpeg_decoder_options_support_safe_scalar_decoding() {
    let bytes = super::encode(&crate::tests::source_image(), 82, false).unwrap();
    let decoded = super::decoder::decode_with_options(
        &bytes,
        &super::decoder::JpegDecoderOptions {
            strict_mode: true,
            use_unsafe: false,
            max_scans: 100,
        },
    )
    .unwrap();

    assert_eq!((decoded.width(), decoded.height()), (24, 18));
    assert_eq!(decoded.color(), image::ColorType::Rgb8);
}

#[test]
fn jpeg_decoder_expands_grayscale_to_rgb() {
    let image = GrayImage::from_fn(9, 7, |x, y| image::Luma([((x + y) * 11) as u8]));
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 90)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        )
        .unwrap();

    let decoded = super::decode(&bytes).unwrap().to_rgb8();

    assert_eq!(decoded.dimensions(), image.dimensions());
    assert!(
        decoded
            .pixels()
            .all(|pixel| pixel[0] == pixel[1] && pixel[1] == pixel[2])
    );
}
