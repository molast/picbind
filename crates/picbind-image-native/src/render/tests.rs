use image::GenericImageView;

use crate::{
    NativeImageDimensions, NativeImageFormat, NativeParameterDocument, NativeTaskControl,
    decode_image, inspect, materialize, render_preview, render_preview_from_decoded_with_control,
};

fn fixture() -> Vec<u8> {
    let image = image::RgbaImage::from_fn(80, 40, |x, y| {
        image::Rgba([x as u8, y as u8, 120, if x < 10 { 100 } else { 255 }])
    });
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

fn jpeg_fixture() -> Vec<u8> {
    let image = image::RgbImage::from_fn(80, 40, |x, y| image::Rgb([x as u8, y as u8, 120]));
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgb8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Jpeg,
        )
        .unwrap();
    bytes
}

fn empty_document() -> NativeParameterDocument {
    NativeParameterDocument {
        version: 1,
        operations: Vec::new(),
    }
}

#[test]
fn preview_is_bounded_webp_without_upscaling() {
    let output = render_preview(
        &fixture(),
        &empty_document(),
        NativeImageDimensions {
            width: 32,
            height: 32,
        },
        80,
    )
    .unwrap();
    assert_eq!((output.width, output.height), (32, 16));
    assert_eq!(
        inspect(&output.bytes).unwrap().format,
        NativeImageFormat::WebP
    );
}

#[test]
fn empty_source_materialization_returns_original() {
    let input = fixture();
    let output = materialize(&input, &empty_document(), None, 90, false).unwrap();
    assert!(output.returned_original);
    assert_eq!(output.bytes, input);
}

#[test]
fn format_conversion_never_reports_original() {
    let output = materialize(
        &fixture(),
        &empty_document(),
        Some(NativeImageFormat::WebP),
        85,
        false,
    )
    .unwrap();
    assert!(!output.returned_original);
    assert_eq!(output.metadata.format, NativeImageFormat::WebP);
}

#[test]
fn source_materialization_with_parameters_keeps_the_source_format() {
    let document = serde_json::from_value(serde_json::json!({
        "version": 1,
        "operations": [{
            "id": "rotate", "userId": "owner", "time": 1,
            "type": "rotate", "params": { "degrees": 90 }
        }]
    }))
    .unwrap();

    let output = materialize(&jpeg_fixture(), &document, None, 100, false).unwrap();

    assert!(!output.returned_original);
    assert_eq!(output.metadata.format, NativeImageFormat::Jpeg);
    assert_eq!(
        inspect(&output.bytes).unwrap().format,
        NativeImageFormat::Jpeg
    );
    assert_eq!((output.metadata.width, output.metadata.height), (40, 80));
}

#[test]
fn preview_scales_absolute_resize_and_draw_operations_into_bounds() {
    let document = serde_json::from_value(serde_json::json!({
        "version": 1,
        "operations": [
            {
                "id": "resize", "userId": "owner", "time": 1,
                "type": "resize", "params": { "width": 400, "height": 200 }
            },
            {
                "id": "draw", "userId": "owner", "time": 2,
                "type": "draw", "params": { "annotations": [{
                    "type": "line", "x": 0, "y": 0, "width": 400, "height": 200,
                    "scaleX": 1, "scaleY": 1, "rotation": 0,
                    "points": [0, 0, 400, 200], "stroke": "#ffffff", "strokeWidth": 8
                }] }
            }
        ]
    }))
    .unwrap();
    let output = render_preview(
        &fixture(),
        &document,
        NativeImageDimensions {
            width: 100,
            height: 100,
        },
        80,
    )
    .unwrap();
    assert_eq!((output.width, output.height), (100, 50));
    let metadata = inspect(&output.bytes).unwrap();
    assert_eq!((metadata.width, metadata.height), (100, 50));
}

#[test]
fn cached_preview_replay_does_not_mutate_the_authoritative_image() {
    let decoded = decode_image(&fixture()).unwrap();
    let original = decoded.image.to_rgba8().into_raw();
    let document = serde_json::from_value(serde_json::json!({
        "version": 1,
        "operations": [{
            "id": "rotate", "userId": "owner", "time": 1,
            "type": "rotate", "params": { "degrees": 90 }
        }]
    }))
    .unwrap();

    let output = render_preview_from_decoded_with_control(
        &decoded,
        &document,
        NativeImageDimensions {
            width: 80,
            height: 80,
        },
        80,
        &NativeTaskControl::default(),
    )
    .unwrap();

    assert_eq!((output.width, output.height), (40, 80));
    assert_eq!(decoded.image.to_rgba8().into_raw(), original);
}

#[test]
fn prepared_native_preview_keeps_source_metadata_but_bounds_cached_pixels() {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::new(2000, 1000));
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    let decoded = decode_image(&bytes)
        .unwrap()
        .into_preview(NativeImageDimensions {
            width: 960,
            height: 720,
        });

    assert_eq!((decoded.width(), decoded.height()), (2000, 1000));
    assert_eq!(decoded.image.dimensions(), (960, 480));
    let output = render_preview_from_decoded_with_control(
        &decoded,
        &empty_document(),
        NativeImageDimensions {
            width: 960,
            height: 720,
        },
        80,
        &NativeTaskControl::default(),
    )
    .unwrap();
    assert_eq!((output.width, output.height), (960, 480));
    assert_eq!(decoded.image.dimensions(), (960, 480));
}
