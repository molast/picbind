use std::num::NonZeroU64;

use crc32fast::Hasher;
use miniz_oxide::inflate::decompress_to_vec_zlib;
use zopfli::{Format, Options};

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

pub fn recompress_png_idat(input: &[u8]) -> Option<Vec<u8>> {
    if input.len() < PNG_SIGNATURE.len() || &input[..8] != PNG_SIGNATURE {
        return None;
    }

    let chunks = parse_chunks(input)?;
    let mut compressed_idat = Vec::new();
    for chunk in &chunks {
        if chunk.kind == *b"IDAT" {
            compressed_idat.extend_from_slice(chunk.data);
        }
    }
    if compressed_idat.is_empty() {
        return None;
    }

    let filtered_pixels = decompress_to_vec_zlib(&compressed_idat).ok()?;

    let iterations = if filtered_pixels.len() >= 2 * 1024 * 1024 {
        5
    } else {
        10
    };
    let options = Options {
        iteration_count: NonZeroU64::new(iterations).unwrap(),
        iterations_without_improvement: NonZeroU64::new(3).unwrap(),
        maximum_block_splits: 15,
    };
    let mut optimized_idat = Vec::with_capacity(compressed_idat.len());
    zopfli::compress(
        options,
        Format::Zlib,
        filtered_pixels.as_slice(),
        &mut optimized_idat,
    )
    .ok()?;

    if optimized_idat.len() >= compressed_idat.len() {
        return None;
    }

    let mut output = Vec::with_capacity(input.len() - compressed_idat.len() + optimized_idat.len());
    output.extend_from_slice(PNG_SIGNATURE);
    let mut wrote_idat = false;
    for chunk in chunks {
        if chunk.kind == *b"IDAT" {
            if !wrote_idat {
                write_chunk(&mut output, b"IDAT", &optimized_idat);
                wrote_idat = true;
            }
            continue;
        }
        output.extend_from_slice(chunk.raw);
    }
    (output.len() < input.len()).then_some(output)
}

struct PngChunk<'a> {
    kind: [u8; 4],
    data: &'a [u8],
    raw: &'a [u8],
}

fn parse_chunks(input: &[u8]) -> Option<Vec<PngChunk<'_>>> {
    let mut chunks = Vec::new();
    let mut offset = PNG_SIGNATURE.len();
    while offset.checked_add(12)? <= input.len() {
        let start = offset;
        let length = u32::from_be_bytes(input[offset..offset + 4].try_into().ok()?) as usize;
        let kind: [u8; 4] = input[offset + 4..offset + 8].try_into().ok()?;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(length)?;
        let end = data_end.checked_add(4)?;
        if end > input.len() {
            return None;
        }
        chunks.push(PngChunk {
            kind,
            data: &input[data_start..data_end],
            raw: &input[start..end],
        });
        offset = end;
        if kind == *b"IEND" {
            return Some(chunks);
        }
    }
    None
}

fn write_chunk(output: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    output.extend_from_slice(&(data.len() as u32).to_be_bytes());
    output.extend_from_slice(kind);
    output.extend_from_slice(data);
    let mut crc = Hasher::new();
    crc.update(kind);
    crc.update(data);
    output.extend_from_slice(&crc.finalize().to_be_bytes());
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, Rgba, RgbaImage};

    use super::recompress_png_idat;

    #[test]
    fn zopfli_output_decodes_to_identical_pixels() {
        let mut image = RgbaImage::new(128, 128);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = Rgba([(x / 8) as u8, (y / 8) as u8, ((x + y) / 16) as u8, 255]);
        }
        let encoded = crate::core::png::encode_quantized_png_with_options(
            &DynamicImage::ImageRgba8(image),
            64,
            100,
            0.0,
            4,
        )
        .unwrap();
        if let Some(optimized) = recompress_png_idat(&encoded) {
            let before = image::load_from_memory(&encoded).unwrap().to_rgba8();
            let after = image::load_from_memory(&optimized).unwrap().to_rgba8();
            assert_eq!(before, after);
            assert!(optimized.len() < encoded.len());
        }
    }
}
