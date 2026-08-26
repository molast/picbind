mod candidates;
mod features;
mod guardrails;
mod quality;

use image::DynamicImage;

use crate::NativeImageFormat;

pub use features::NativeImageFeatures;

pub(crate) use candidates::encode_best_candidate;

pub fn predict_format(image: &DynamicImage) -> NativeImageFormat {
    predict_from_features(&NativeImageFeatures::extract(image))
}

fn predict_from_features(features: &NativeImageFeatures) -> NativeImageFormat {
    if features.has_alpha {
        if features.flat_coverage >= 0.55 && features.color_entropy <= 0.45 {
            NativeImageFormat::Png
        } else if features.detail_coverage >= 0.40 {
            NativeImageFormat::WebP
        } else {
            NativeImageFormat::Avif
        }
    } else if features.flat_coverage >= 0.58 && features.color_entropy <= 0.42 {
        NativeImageFormat::Png
    } else if features.detail_coverage >= 0.18 || features.color_entropy >= 0.50 {
        NativeImageFormat::Avif
    } else {
        NativeImageFormat::WebP
    }
}

#[cfg(test)]
mod tests;
