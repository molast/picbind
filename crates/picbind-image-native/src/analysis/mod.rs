mod features;
mod model;
mod quality;

use crate::{NativeImageError, decode};

pub use model::{NativeImageAnalysis, NativeImageQualityAnalysis, NativeImageQualityComparison};

pub fn compare_quality(
    source: &[u8],
    assessed: &[u8],
) -> Result<NativeImageQualityAnalysis, NativeImageError> {
    let (source_format, source_image) = decode::decode(source)?;
    let (assessed_format, assessed_image) = decode::decode(assessed)?;
    let comparison = quality::compare(&source_image, &assessed_image)?;
    Ok(NativeImageQualityAnalysis {
        comparison,
        source_metrics: features::analyze(&source_image, source.len(), source_format),
        assessed_metrics: features::analyze(&assessed_image, assessed.len(), assessed_format),
    })
}

#[cfg(test)]
mod tests;
