use image::codecs::ico::IcoEncoder;
use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{ColorType, DynamicImage, GenericImageView, ImageEncoder, ImageFormat};
use js_sys::{Array, Reflect, Uint8Array};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

mod core;
mod share_placeholder;

pub const MAX_INPUT_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_INPUT_MB_TEXT: &str = "5 MB";
const MAX_SHARE_IMAGE_BYTES: usize = 50 * 1024 * 1024;
const MAX_SHARE_THUMBNAIL_BYTES: usize = 10 * 1024;
const MAX_AVIF_INTERMEDIATE_BYTES: usize = 128 * 1024 * 1024;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

pub fn ensure_input_size_limit(input: &[u8]) -> Result<(), JsValue> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(JsValue::from_str(&format!(
            "Each image must be {} or smaller",
            MAX_INPUT_MB_TEXT
        )));
    }
    Ok(())
}

fn ensure_avif_intermediate_size_limit(input: &[u8]) -> Result<(), JsValue> {
    if input.len() > MAX_AVIF_INTERMEDIATE_BYTES {
        return Err(JsValue::from_str(
            "Decoded AVIF intermediate exceeds 128 MB",
        ));
    }
    Ok(())
}

fn rgba_image_from_bytes(
    input: &[u8],
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, JsValue> {
    ensure_avif_intermediate_size_limit(input)?;
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| JsValue::from_str("RGBA dimensions overflow"))?;
    if input.len() != expected_len {
        return Err(JsValue::from_str(
            "RGBA byte length does not match dimensions",
        ));
    }
    image::RgbaImage::from_raw(width, height, input.to_vec())
        .ok_or_else(|| JsValue::from_str("Invalid RGBA image"))
}

#[wasm_bindgen]
pub struct CompressionResult {
    pub(crate) bytes: Vec<u8>,
    pub(crate) mime: String,
    pub(crate) ext: String,
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
    ensure_input_size_limit(input)?;
    core::pipeline::compress_image(input, quality)
}

#[wasm_bindgen]
pub fn compress_png_with_deflate(
    input: &[u8],
    compression_level: u8,
) -> Result<CompressionResult, JsValue> {
    ensure_input_size_limit(input)?;
    core::pipeline::compress_png_with_deflate(input, compression_level)
}

#[wasm_bindgen]
pub fn compress_image_to_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
) -> Result<CompressionResult, JsValue> {
    ensure_input_size_limit(input)?;
    core::pipeline::compress_image_to_format(input, quality, target_format)
}

#[wasm_bindgen]
pub fn compress_image_to_format_with_options(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
) -> Result<CompressionResult, JsValue> {
    ensure_input_size_limit(input)?;
    core::pipeline::compress_image_to_format_with_options(
        input,
        quality,
        target_format,
        allow_alpha_loss,
    )
}

#[wasm_bindgen]
pub fn compress_rgba_to_png(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    source_size_bytes: usize,
) -> Result<CompressionResult, JsValue> {
    let img = DynamicImage::ImageRgba8(rgba_image_from_bytes(rgba, width, height)?);
    core::pipeline::compress_dynamic_image_to_png(&img, quality, source_size_bytes)
}

#[wasm_bindgen]
pub fn compress_rgba_to_png_with_gain(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    source_size_bytes: usize,
    compression_gain: f64,
) -> Result<CompressionResult, JsValue> {
    let img = DynamicImage::ImageRgba8(rgba_image_from_bytes(rgba, width, height)?);
    core::pipeline::compress_dynamic_image_to_png_with_gain(
        &img,
        quality,
        source_size_bytes,
        compression_gain,
    )
}

#[wasm_bindgen]
pub fn compress_image_to_format_with_plan_options(
    input: &[u8],
    quality: u8,
    target_format: &str,
    allow_alpha_loss: bool,
    compression_gain: f64,
) -> Result<CompressionResult, JsValue> {
    ensure_input_size_limit(input)?;
    core::pipeline::compress_image_to_format_with_plan_options(
        input,
        quality,
        target_format,
        allow_alpha_loss,
        compression_gain,
    )
}

