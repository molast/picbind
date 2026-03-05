use image::DynamicImage;
use imagequant::{Attributes as ImageQuant, RGBA as QuantRgba};
use lodepng::{Encoder as LodePngEncoder, RGBA};
use wasm_bindgen::JsValue;

pub fn encode_quantized_png_from_image(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, JsValue> {
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
        .set_dithering_level(0.0)
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

    encoder
        .encode(&indexed_pixels, width as usize, height as usize)
        .map_err(|e| JsValue::from_str(&format!("PNG encode failed: {}", e)))
}
