use std::{io::Cursor, thread, time::Duration};

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use picbind_image_native::{
    NativeEncodeOptions, NativeImageDimensions, NativeImageError, NativeImageFormat,
    NativeImageOperation, NativeOperationType, NativeParameterDocument, NativeTaskControl,
    create_share_assets, encode, encode_planned_with_control, encode_with_control, inspect,
    materialize, replay_parameters,
};
use serde_json::json;

fn fixture(width: u32, height: u32, transparent: bool) -> Vec<u8> {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        Rgba([
            ((x * 17 + y * 3) % 256) as u8,
            ((x * 5 + y * 19) % 256) as u8,
            ((x * 11 + y * 7) % 256) as u8,
            if transparent && (x + y) % 5 == 0 {
                96
            } else {
                255
            },
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn operation(
    id: &str,
    time: f64,
    operation_type: NativeOperationType,
    params: serde_json::Value,
) -> NativeImageOperation {
    NativeImageOperation {
        id: id.into(),
        user_id: "contract".into(),
        time,
        operation_type,
        params,
    }
}

#[test]
fn four_format_metadata_and_conversion_contract() {
    let source = fixture(48, 32, false);
    for format in NativeImageFormat::ALL {
        let mut options = NativeEncodeOptions::new(format);
        options.force_encode = true;
        options.allow_alpha_loss = true;
        let output = encode(&source, &options).unwrap();
        let metadata = inspect(&output.bytes).unwrap();
        assert_eq!(metadata.format, format);
        assert_eq!((metadata.width, metadata.height), (48, 32));
    }
}

#[test]
fn ordered_parameters_have_stable_geometry_and_materialization() {
    let source = fixture(80, 40, true);
    let document = NativeParameterDocument {
        version: 1,
        operations: vec![
            operation(
                "crop",
                1.0,
                NativeOperationType::Crop,
                json!({ "x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0 }),
            ),
            operation(
                "rotate",
                2.0,
                NativeOperationType::Rotate,
                json!({ "degrees": 90 }),
            ),
            operation(
                "resize",
                3.0,
                NativeOperationType::Resize,
                json!({ "width": 30, "height": 20 }),
            ),
            operation(
                "color",
                4.0,
                NativeOperationType::Color,
                json!({ "brightness": 12 }),
            ),
        ],
    };
    let rendered = replay_parameters(&source, &document).unwrap();
    assert_eq!((rendered.width(), rendered.height()), (30, 20));
    let output = materialize(&source, &document, Some(NativeImageFormat::WebP), 82, false).unwrap();
    assert_eq!((output.metadata.width, output.metadata.height), (30, 20));
    assert_eq!(output.metadata.format, NativeImageFormat::WebP);
    assert!(!output.returned_original);
}

#[test]
fn alpha_and_same_format_fallback_contract() {
    let transparent = fixture(40, 30, true);
    let jpeg = NativeEncodeOptions::new(NativeImageFormat::Jpeg);
    assert_eq!(
        encode(&transparent, &jpeg),
        Err(NativeImageError::AlphaLossDenied)
    );

    let opaque = fixture(40, 30, false);
    let png = NativeEncodeOptions::new(NativeImageFormat::Png);
    let output = encode(&opaque, &png).unwrap();
    assert!(output.bytes.len() <= opaque.len());
    if output.returned_original {
        assert_eq!(output.bytes, opaque);
    }
}

#[test]
fn cancellation_and_derived_asset_contract() {
    let source = fixture(64, 48, true);
    let control = NativeTaskControl::default();
    control.cancel();
    let options = NativeEncodeOptions::new(NativeImageFormat::WebP);
    assert_eq!(
        encode_with_control(&source, &options, &control),
        Err(NativeImageError::Cancelled),
    );

    let assets = create_share_assets(
        &source,
        None,
        NativeImageDimensions {
            width: 32,
            height: 32,
        },
    )
    .unwrap();
    assert!(assets.placeholder.dominant_color.starts_with('#'));
    assert_eq!(assets.placeholder.dominant_color.len(), 7);
    assert!(!assets.placeholder.blur_hash.is_empty());
    assert_eq!(
        inspect(&assets.thumbnail).unwrap().format,
        NativeImageFormat::WebP
    );
}

#[test]
fn in_flight_planner_cancellation_does_not_deliver_an_output() {
    let source = fixture(640, 480, false);
    let control = NativeTaskControl::default();
    let worker_control = control.clone();
    let task = thread::spawn(move || {
        let mut options = NativeEncodeOptions::new(NativeImageFormat::Avif);
        options.force_encode = true;
        encode_planned_with_control(&source, &options, &worker_control)
    });
    thread::sleep(Duration::from_millis(5));
    control.cancel();
    assert_eq!(task.join().unwrap(), Err(NativeImageError::Cancelled));
}
