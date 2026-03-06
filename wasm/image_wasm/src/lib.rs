use wasm_bindgen::prelude::*;

mod core;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
pub struct CompressionResult {
    bytes: Vec<u8>,
    mime: String,
    ext: String,
}

#[wasm_bindgen]
impl CompressionResult {
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn mime(&self) -> String {
        self.mime.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn ext(&self) -> String {
        self.ext.clone()
    }
}

#[wasm_bindgen]
pub fn compress_image(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    core::pipeline::compress_image(input, quality)
}

#[wasm_bindgen]
pub fn compress_image_to_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
) -> Result<CompressionResult, JsValue> {
    core::pipeline::compress_image_to_format(input, quality, target_format)
}

#[wasm_bindgen]
pub fn compress_image_to_format_with_options(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
) -> Result<CompressionResult, JsValue> {
    core::pipeline::compress_image_to_format_with_options(
        input,
        quality,
        target_format,
        allow_alpha_loss,
    )
}
