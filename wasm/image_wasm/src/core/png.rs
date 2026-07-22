use image::{DynamicImage, GenericImageView, imageops::FilterType};
use imagequant::{Attributes as ImageQuant, RGBA as QuantRgba};
use lodepng::{Encoder as LodePngEncoder, FilterStrategy, RGBA};
use wasm_bindgen::JsValue;

pub fn encode_deflated_png_from_image(
    img: &DynamicImage,
    compression_level: u8,
) -> Result<Vec<u8>, JsValue> {
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut encoder = LodePngEncoder::new();
    encoder.set_auto_convert(true);
    encoder.set_filter_strategy(FilterStrategy::BRUTE_FORCE, false);
    encoder.settings_mut().set_level(compression_level.min(9));
    encoder
        .encode(rgba.as_raw(), width as usize, height as usize)
        .map_err(|e| JsValue::from_str(&format!("PNG deflate encode failed: {}", e)))
}

pub fn encode_quantized_png_from_image(
    img: &DynamicImage,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    encode_quantized_png_with_options(img, 256, quality, 0.0, 4)
}

pub fn encode_quantized_png_with_options(
    img: &DynamicImage,
    max_colors: u32,
    quality: u8,
    dithering_level: f32,
    speed: i32,
) -> Result<Vec<u8>, JsValue> {
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut attr = ImageQuant::new();
    attr.set_max_colors(max_colors.clamp(2, 256))
        .map_err(|e| JsValue::from_str(&format!("PNG quantization setup failed: {}", e)))?;
    attr.set_quality(0, quality.clamp(1, 100))
        .map_err(|e| JsValue::from_str(&format!("PNG quality setup failed: {}", e)))?;
    attr.set_speed(speed.clamp(1, 10))
        .map_err(|e| JsValue::from_str(&format!("PNG speed setup failed: {}", e)))?;

    let pixels: Vec<QuantRgba> = rgba
        .pixels()
        .map(|pixel| QuantRgba {
            r: pixel[0],
            g: pixel[1],
            b: pixel[2],
            a: pixel[3],
        })
        .collect();

    let mut quant_image = attr
        .new_image(pixels, width as usize, height as usize, 0.0)
        .map_err(|e| {
            JsValue::from_str(&format!("PNG quantization image creation failed: {}", e))
        })?;
    let mut quant_result = attr
        .quantize(&mut quant_image)
        .map_err(|e| JsValue::from_str(&format!("PNG quantization failed: {}", e)))?;
    quant_result
        .set_dithering_level(dithering_level.clamp(0.0, 1.0))
        .map_err(|e| JsValue::from_str(&format!("PNG dithering setup failed: {}", e)))?;

    let (palette, indexed_pixels) = quant_result
        .remapped(&mut quant_image)
        .map_err(|e| JsValue::from_str(&format!("PNG palette remap failed: {}", e)))?;

    let lode_palette: Vec<RGBA> = palette
        .into_iter()
        .map(|color| RGBA::new(color.r, color.g, color.b, color.a))
        .collect();

    let mut encoder = LodePngEncoder::new();
    encoder.set_auto_convert(false);
    encoder
        .set_palette(&lode_palette)
        .map_err(|e| JsValue::from_str(&format!("PNG palette encode setup failed: {}", e)))?;
    encoder.set_filter_strategy(FilterStrategy::MINSUM, true);
    encoder.settings_mut().set_level(9);

    encoder
        .encode(&indexed_pixels, width as usize, height as usize)
        .map_err(|e| JsValue::from_str(&format!("PNG encode failed: {}", e)))
}

