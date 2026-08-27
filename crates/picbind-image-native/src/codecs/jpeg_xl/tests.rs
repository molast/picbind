use image::{DynamicImage, Rgba, RgbaImage};

use super::{decoder, encoder};

fn transparent_fixture() -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_fn(8, 6, |x, y| {
        Rgba([
            (x * 23) as u8,
            (y * 31) as u8,
            140,
            if x == y { 96 } else { 255 },
        ])
    }))
}

#[test]
fn jpeg_xl_round_trip_is_lossless_and_preserves_alpha() {
    let source = transparent_fixture();
    let bytes =
        encoder::encode_with_options(&source, &encoder::JpegXlEncoderOptions::default()).unwrap();
    assert!(bytes.starts_with(&[0xff, 0x0a]));

    let decoded =
        decoder::decode_with_options(&bytes, &decoder::JpegXlDecoderOptions::default()).unwrap();
    assert_eq!(decoded.to_rgba8(), source.to_rgba8());
}

#[test]
fn jpeg_xl_options_support_single_threaded_codec_execution() {
    let source = transparent_fixture();
    let bytes = encoder::encode_with_options(
        &source,
        &encoder::JpegXlEncoderOptions {
            effort: 2,
            num_threads: 0,
            ..Default::default()
        },
    )
    .unwrap();
    let decoded =
        decoder::decode_with_options(&bytes, &decoder::JpegXlDecoderOptions { threads: Some(1) })
            .unwrap();
    assert_eq!(decoded.to_rgba8(), source.to_rgba8());
}