#[wasm_bindgen]
pub fn create_zip_from_items(items: Array) -> Result<Vec<u8>, JsValue> {
    let mut entries = Vec::with_capacity(items.length() as usize);

    for item in items.iter() {
        let name = Reflect::get(&item, &JsValue::from_str("name"))
            .map_err(|_| JsValue::from_str("Invalid zip item: missing name"))?
            .as_string()
            .ok_or_else(|| JsValue::from_str("Invalid zip item: name must be string"))?;
        let bytes_value = Reflect::get(&item, &JsValue::from_str("bytes"))
            .map_err(|_| JsValue::from_str("Invalid zip item: missing bytes"))?;
        let bytes = Uint8Array::new(&bytes_value).to_vec();

        entries.push(core::zip::ZipEntry { name, data: bytes });
    }

    core::zip::create_zip(entries).map_err(|message| JsValue::from_str(&message))
}

#[wasm_bindgen]
pub fn compare_image_quality(
    original_input: &[u8],
    compressed_input: &[u8],
) -> Result<JsValue, JsValue> {
    ensure_input_size_limit(original_input)?;
    ensure_input_size_limit(compressed_input)?;
    core::metrics::compare_image_quality(original_input, compressed_input)?.to_js_value()
}

#[wasm_bindgen]
pub fn compare_image_quality_for_guardrails(
    original_input: &[u8],
    compressed_input: &[u8],
) -> Result<JsValue, JsValue> {
    ensure_input_size_limit(original_input)?;
    ensure_input_size_limit(compressed_input)?;
    core::metrics::compare_image_quality_for_guardrails(original_input, compressed_input)?
        .to_js_value()
}

#[wasm_bindgen]
pub fn calculate_image_quality_score(
    original_input: &[u8],
    assessed_input: &[u8],
) -> Result<JsValue, JsValue> {
    ensure_input_size_limit(original_input)?;
    ensure_input_size_limit(assessed_input)?;
    core::metrics::calculate_image_quality_score(original_input, assessed_input)?.to_js_value()
}

#[wasm_bindgen]
pub fn analyze_image_metrics(input: &[u8]) -> Result<JsValue, JsValue> {
    ensure_input_size_limit(input)?;
    core::analysis::analyze_image_metrics(input)?.to_js_value()
}

#[wasm_bindgen]
pub fn create_avif_encoding_plan(
    input: &[u8],
    quality: u8,
    source_size_bytes: usize,
) -> Result<JsValue, JsValue> {
    ensure_avif_intermediate_size_limit(input)?;
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    core::quality::avif_encoding_plan(&img, quality, source_size_bytes).to_js_value()
}

#[wasm_bindgen]
pub fn compare_avif_candidate_quality(
    original_input: &[u8],
    candidate_input: &[u8],
) -> Result<JsValue, JsValue> {
    ensure_avif_intermediate_size_limit(original_input)?;
    ensure_avif_intermediate_size_limit(candidate_input)?;
    core::metrics::compare_image_quality_for_guardrails(original_input, candidate_input)?
        .to_js_value()
}

#[wasm_bindgen]
pub fn create_avif_encoding_plan_rgba(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    source_size_bytes: usize,
) -> Result<JsValue, JsValue> {
    let img = DynamicImage::ImageRgba8(rgba_image_from_bytes(rgba, width, height)?);
    core::quality::avif_encoding_plan(&img, quality, source_size_bytes).to_js_value()
}

#[wasm_bindgen]
pub fn create_avif_encoding_plan_rgba_with_gain(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    source_size_bytes: usize,
    compression_gain: f64,
) -> Result<JsValue, JsValue> {
    let img = DynamicImage::ImageRgba8(rgba_image_from_bytes(rgba, width, height)?);
    core::quality::avif_encoding_plan_with_gain(&img, quality, source_size_bytes, compression_gain)
        .to_js_value()
}