pub fn encode_sampled_quantized_png_from_image(
    img: &DynamicImage,
    max_colors: u32,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    const MAX_SAMPLE_PIXELS: u64 = 1_000_000;
    const UNMAPPED: u16 = u16::MAX;

    let (width, height) = img.dimensions();
    let pixel_count = u64::from(width) * u64::from(height);
    let sample = if pixel_count > MAX_SAMPLE_PIXELS {
        let scale = (MAX_SAMPLE_PIXELS as f64 / pixel_count as f64).sqrt();
        let sample_width = ((width as f64 * scale).round() as u32).max(1);
        let sample_height = ((height as f64 * scale).round() as u32).max(1);
        img.resize_exact(sample_width, sample_height, FilterType::Triangle)
    } else {
        img.clone()
    };
    let opaque_rgb = img.as_rgb8().is_some()
        || img
            .as_rgba8()
            .map(|rgba| rgba.pixels().all(|pixel| pixel[3] == 255))
            .unwrap_or(false);
    let (sample_pixels, sample_width, sample_height): (Vec<QuantRgba>, usize, usize) = if opaque_rgb
    {
        let rgb = sample.to_rgb8();
        (
            rgb.pixels()
                .map(|pixel| QuantRgba {
                    r: pixel[0],
                    g: pixel[1],
                    b: pixel[2],
                    a: 255,
                })
                .collect(),
            rgb.width() as usize,
            rgb.height() as usize,
        )
    } else {
        let rgba = sample.to_rgba8();
        (
            rgba.pixels()
                .map(|pixel| QuantRgba {
                    r: pixel[0],
                    g: pixel[1],
                    b: pixel[2],
                    a: pixel[3],
                })
                .collect(),
            rgba.width() as usize,
            rgba.height() as usize,
        )
    };

    let mut attr = ImageQuant::new();
    attr.set_max_colors(max_colors.clamp(2, 256))
        .map_err(|e| JsValue::from_str(&format!("PNG quantization setup failed: {}", e)))?;
    attr.set_quality(0, quality.clamp(1, 100))
        .map_err(|e| JsValue::from_str(&format!("PNG quality setup failed: {}", e)))?;
    attr.set_speed(6)
        .map_err(|e| JsValue::from_str(&format!("PNG speed setup failed: {}", e)))?;

    let mut quant_image = attr
        .new_image(sample_pixels, sample_width, sample_height, 0.0)
        .map_err(|e| {
            JsValue::from_str(&format!("PNG quantization image creation failed: {}", e))
        })?;
    let mut quant_result = attr
        .quantize(&mut quant_image)
        .map_err(|e| JsValue::from_str(&format!("PNG quantization failed: {}", e)))?;
    quant_result
        .set_dithering_level(0.0)
        .map_err(|e| JsValue::from_str(&format!("PNG dithering setup failed: {}", e)))?;
    let (palette, _) = quant_result
        .remapped(&mut quant_image)
        .map_err(|e| JsValue::from_str(&format!("PNG palette remap failed: {}", e)))?;

    let bucket_count = if opaque_rgb {
        32 * 32 * 32
    } else {
        32 * 32 * 32 * 16
    };
    let mut bucket_palette = vec![UNMAPPED; bucket_count];
    let mut indexed_pixels = Vec::with_capacity(pixel_count as usize);
    for (_, _, pixel) in img.pixels() {
        let bucket = if opaque_rgb {
            ((((pixel[0] as usize) >> 3) * 32 + ((pixel[1] as usize) >> 3)) * 32)
                + ((pixel[2] as usize) >> 3)
        } else {
            (((((pixel[3] as usize) >> 4) * 32 + ((pixel[0] as usize) >> 3)) * 32
                + ((pixel[1] as usize) >> 3))
                * 32)
                + ((pixel[2] as usize) >> 3)
        };
        let cached = bucket_palette[bucket];
        let palette_index = if cached != UNMAPPED {
            cached as usize
        } else {
            let mut best_index = 0usize;
            let mut best_distance = u64::MAX;
            for (index, color) in palette.iter().enumerate() {
                let dr = i64::from(pixel[0]) - i64::from(color.r);
                let dg = i64::from(pixel[1]) - i64::from(color.g);
                let db = i64::from(pixel[2]) - i64::from(color.b);
                let alpha_distance = if opaque_rgb {
                    0
                } else {
                    let da = i64::from(pixel[3]) - i64::from(color.a);
                    8 * da * da
                };
                let distance = (2 * dr * dr + 4 * dg * dg + 3 * db * db + alpha_distance) as u64;
                if distance < best_distance {
                    best_distance = distance;
                    best_index = index;
                }
            }
            bucket_palette[bucket] = best_index as u16;
            best_index
        };
        indexed_pixels.push(palette_index as u8);
    }

    let lode_palette: Vec<RGBA> = palette
        .into_iter()
        .map(|color| RGBA::new(color.r, color.g, color.b, color.a))
        .collect();
    let mut encoder = LodePngEncoder::new();
    encoder.set_auto_convert(false);
    encoder
        .set_palette(&lode_palette)
        .map_err(|e| JsValue::from_str(&format!("PNG palette encode setup failed: {}", e)))?;
    encoder.set_filter_strategy(FilterStrategy::MINSUM, true);
    encoder.settings_mut().set_level(9);
    encoder
        .encode(&indexed_pixels, width as usize, height as usize)
        .map_err(|e| JsValue::from_str(&format!("PNG encode failed: {}", e)))
}
