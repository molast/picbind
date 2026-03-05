mod auto;
mod to_format;

use wasm_bindgen::JsValue;

use crate::CompressionResult;

pub fn compress_image(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    auto::compress_image_auto(input, quality)
}

pub fn compress_image_to_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
) -> Result<CompressionResult, JsValue> {
    to_format::compress_image_to_target_format(input, quality, target_format)
}
