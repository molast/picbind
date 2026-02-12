use image::{ExtendedColorType, codecs::jpeg::JpegEncoder};
use wasm_bindgen::prelude::*;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
pub fn compress_image(input: &[u8], quality: u8) -> Result<Vec<u8>, JsValue> {
    let img = image::load_from_memory(input).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let rgb_img = img.to_rgb8();
    let (w, h) = rgb_img.dimensions();

    let mut output = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut output, quality);

    encoder
        .encode(&rgb_img, w, h, ExtendedColorType::Rgb8)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(output)
}