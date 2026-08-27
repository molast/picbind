use image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};

#[test]
fn webp_uses_a_riff_container() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    assert!(bytes.starts_with(b"RIFF"));
    assert!(bytes.windows(4).any(|bytes| bytes == b"WEBP"));
}

#[test]
fn custom_options_preserve_dimensions_and_alpha() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(12, 8, |x, y| {
        Rgba([
            (x * 17) as u8,
            (y * 23) as u8,
            90,
            if x < 6 { 48 } else { 255 },
        ])
    }));
    let options = super::encoder::WebPEncoderOptions {
        quality: 70,
        method: 0,
        alpha_quality: 100,
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();

    assert_eq!(decoded.dimensions(), (12, 8));
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}

#[test]
fn image_webp_decoder_keeps_opaque_images_in_rgb() {
    let image = RgbImage::from_fn(11, 7, |x, y| Rgb([(x * 17) as u8, (y * 23) as u8, 90]));
    let mut bytes = Vec::new();
    image_webp::WebPEncoder::new(&mut bytes)
        .encode(
            image.as_raw(),
            image.width(),
            image.height(),
            image_webp::ColorType::Rgb8,
        )
        .unwrap();
    let decoded = super::decode(&bytes).unwrap();

    assert_eq!(decoded.color(), image::ColorType::Rgb8);
    assert_eq!(decoded.to_rgb8(), image);
}

#[test]
fn decoder_options_support_simple_upsampling_and_memory_limits() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    let decoded = super::decoder::decode_with_options(
        &bytes,
        &super::decoder::WebPDecoderOptions {
            memory_limit: 24 * 18 * 4,
            use_simple_upsampling: true,
        },
    )
    .unwrap();

    assert_eq!((decoded.width(), decoded.height()), (24, 18));
}

#[test]
fn decoder_rejects_a_pixel_buffer_above_its_memory_limit() {
    let bytes = super::encode(&crate::tests::source_image(), 80).unwrap();
    let error = super::decoder::decode_with_options(
        &bytes,
        &super::decoder::WebPDecoderOptions {
            memory_limit: 1,
            ..Default::default()
        },
    )
    .unwrap_err();

    assert!(matches!(error, crate::NativeImageError::InvalidImage(_)));
}
