use image::{DynamicImage, Rgba, RgbaImage};
use serde_json::json;

use crate::{NativeImageError, NativeImageFormat, codecs};

use super::{
    NativeImageOperation, NativeOperationType, NativeParameterDocument, replay_parameters,
};

fn source() -> Vec<u8> {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_fn(20, 12, |x, y| {
        Rgba([
            (x * 10) as u8,
            (y * 16) as u8,
            80,
            if x < 10 { 150 } else { 255 },
        ])
    }));
    codecs::encode(&image, NativeImageFormat::Png, 100, false).unwrap()
}

fn operation(
    id: &str,
    operation_type: NativeOperationType,
    params: serde_json::Value,
) -> NativeImageOperation {
    NativeImageOperation {
        id: id.into(),
        user_id: "owner".into(),
        time: 1.0,
        operation_type,
        params,
    }
}

fn document(operations: Vec<NativeImageOperation>) -> NativeParameterDocument {
    NativeParameterDocument {
        version: 1,
        operations,
    }
}

#[test]
fn replays_geometry_in_document_order() {
    let rendered = replay_parameters(
        &source(),
        &document(vec![
            operation(
                "crop",
                NativeOperationType::Crop,
                json!({ "x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0 }),
            ),
            operation(
                "resize",
                NativeOperationType::Resize,
                json!({ "width": 8, "height": 4 }),
            ),
            operation(
                "rotate",
                NativeOperationType::Rotate,
                json!({ "degrees": 90 }),
            ),
        ]),
    )
    .unwrap();
    assert_eq!((rendered.width(), rendered.height()), (4, 8));
}

#[test]
fn color_replay_changes_rgb_and_preserves_alpha() {
    let original = replay_parameters(&source(), &document(vec![]))
        .unwrap()
        .to_rgba8();
    let rendered = replay_parameters(
        &source(),
        &document(vec![operation(
            "color",
            NativeOperationType::Color,
            json!({ "brightness": 20 }),
        )]),
    )
    .unwrap()
    .to_rgba8();
    assert_ne!(rendered.get_pixel(2, 2)[0], original.get_pixel(2, 2)[0]);
    assert_eq!(&rendered.get_pixel(2, 2).0[..3], &[71, 83, 131]);
    assert_eq!(rendered.get_pixel(2, 2)[3], original.get_pixel(2, 2)[3]);
}

#[test]
fn geometric_draw_is_composited_on_the_current_image() {
    let rendered = replay_parameters(
        &source(),
        &document(vec![operation(
            "draw",
            NativeOperationType::Draw,
            json!({
                "annotations": [{
                    "type": "rectangle", "x": 2, "y": 2, "width": 8, "height": 5,
                    "scaleX": 1, "scaleY": 1, "rotation": 0, "stroke": "#ff0000",
                    "fill": "#00ff00", "strokeWidth": 2
                }]
            }),
        )]),
    )
    .unwrap()
    .to_rgba8();
    assert!(rendered.get_pixel(5, 4)[1] > rendered.get_pixel(5, 4)[0]);
    assert_eq!(rendered.get_pixel(5, 4)[3], 255);
}

#[test]
fn off_canvas_draw_geometry_is_clipped_before_rasterization() {
    let rendered = replay_parameters(
        &source(),
        &document(vec![operation(
            "draw",
            NativeOperationType::Draw,
            json!({
                "annotations": [{
                    "type": "line", "x": -500_000, "y": 6, "width": 0, "height": 0,
                    "scaleX": 1, "scaleY": 1, "rotation": 0,
                    "points": [0, 0, 1_000_000, 0], "stroke": "#ff0000", "strokeWidth": 1
                }]
            }),
        )]),
    )
    .unwrap();
    assert_eq!((rendered.width(), rendered.height()), (20, 12));
}

#[test]
fn embedded_font_renders_text_without_system_fonts() {
    let rendered = replay_parameters(
        &source(),
        &document(vec![operation(
            "draw",
            NativeOperationType::Draw,
            json!({
                "annotations": [{
                    "type": "text", "x": 1, "y": 1, "width": 16, "height": 10,
                    "scaleX": 1, "scaleY": 1, "rotation": 0, "stroke": "#ffffff",
                    "strokeWidth": 1, "text": "A"
                }]
            }),
        )]),
    )
    .unwrap();
    assert_ne!(
        rendered.to_rgba8(),
        image::load_from_memory(&source()).unwrap().to_rgba8()
    );
}

#[test]
fn embedded_twemoji_renders_color_emoji() {
    let rendered = replay_parameters(
        &source(),
        &document(vec![operation(
            "draw",
            NativeOperationType::Draw,
            json!({
                "annotations": [{
                    "type": "emoji", "x": 2, "y": 1, "width": 10, "height": 10,
                    "scaleX": 1, "scaleY": 1, "rotation": 0, "stroke": "#ffffff",
                    "strokeWidth": 1, "emoji": "👍"
                }]
            }),
        )]),
    )
    .unwrap();
    assert_ne!(
        rendered.to_rgba8(),
        image::load_from_memory(&source()).unwrap().to_rgba8()
    );
}

#[test]
fn missing_embedded_text_glyph_is_explicitly_unsupported() {
    let error = replay_parameters(
        &source(),
        &document(vec![operation(
            "draw",
            NativeOperationType::Draw,
            json!({
                "annotations": [{
                    "type": "text", "x": 1, "y": 1, "width": 16, "height": 10,
                    "scaleX": 1, "scaleY": 1, "rotation": 0, "stroke": "#ffffff",
                    "strokeWidth": 1, "text": "中"
                }]
            }),
        )]),
    )
    .unwrap_err();
    assert_eq!(
        error,
        NativeImageError::UnsupportedOperation("draw:text-glyph:中".into())
    );
}

#[test]
fn duplicate_operation_ids_are_rejected() {
    let error = replay_parameters(
        &source(),
        &document(vec![
            operation(
                "same",
                NativeOperationType::Rotate,
                json!({ "degrees": 90 }),
            ),
            operation(
                "same",
                NativeOperationType::Rotate,
                json!({ "degrees": 180 }),
            ),
        ]),
    )
    .unwrap_err();
    assert!(matches!(error, NativeImageError::InvalidParameters(_)));
}

#[test]
fn parameter_document_deserializes_the_shared_camel_case_contract() {
    let document: NativeParameterDocument = serde_json::from_value(json!({
        "version": 1,
        "operations": [{
            "id": "rotate", "userId": "guest", "time": 42,
            "type": "rotate", "params": { "degrees": 90 }
        }]
    }))
    .unwrap();
    let rendered = replay_parameters(&source(), &document).unwrap();
    assert_eq!((rendered.width(), rendered.height()), (12, 20));
}
