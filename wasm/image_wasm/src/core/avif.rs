use image::RgbaImage;
use ravif::{
    BitDepth as RavifBitDepth, Encoder as RavifEncoder, Img as RavifImg, RGBA8 as RavifRgba8,
};
use wasm_bindgen::JsValue;

pub fn is_opaque_rgba(rgba: &RgbaImage) -> bool {
    rgba.pixels().all(|pixel| pixel[3] == 255)
}

pub fn rgba_to_ravif_pixels(rgba: &RgbaImage) -> Vec<RavifRgba8> {
    rgba.pixels()
        .map(|pixel| RavifRgba8::new(pixel[0], pixel[1], pixel[2], pixel[3]))
        .collect()
}

pub fn encode_avif_from_pixels(
    pixels: &[RavifRgba8],
    width: usize,
    height: usize,
    quality: u8,
    alpha_quality: u8,
    speed: u8,
    bit_depth: RavifBitDepth,
) -> Result<Vec<u8>, JsValue> {
    let ravif_img = RavifImg::new(pixels, width, height);
    let encoded = RavifEncoder::new()
        .with_quality(quality.clamp(1, 100) as f32)
        .with_alpha_quality(alpha_quality.clamp(1, 100) as f32)
        .with_speed(speed)
        .with_bit_depth(bit_depth)
        .encode_rgba(ravif_img)
        .map_err(|e| JsValue::from_str(&format!("AVIF encode failed: {}", e)))?;

    Ok(encoded.avif_file)
}
