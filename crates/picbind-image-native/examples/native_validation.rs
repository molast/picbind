use std::{collections::BTreeMap, io::Cursor, time::Instant};

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use picbind_image_native::{
    NativeEncodeOptions, NativeImageDimensions, NativeImageFormat, NativeImageOperation,
    NativeOperationType, NativeParameterDocument, compare_quality, create_share_assets, encode,
    inspect, materialize, render_preview,
};
use serde_json::{Value, json};

fn main() {
    let longest_edge = std::env::var("PICBIND_VALIDATION_EDGE")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(1_600)
        .clamp(256, 4_096);
    let width = longest_edge;
    let height = longest_edge * 2 / 3;
    let source = fixture(width, height);
    let mut timings = BTreeMap::new();
    let mut outputs = BTreeMap::new();
    let mut quality_target = None;

    for format in NativeImageFormat::ALL {
        let label = format.extension().to_string();
        let started = Instant::now();
        let mut options = NativeEncodeOptions::new(format);
        options.force_encode = true;
        options.allow_alpha_loss = true;
        let output = encode(&source, &options).expect("Native encoding must succeed");
        let metadata = inspect(&output.bytes).expect("Native output must be decodable");
        assert_eq!(metadata.format, format);
        assert_eq!((metadata.width, metadata.height), (width, height));
        timings.insert(format!("encode_{label}_ms"), elapsed_ms(started));
        outputs.insert(format!("{label}_bytes"), json!(output.bytes.len()));
        if format == NativeImageFormat::WebP {
            quality_target = Some(output.bytes);
        }
    }

    let document = parameter_document(width, height);
    let started = Instant::now();
    let preview = render_preview(
        &source,
        &document,
        NativeImageDimensions {
            width: 1_024,
            height: 768,
        },
        80,
    )
    .expect("Preview rendering must succeed");
    timings.insert("render_preview_ms".into(), elapsed_ms(started));
    outputs.insert("preview_bytes".into(), json!(preview.bytes.len()));

    let started = Instant::now();
    let materialized = materialize(&source, &document, Some(NativeImageFormat::WebP), 84, false)
        .expect("Materialization must succeed");
    timings.insert("materialize_ms".into(), elapsed_ms(started));
    outputs.insert("materialized_bytes".into(), json!(materialized.bytes.len()));

    let started = Instant::now();
    let quality = compare_quality(
        &source,
        quality_target
            .as_deref()
            .expect("WebP validation output is required"),
    )
    .expect("Quality comparison must succeed");
    timings.insert("compare_quality_ms".into(), elapsed_ms(started));

    let started = Instant::now();
    let assets = create_share_assets(
        &source,
        Some(&document),
        NativeImageDimensions {
            width: 640,
            height: 480,
        },
    )
    .expect("Share asset generation must succeed");
    timings.insert("create_share_assets_ms".into(), elapsed_ms(started));
    outputs.insert("thumbnail_bytes".into(), json!(assets.thumbnail.len()));

    let report = json!({
        "schemaVersion": 1,
        "architecture": std::env::consts::ARCH,
        "input": {
            "width": width,
            "height": height,
            "pixels": u64::from(width) * u64::from(height),
            "bytes": source.len(),
        },
        "timings": timings,
        "outputs": outputs,
        "quality": {
            "ssim": quality.comparison.ssim,
            "msSsim": quality.comparison.ms_ssim,
            "psnr": quality.comparison.psnr,
            "edgeRetention": quality.comparison.edge_retention,
        },
    });
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}

fn fixture(width: u32, height: u32) -> Vec<u8> {
    let image = RgbaImage::from_fn(width, height, |x, y| {
        let wave = (((x ^ y) & 31) * 5) as u8;
        Rgba([
            ((x * 7 + y * 3) % 256) as u8,
            ((x * 2 + y * 11) % 256) as u8,
            wave.saturating_add(((x + y) % 96) as u8),
            255,
        ])
    });
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn parameter_document(width: u32, height: u32) -> NativeParameterDocument {
    NativeParameterDocument {
        version: 1,
        operations: vec![
            operation(
                "crop",
                1.0,
                NativeOperationType::Crop,
                json!({ "x": 0.05, "y": 0.05, "width": 0.9, "height": 0.9 }),
            ),
            operation(
                "resize",
                2.0,
                NativeOperationType::Resize,
                json!({
                    "width": (f64::from(width) * 0.75).round() as u32,
                    "height": (f64::from(height) * 0.75).round() as u32,
                }),
            ),
            operation(
                "color",
                3.0,
                NativeOperationType::Color,
                json!({ "brightness": 8, "contrast": 6, "saturation": 5 }),
            ),
        ],
    }
}

fn operation(
    id: &str,
    time: f64,
    operation_type: NativeOperationType,
    params: Value,
) -> NativeImageOperation {
    NativeImageOperation {
        id: id.into(),
        user_id: "validation".into(),
        time,
        operation_type,
        params,
    }
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1_000.0
}
