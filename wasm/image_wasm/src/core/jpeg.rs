use image::DynamicImage;
use mozjpeg_rs::{Encoder as MozJpegEncoder, Subsampling};
use wasm_bindgen::JsValue;

pub fn is_opaque(img: &DynamicImage) -> bool {
    img.to_rgba8().pixels().all(|pixel| pixel[3] == 255)
}

pub fn encode_jpeg_from_image(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, JsValue> {
    let rgb_img = img.to_rgb8();
    let (width, height) = rgb_img.dimensions();
    let raw_pixels = rgb_img.as_raw();

    MozJpegEncoder::max_compression()
        .quality(quality)
        .progressive(true)
        .subsampling(Subsampling::S420)
        .optimize_huffman(true)
        .encode_rgb(raw_pixels, width, height)
        .map_err(|e| JsValue::from_str(&format!("JPEG encode failed: {}", e)))
}
