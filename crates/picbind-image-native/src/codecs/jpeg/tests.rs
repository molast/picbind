use image::{DynamicImage, GenericImageView, GrayImage, ImageEncoder, RgbImage, RgbaImage};

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

#[test]
fn grayscale_input_is_encoded_as_a_single_component_jpeg() {
    let image = DynamicImage::ImageLuma8(GrayImage::from_fn(9, 7, |x, y| {
        image::Luma([((x + y) * 11) as u8])
    }));

    let bytes = super::encode(&image, 82, false).unwrap();
    let sof = bytes
        .windows(2)
        .position(|marker| marker == [0xff, 0xc0] || marker == [0xff, 0xc2])
        .unwrap();

    assert_eq!(bytes[sof + 9], 1);
    assert_eq!(super::decode(&bytes).unwrap().dimensions(), (9, 7));
}

#[test]
fn advanced_mozjpeg_options_are_applied() {
    let options = super::encoder::JpegEncoderOptions {
        quality: 90,
        smoothing: 1,
        quantization_table: mozjpeg_rs::QuantTableIdx::Flat,
        custom_luma_qtable: Some([16; 64]),
        custom_chroma_qtable: Some([17; 64]),
        trellis: mozjpeg_rs::TrellisConfig::favor_quality(),
        optimize_scans: true,
        overshoot_deringing: true,
        fast_color: true,
        restart_interval: 1,
        ..Default::default()
    };

    assert_eq!(options.resolved_smoothing(), 6);
    let bytes =
        super::encoder::encode_with_options(&crate::tests::source_image(), &options).unwrap();
    assert_eq!(super::decode(&bytes).unwrap().dimensions(), (24, 18));
}

#[test]
fn codec_boundary_rejects_unapproved_alpha_loss() {
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 4, image::Rgba([20, 40, 60, 80])));

    let error =
        super::encoder::encode_with_options(&image, &super::encoder::JpegEncoderOptions::default())
            .unwrap_err();

    assert_eq!(error, crate::NativeImageError::AlphaLossDenied);
}

#[test]
fn empty_jpeg_inputs_are_rejected_before_encoding() {
    let image = DynamicImage::ImageRgb8(RgbImage::new(0, 1));
    let error =
        super::encoder::encode_with_options(&image, &super::encoder::JpegEncoderOptions::default())
            .unwrap_err();

    assert!(matches!(error, crate::NativeImageError::InvalidImage(_)));
}
