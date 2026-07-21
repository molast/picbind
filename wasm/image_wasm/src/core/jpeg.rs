use image::{DynamicImage, RgbImage};
use mozjpeg_rs::{Encoder as MozJpegEncoder, Preset, Subsampling};
use wasm_bindgen::JsValue;

pub fn is_opaque(img: &DynamicImage) -> bool {
    img.to_rgba8().pixels().all(|pixel| pixel[3] == 255)
}

pub fn encode_jpeg_from_image(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, JsValue> {
    let rgb_img = img.to_rgb8();
    encode_jpeg_from_rgb_image(&rgb_img, quality)
}

pub fn encode_jpeg_from_rgb_image(rgb_img: &RgbImage, quality: u8) -> Result<Vec<u8>, JsValue> {
    let (width, height) = rgb_img.dimensions();
    let raw_pixels = rgb_img.as_raw();
    let subsampling = if quality >= 96 {
        Subsampling::S444
    } else if quality >= 90 {
        Subsampling::S422
    } else {
        Subsampling::S420
    };

    MozJpegEncoder::new(Preset::ProgressiveBalanced)
        .quality(quality)
        .progressive(true)
        .subsampling(subsampling)
        .optimize_huffman(true)
        .encode_rgb(raw_pixels, width, height)
        .map_err(|e| JsValue::from_str(&format!("JPEG encode failed: {}", e)))
}

pub fn encode_jpeg_from_image_with_white_background(
    img: &DynamicImage,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgb = RgbImage::new(width, height);

    for (x, y, pixel) in rgba.enumerate_pixels() {
        let a = pixel[3] as u16;
        let r = ((pixel[0] as u16 * a + 255u16 * (255 - a)) / 255) as u8;
        let g = ((pixel[1] as u16 * a + 255u16 * (255 - a)) / 255) as u8;
        let b = ((pixel[2] as u16 * a + 255u16 * (255 - a)) / 255) as u8;
        rgb.put_pixel(x, y, image::Rgb([r, g, b]));
    }

    encode_jpeg_from_rgb_image(&rgb, quality)
}
