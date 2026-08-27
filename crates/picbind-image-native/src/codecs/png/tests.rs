use image::{DynamicImage, GrayImage, ImageBuffer, ImageEncoder, Rgb, RgbImage, RgbaImage};

#[test]
fn png_preserves_transparency() {
    let image =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 8, image::Rgba([40, 80, 120, 96])));
    let bytes = super::encode(&image, 80).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}

#[test]
fn custom_options_encode_a_transparent_palette_png() {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(16, 12, |x, y| {
        image::Rgba([
            (x % 4 * 60) as u8,
            (y % 4 * 60) as u8,
            120,
            if x < 8 { 80 } else { 255 },
        ])
    }));
    let options = super::encoder::PngEncoderOptions {
        quality: 75,
        compare_lossless: false,
        max_colors: 16,
        quantization_speed: 10,
        dithering_level: 0.5,
        oxipng_options: oxipng::Options::from_preset(0),
        ..Default::default()
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = super::decode(&bytes).unwrap().to_rgba8();

    assert_eq!(bytes[25], 3, "custom options should emit palette PNG");
    assert_eq!(decoded.dimensions(), (16, 12));
    assert!(decoded.pixels().any(|pixel| pixel[3] < 255));
}

#[test]
fn png_decoder_preserves_grayscale_layout() {
    let image = GrayImage::from_fn(9, 7, |x, y| image::Luma([((x + y) * 11) as u8]));
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        )
        .unwrap();

    let decoded =
        super::decoder::decode_with_options(&bytes, &super::decoder::PngDecoderOptions::default())
            .unwrap();

    assert_eq!(decoded.to_luma8(), image);
}

#[test]
fn png_decoder_normalizes_sixteen_bit_samples_to_eight_bit() {
    let samples = [0x0000_u16, 0x1234, 0xabcd, 0xffff];
    let pixels = samples
        .into_iter()
        .flat_map(u16::to_ne_bytes)
        .collect::<Vec<_>>();
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(&pixels, 2, 2, image::ExtendedColorType::L16)
        .unwrap();

    let decoded = super::decode(&bytes).unwrap().to_luma8();

    assert_eq!(decoded.as_raw(), &[0x00, 0x12, 0xab, 0xff]);
}

#[test]
fn oxipng_raw_path_preserves_grayscale_layout() {
    let image = DynamicImage::ImageLuma8(GrayImage::from_fn(9, 7, |x, y| {
        image::Luma([((x + y) * 11) as u8])
    }));
    let options = super::encoder::PngEncoderOptions {
        quantize: false,
        ..Default::default()
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();

    assert_eq!(bytes[24], 8);
    assert_eq!(bytes[25], 0);
    assert_eq!(
        super::decode(&bytes).unwrap().to_luma8().dimensions(),
        (9, 7)
    );
}

#[test]
fn oxipng_raw_path_writes_sixteen_bit_samples_in_network_order() {
    let image = DynamicImage::ImageRgb16(
        ImageBuffer::<Rgb<u16>, Vec<u16>>::from_raw(
            2,
            1,
            vec![0x1234, 0xabcd, 0x0102, 0xfedc, 0x4567, 0x89ab],
        )
        .unwrap(),
    );
    let options = super::encoder::PngEncoderOptions {
        quantize: false,
        ..Default::default()
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = image::load_from_memory(&bytes).unwrap().to_rgb16();

    assert_eq!(bytes[24], 16);
    assert_eq!(bytes[25], 2);
    assert_eq!(decoded, image.to_rgb16());
}

#[test]
fn oxipng_raw_path_normalizes_float_samples_to_sixteen_bit() {
    let image = DynamicImage::ImageRgb32F(
        ImageBuffer::<Rgb<f32>, Vec<f32>>::from_raw(
            2,
            1,
            vec![0.12345, 0.54321, 0.87654, 0.23456, 0.65432, 0.76543],
        )
        .unwrap(),
    );
    let options = super::encoder::PngEncoderOptions {
        quantize: false,
        ..Default::default()
    };

    let bytes = super::encoder::encode_with_options(&image, &options).unwrap();
    let decoded = image::load_from_memory(&bytes).unwrap().to_rgb16();

    assert_eq!(bytes[24], 16);
    assert_eq!(decoded, image.to_rgb16());
}

#[test]
fn oxipng_options_can_select_zopfli_without_enabling_the_cli() {
    let mut oxipng_options = oxipng::Options::from_preset(0);
    oxipng_options.deflater = oxipng::Deflater::Zopfli(oxipng::ZopfliOptions::default());
    let options = super::encoder::PngEncoderOptions {
        oxipng_options,
        ..Default::default()
    };

    assert!(matches!(
        options.oxipng_options.deflater,
        oxipng::Deflater::Zopfli(_)
    ));
}

#[test]
fn png_candidate_failures_keep_the_other_valid_result() {
    let error = crate::NativeImageError::EncodeFailed("expected".into());

    assert_eq!(
        super::encoder::select_smaller_valid(Ok(vec![1, 2]), Err(error.clone())).unwrap(),
        vec![1, 2]
    );
    assert_eq!(
        super::encoder::select_smaller_valid(Err(error), Ok(vec![3])).unwrap(),
        vec![3]
    );
}

#[test]
fn empty_png_inputs_are_rejected_before_encoding() {
    let image = DynamicImage::ImageRgb8(RgbImage::new(0, 1));
    let options = super::encoder::PngEncoderOptions {
        quantize: false,
        ..Default::default()
    };

    let error = super::encoder::encode_with_options(&image, &options).unwrap_err();
    assert!(matches!(error, crate::NativeImageError::InvalidImage(_)));
}
