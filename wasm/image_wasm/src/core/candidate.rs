use image::ImageFormat;

use crate::CompressionResult;

pub struct Candidate {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub ext: &'static str,
}

impl Candidate {
    pub fn into_result(self) -> CompressionResult {
        CompressionResult {
            bytes: self.bytes,
            mime: self.mime.to_string(),
            ext: self.ext.to_string(),
        }
    }
}

pub fn original_candidate(input: &[u8], format: ImageFormat) -> Candidate {
    let (mime, ext) = match format {
        ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        ImageFormat::Png => ("image/png", "png"),
        ImageFormat::WebP => ("image/webp", "webp"),
        ImageFormat::Avif => ("image/avif", "avif"),
        _ => ("application/octet-stream", "bin"),
    };

    Candidate {
        bytes: input.to_vec(),
        mime,
        ext,
    }
}

pub fn best_candidate(original: Candidate, candidates: Vec<Candidate>) -> Candidate {
    candidates
        .into_iter()
        .chain(std::iter::once(original))
        .min_by_key(|candidate| candidate.bytes.len())
        .unwrap()
}
