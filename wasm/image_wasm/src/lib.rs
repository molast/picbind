use image::ImageFormat;
use imagequant::{Attributes as ImageQuant, RGBA as QuantRgba};
use lodepng::{Encoder as LodePngEncoder, RGBA};
use mozjpeg_rs::{Encoder as MozJpegEncoder, Subsampling};
use wasm_bindgen::prelude::*;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

fn compress_jpeg(input: &[u8], quality: u8) -> Result<Vec<u8>, JsValue> {
    let img = image::load_from_memory_with_format(input, ImageFormat::Jpeg)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let rgb_img = img.to_rgb8();
    let (width, height) = rgb_img.dimensions();
    let raw_pixels = rgb_img.as_raw();

    let compressed = MozJpegEncoder::max_compression()
        .quality(quality)
        .progressive(true)
        .subsampling(Subsampling::S420)
        .optimize_huffman(true)
        .encode_rgb(raw_pixels, width, height)
        .map_err(|e| JsValue::from_str(&format!("JPEG encode failed: {}", e)))?;

    // If recompression grows the payload, keep the original bytes.
    if compressed.len() >= input.len() {
        Ok(input.to_vec())
    } else {
        Ok(compressed)
    }
}

fn compress_png(input: &[u8], quality: u8) -> Result<Vec<u8>, JsValue> {
    let img = image::load_from_memory_with_format(input, ImageFormat::Png)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut attr = ImageQuant::new();
    attr.set_max_colors(256)
        .map_err(|e| JsValue::from_str(&format!("PNG quantization setup failed: {}", e)))?;
    attr.set_quality(0, quality.clamp(1, 100))
        .map_err(|e| JsValue::from_str(&format!("PNG quality setup failed: {}", e)))?;

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
        .map_err(|e| JsValue::from_str(&format!("PNG quantization image creation failed: {}", e)))?;
    let mut quant_result = attr
        .quantize(&mut quant_image)
        .map_err(|e| JsValue::from_str(&format!("PNG quantization failed: {}", e)))?;
    quant_result
        .set_dithering_level(1.0)
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

    let compressed = encoder
        .encode(&indexed_pixels, width as usize, height as usize)
        .map_err(|e| JsValue::from_str(&format!("PNG encode failed: {}", e)))?;

    // If recompression grows the payload, keep the original bytes.
    if compressed.len() >= input.len() {
        Ok(input.to_vec())
    } else {
        Ok(compressed)
    }
}

fn compress_webp(input: &[u8], _quality: u8) -> Result<Vec<u8>, JsValue> {
    Ok(input.to_vec())
}

#[wasm_bindgen]
pub fn compress_image(input: &[u8], quality: u8) -> Result<Vec<u8>, JsValue> {
    let format =
        image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;

    match format {
        ImageFormat::Jpeg => compress_jpeg(input, quality),
        ImageFormat::Png => compress_png(input, quality),
        ImageFormat::WebP => compress_webp(input, quality),
        _ => Ok(input.to_vec()),
    }
}
