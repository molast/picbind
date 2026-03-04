use image::{DynamicImage, ImageFormat};
use imagequant::{Attributes as ImageQuant, RGBA as QuantRgba};
use lodepng::{Encoder as LodePngEncoder, RGBA};
use mozjpeg_rs::{Encoder as MozJpegEncoder, Subsampling};
use wasm_bindgen::prelude::*;

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

struct Candidate {
    bytes: Vec<u8>,
    mime: &'static str,
    ext: &'static str,
}

impl Candidate {
    fn into_result(self) -> CompressionResult {
        CompressionResult {
            bytes: self.bytes,
            mime: self.mime.to_string(),
            ext: self.ext.to_string(),
        }
    }
}

fn original_candidate(input: &[u8], format: ImageFormat) -> Candidate {
    let (mime, ext) = match format {
        ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        ImageFormat::Png => ("image/png", "png"),
        ImageFormat::WebP => ("image/webp", "webp"),
        _ => ("application/octet-stream", "bin"),
    };

    Candidate {
        bytes: input.to_vec(),
        mime,
        ext,
    }
}

fn best_candidate(original: Candidate, candidates: Vec<Candidate>) -> Candidate {
    candidates
        .into_iter()
        .chain(std::iter::once(original))
        .min_by_key(|candidate| candidate.bytes.len())
        .unwrap()
}

fn quality_candidates(quality: u8) -> [u8; 5] {
    [
        quality,
        quality.saturating_sub(5),
        quality.saturating_sub(10),
        quality.saturating_sub(20),
        quality.saturating_sub(30),
    ]
}

fn is_opaque(img: &DynamicImage) -> bool {
    img.to_rgba8().pixels().all(|pixel| pixel[3] == 255)
}

fn encode_jpeg_from_image(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, JsValue> {
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

fn encode_quantized_png_from_image(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, JsValue> {
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

fn encode_candidate_for_format(
    img: &DynamicImage,
    target_format: &str,
    quality: u8,
) -> Result<Candidate, JsValue> {
    match target_format {
        "jpeg" | "jpg" => {
            if !is_opaque(img) {
                return Err(JsValue::from_str(
                    "JPEG target is unavailable because the source image contains transparency",
                ));
            }

            let mut best_bytes: Option<Vec<u8>> = None;
            for candidate_quality in quality_candidates(quality).into_iter().filter(|q| *q >= 35) {
                if let Ok(bytes) = encode_jpeg_from_image(img, candidate_quality) {
                    let should_replace = best_bytes
                        .as_ref()
                        .map(|current| bytes.len() < current.len())
                        .unwrap_or(true);
                    if should_replace {
                        best_bytes = Some(bytes);
                    }
                }
            }

            best_bytes
                .map(|bytes| Candidate {
                    bytes,
                    mime: "image/jpeg",
                    ext: "jpg",
                })
                .ok_or_else(|| JsValue::from_str("JPEG encode failed"))
        }
        "png" => encode_quantized_png_from_image(img, quality).map(|bytes| Candidate {
            bytes,
            mime: "image/png",
            ext: "png",
        }),
        "webp" => Err(JsValue::from_str("WebP compression is handled outside WASM")),
        "avif" => Err(JsValue::from_str(
            "AVIF compression is not supported yet",
        )),
        _ => Err(JsValue::from_str("Unsupported target format")),
    }
}

fn compress_jpeg(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = ImageFormat::Jpeg;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut candidates = Vec::new();

    for candidate_quality in quality_candidates(quality).into_iter().filter(|q| *q >= 35) {
        if let Ok(bytes) = encode_jpeg_from_image(&img, candidate_quality) {
            candidates.push(Candidate {
                bytes,
                mime: "image/jpeg",
                ext: "jpg",
            });
        }
    }

    Ok(best_candidate(original_candidate(input, format), candidates).into_result())
}

fn compress_png(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = ImageFormat::Png;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut candidates = Vec::new();

    if let Ok(bytes) = encode_quantized_png_from_image(&img, quality) {
        candidates.push(Candidate {
            bytes,
            mime: "image/png",
            ext: "png",
        });
    }

    if is_opaque(&img) {
        for candidate_quality in quality_candidates(quality).into_iter().filter(|q| *q >= 35) {
            if let Ok(bytes) = encode_jpeg_from_image(&img, candidate_quality) {
                candidates.push(Candidate {
                    bytes,
                    mime: "image/jpeg",
                    ext: "jpg",
                });
            }
        }
    }

    Ok(best_candidate(original_candidate(input, format), candidates).into_result())
}

#[wasm_bindgen]
pub fn compress_image(input: &[u8], quality: u8) -> Result<CompressionResult, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;

    match format {
        ImageFormat::Jpeg => compress_jpeg(input, quality),
        ImageFormat::Png => compress_png(input, quality),
        ImageFormat::WebP => Ok(original_candidate(input, format).into_result()),
        _ => Ok(original_candidate(input, format).into_result()),
    }
}

#[wasm_bindgen]
pub fn compress_image_to_format(
    input: &[u8],
    quality: u8,
    target_format: &str,
) -> Result<CompressionResult, JsValue> {
    let format = image::guess_format(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let img = image::load_from_memory_with_format(input, format)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let candidate = encode_candidate_for_format(&img, &target_format.to_ascii_lowercase(), quality)?;
    Ok(candidate.into_result())
}
