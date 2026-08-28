use image::{DynamicImage, GenericImageView, Rgb, RgbImage, Rgba, RgbaImage};

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
    let mut options = super::encoder::WebPEncoderOptions::new(70);
    options.config.method = 0;
    options.config.alpha_quality = 100;

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();

    assert_eq!(decoded.dimensions(), (12, 8));
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}

#[test]
fn preview_options_use_the_fast_libwebp_profile() {
    let options = super::encoder::WebPEncoderOptions::preview(86);

    assert_eq!(options.config.quality, 86.0);
    assert_eq!(options.config.method, 0);
    assert_eq!(options.config.thread_level, 1);
    let bytes = super::encoder::encode_preview(&crate::tests::source_image(), 86).unwrap();
    assert_eq!(super::decode(&bytes).unwrap().dimensions(), (24, 18));
}

#[test]
fn libwebp_advanced_options_are_applied() {
    let mut options = super::encoder::WebPEncoderOptions::new(76);
    options.config.segments = 3;
    options.config.sns_strength = 70;
    options.config.filter_strength = 35;
    options.config.filter_sharpness = 3;
    options.config.autofilter = 1;
    options.config.pass = 2;
    options.config.thread_level = 1;
    options.config.use_sharp_yuv = 1;
    options.config.qmin = 10;
    options.config.qmax = 90;

    let bytes =
        super::encoder::encode_with_options(&crate::tests::source_image(), &options).unwrap();

    assert_eq!(super::decode(&bytes).unwrap().dimensions(), (24, 18));
}

#[test]
fn libwebp_lossless_mode_round_trips_rgb() {
    let image = DynamicImage::ImageRgb8(RgbImage::from_fn(11, 7, |x, y| {
        Rgb([(x * 17) as u8, (y * 23) as u8, (x * y * 3) as u8])
    }));
    let mut options = super::encoder::WebPEncoderOptions::default();
    options.config.lossless = 1;
    options.config.quality = 100.0;
    options.config.method = 6;

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();

    assert_eq!(super::decode(&bytes).unwrap().to_rgb8(), image.to_rgb8());
}

#[test]
fn invalid_libwebp_options_are_rejected() {
    let mut options = super::encoder::WebPEncoderOptions::default();
    options.config.method = 7;

    let error =
        super::encoder::encode_with_options(&crate::tests::source_image(), &options).unwrap_err();

    assert!(matches!(
        error,
        crate::NativeImageError::InvalidParameters(_)
    ));
}

#[test]
fn empty_webp_inputs_are_rejected_before_libwebp() {
    let image = DynamicImage::ImageRgb8(RgbImage::new(0, 1));

    let error =
        super::encoder::encode_with_options(&image, &super::encoder::WebPEncoderOptions::default())
            .unwrap_err();

    assert!(matches!(error, crate::NativeImageError::InvalidImage(_)));
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
