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
    encode_jpeg_from_rgb_image_with_subsampling(rgb_img, quality, None)
}

pub fn encode_jpeg_from_rgb_image_with_subsampling(
    rgb_img: &RgbImage,
    quality: u8,
    source_subsampling: Option<Subsampling>,
) -> Result<Vec<u8>, JsValue> {
    let (width, height) = rgb_img.dimensions();
    let raw_pixels = rgb_img.as_raw();
    let subsampling = source_subsampling.unwrap_or({
        if quality >= 96 {
            Subsampling::S444
        } else if quality >= 90 {
            Subsampling::S422
        } else {
            Subsampling::S420
        }
    });

    MozJpegEncoder::new(Preset::ProgressiveBalanced)
        .quality(quality)
        .progressive(true)
        .subsampling(subsampling)
        .optimize_huffman(true)
        .encode_rgb(raw_pixels, width, height)
        .map_err(|e| JsValue::from_str(&format!("JPEG encode failed: {}", e)))
}

pub fn jpeg_subsampling(input: &[u8]) -> Option<Subsampling> {
    if input.len() < 4 || input[0..2] != [0xff, 0xd8] {
        return None;
    }

    let mut offset = 2usize;
    while offset + 1 < input.len() {
        while offset < input.len() && input[offset] != 0xff {
            offset += 1;
        }
        while offset < input.len() && input[offset] == 0xff {
            offset += 1;
        }
        if offset >= input.len() {
            break;
        }

        let marker = input[offset];
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        if offset + 2 > input.len() {
            break;
        }

        let segment_len = u16::from_be_bytes([input[offset], input[offset + 1]]) as usize;
        if segment_len < 2 || offset + segment_len > input.len() {
            break;
        }

        let is_start_of_frame = matches!(
            marker,
            0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
        );
        if is_start_of_frame && segment_len >= 11 {
            let component_count = input[offset + 7] as usize;
            if component_count < 3 || segment_len < 8 + component_count * 3 {
                return None;
            }
            let sampling = input[offset + 9];
            return match (sampling >> 4, sampling & 0x0f) {
                (1, 1) => Some(Subsampling::S444),
                (2, 1) => Some(Subsampling::S422),
                (2, 2) => Some(Subsampling::S420),
                (1, 2) => Some(Subsampling::S440),
                _ => None,
            };
        }

        offset += segment_len;
    }

    None
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

#[cfg(test)]
mod tests {
    use mozjpeg_rs::Subsampling;

    use super::jpeg_subsampling;

    fn jpeg_with_sampling(sampling: u8) -> Vec<u8> {
        vec![
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, sampling,
            0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
        ]
    }

    #[test]
    fn reads_common_jpeg_chroma_subsampling() {
        assert_eq!(
            jpeg_subsampling(&jpeg_with_sampling(0x11)),
            Some(Subsampling::S444)
        );
        assert_eq!(
            jpeg_subsampling(&jpeg_with_sampling(0x21)),
            Some(Subsampling::S422)
        );
        assert_eq!(
            jpeg_subsampling(&jpeg_with_sampling(0x22)),
            Some(Subsampling::S420)
        );
    }
}