#[wasm_bindgen]
pub fn compare_avif_candidate_rgba(
    original_rgba: &[u8],
    candidate_rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<JsValue, JsValue> {
    let original = DynamicImage::ImageRgba8(rgba_image_from_bytes(original_rgba, width, height)?);
    let candidate = DynamicImage::ImageRgba8(rgba_image_from_bytes(candidate_rgba, width, height)?);
    let max_edge = width.max(height);
    let (original, candidate) = if max_edge > 1920 {
        let scale = 1920.0 / max_edge as f64;
        let target_width = ((width as f64 * scale).round() as u32).max(1);
        let target_height = ((height as f64 * scale).round() as u32).max(1);
        (
            original.resize_exact(target_width, target_height, FilterType::Triangle),
            candidate.resize_exact(target_width, target_height, FilterType::Triangle),
        )
    } else {
        (original, candidate)
    };
    core::metrics::compare_dynamic_images_for_guardrails(&original, &candidate)?.to_js_value()
}

fn square_crop(img: DynamicImage) -> DynamicImage {
    let (width, height) = img.dimensions();
    if width == height {
        return img;
    }

    let edge = width.min(height);
    let crop_x = (width.saturating_sub(edge)) / 2;
    let crop_y = (height.saturating_sub(edge)) / 2;
    img.crop_imm(crop_x, crop_y, edge, edge)
}

fn encode_png(img: &DynamicImage) -> Result<Vec<u8>, JsValue> {
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|err| JsValue::from_str(&format!("PNG encode failed: {err}")))?;
    Ok(out)
}

fn generate_png_size(base: &DynamicImage, size: u32) -> Result<Vec<u8>, JsValue> {
    let resized = base.resize_exact(size, size, FilterType::Lanczos3);
    encode_png(&resized)
}

#[wasm_bindgen]
pub fn generate_share_thumbnail(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    if input.len() > MAX_SHARE_IMAGE_BYTES {
        return Err(JsValue::from_str("Share image must be 50 MB or smaller"));
    }
    let decoded = image::load_from_memory(input)
        .map_err(|err| JsValue::from_str(&format!("Thumbnail decode failed: {err}")))?;
    generate_png_size(&square_crop(decoded), 32)
}

fn encode_webp(img: &DynamicImage) -> Result<Vec<u8>, JsValue> {
    let rgba = img.to_rgba8();
    let mut out = Vec::new();
    WebPEncoder::new_lossless(&mut out)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|err| JsValue::from_str(&format!("WebP encode failed: {err}")))?;
    Ok(out)
}

#[wasm_bindgen]
pub fn generate_share_preview_thumbnail(
    input: &[u8],
    container_width: u32,
    container_height: u32,
) -> Result<Vec<u8>, JsValue> {
    if input.len() > MAX_SHARE_IMAGE_BYTES {
        return Err(JsValue::from_str("Share image must be 50 MB or smaller"));
    }
    if container_width == 0 || container_height == 0 {
        return Err(JsValue::from_str("Thumbnail dimensions must be positive"));
    }

    let decoded = image::load_from_memory(input)
        .map_err(|err| JsValue::from_str(&format!("Thumbnail decode failed: {err}")))?;
    generate_share_preview_thumbnail_from_image(decoded, container_width, container_height)
}

fn generate_share_preview_thumbnail_from_image(
    decoded: DynamicImage,
    container_width: u32,
    container_height: u32,
) -> Result<Vec<u8>, JsValue> {
    let mut width = container_width.min(2048);
    let mut height = container_height.min(2048);

    loop {
        let resized = decoded.resize_to_fill(width, height, FilterType::Triangle);
        let encoded = encode_webp(&resized)?;
        if encoded.len() <= MAX_SHARE_THUMBNAIL_BYTES || (width == 1 && height == 1) {
            return Ok(encoded);
        }
        width = (width.saturating_mul(4) / 5).max(1);
        height = (height.saturating_mul(4) / 5).max(1);
    }
}

#[wasm_bindgen]
pub fn generate_share_preview_thumbnail_from_rgba(
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<Vec<u8>, JsValue> {
    if width == 0 || height == 0 || width > 2048 || height > 2048 {
        return Err(JsValue::from_str("Invalid RGBA thumbnail dimensions"));
    }
    let expected_len = usize::try_from(width)
        .ok()
        .and_then(|value| value.checked_mul(usize::try_from(height).ok()?))
        .and_then(|value| value.checked_mul(4))
        .ok_or_else(|| JsValue::from_str("RGBA thumbnail dimensions overflow"))?;
    if rgba.len() != expected_len {
        return Err(JsValue::from_str("Invalid RGBA thumbnail data"));
    }
    let image = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| JsValue::from_str("Could not create RGBA thumbnail"))?;
    generate_share_preview_thumbnail_from_image(DynamicImage::ImageRgba8(image), width, height)
}

#[wasm_bindgen]
pub fn generate_share_placeholder(input: &[u8]) -> Result<js_sys::Object, JsValue> {
    if input.len() > MAX_SHARE_IMAGE_BYTES {
        return Err(JsValue::from_str("Share image must be 50 MB or smaller"));
    }
    let decoded = image::load_from_memory(input)
        .map_err(|err| JsValue::from_str(&format!("Placeholder decode failed: {err}")))?;
    placeholder_to_js(share_placeholder::generate(&decoded))
}

fn placeholder_to_js(
    placeholder: share_placeholder::SharePlaceholder,
) -> Result<js_sys::Object, JsValue> {
    let output = js_sys::Object::new();
    Reflect::set(
        &output,
        &JsValue::from_str("width"),
        &JsValue::from_f64(f64::from(placeholder.width)),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("height"),
        &JsValue::from_f64(f64::from(placeholder.height)),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("dominantColor"),
        &JsValue::from_str(&placeholder.dominant_color),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("blurHash"),
        &JsValue::from_str(&placeholder.blur_hash),
    )?;
    Ok(output)
}

#[wasm_bindgen]
pub fn generate_share_placeholder_from_rgba(
    width: u32,
    height: u32,
    sample_width: u32,
    sample_height: u32,
    rgba: &[u8],
) -> Result<js_sys::Object, JsValue> {
    let placeholder = share_placeholder::generate_from_rgba_sample(
        width,
        height,
        sample_width,
        sample_height,
        rgba,
    )
    .map_err(|message| JsValue::from_str(&message))?;
    placeholder_to_js(placeholder)
}

fn generate_ico(base: &DynamicImage) -> Result<Vec<u8>, JsValue> {
    let resized = base.resize_exact(32, 32, FilterType::Lanczos3).to_rgba8();
    let mut out = Vec::new();
    IcoEncoder::new(&mut out)
        .write_image(
            resized.as_raw(),
            resized.width(),
            resized.height(),
            ColorType::Rgba8.into(),
        )
        .map_err(|err| JsValue::from_str(&format!("ICO encode failed: {err}")))?;
    Ok(out)
}

#[wasm_bindgen]
pub fn generate_favicon(input: &[u8]) -> Result<js_sys::Object, JsValue> {
    ensure_input_size_limit(input)?;
    let decoded = image::load_from_memory(input)
        .map_err(|err| JsValue::from_str(&format!("Decode failed: {err}")))?;
    let square = square_crop(decoded);

    let favicon16 = generate_png_size(&square, 16)?;
    let favicon32 = generate_png_size(&square, 32)?;
    let apple = generate_png_size(&square, 180)?;
    let android192 = generate_png_size(&square, 192)?;
    let android512 = generate_png_size(&square, 512)?;
    let ico = generate_ico(&square)?;

    let output = js_sys::Object::new();
    Reflect::set(
        &output,
        &JsValue::from_str("favicon16"),
        &Uint8Array::from(favicon16.as_slice()).into(),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("favicon32"),
        &Uint8Array::from(favicon32.as_slice()).into(),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("apple"),
        &Uint8Array::from(apple.as_slice()).into(),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("android192"),
        &Uint8Array::from(android192.as_slice()).into(),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("android512"),
        &Uint8Array::from(android512.as_slice()).into(),
    )?;
    Reflect::set(
        &output,
        &JsValue::from_str("ico"),
        &Uint8Array::from(ico.as_slice()).into(),
    )?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_thumbnail_is_a_32_pixel_png() {
        let source = DynamicImage::new_rgba8(80, 40);
        let input = encode_png(&source).expect("encode source");
        let thumbnail = generate_share_thumbnail(&input).expect("generate thumbnail");
        let decoded = image::load_from_memory_with_format(&thumbnail, ImageFormat::Png)
            .expect("decode thumbnail");

        assert_eq!(decoded.dimensions(), (32, 32));
    }

    #[test]
    fn share_preview_thumbnail_is_webp_and_under_ten_kib() {
        let source = DynamicImage::new_rgba8(800, 600);
        let input = encode_png(&source).expect("encode source");
        let thumbnail =
            generate_share_preview_thumbnail(&input, 320, 240).expect("generate preview thumbnail");
        let decoded = image::load_from_memory_with_format(&thumbnail, ImageFormat::WebP)
            .expect("decode WebP thumbnail");

        assert!(thumbnail.len() <= MAX_SHARE_THUMBNAIL_BYTES);
        assert_eq!(decoded.dimensions(), (320, 240));
    }
}
