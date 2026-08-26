mod features;
mod model;
mod quality;

use crate::{NativeImageError, NativeTaskControl, decode};

pub use model::{NativeImageAnalysis, NativeImageQualityAnalysis, NativeImageQualityComparison};

pub fn compare_quality(
    source: &[u8],
    assessed: &[u8],
) -> Result<NativeImageQualityAnalysis, NativeImageError> {
    compare_quality_inner(source, assessed, None)
}

pub fn compare_quality_with_control(
    source: &[u8],
    assessed: &[u8],
    control: &NativeTaskControl,
) -> Result<NativeImageQualityAnalysis, NativeImageError> {
    compare_quality_inner(source, assessed, Some(control))
}

fn compare_quality_inner(
    source: &[u8],
    assessed: &[u8],
    control: Option<&NativeTaskControl>,
) -> Result<NativeImageQualityAnalysis, NativeImageError> {
    checkpoint(control)?;
    let (source_format, source_image) = decode::decode(source)?;
    checkpoint(control)?;
    let (assessed_format, assessed_image) = decode::decode(assessed)?;
    checkpoint(control)?;
    let comparison = quality::compare(&source_image, &assessed_image)?;
    checkpoint(control)?;
    let source_metrics = features::analyze(&source_image, source.len(), source_format);
    checkpoint(control)?;
    let assessed_metrics = features::analyze(&assessed_image, assessed.len(), assessed_format);
    checkpoint(control)?;
    Ok(NativeImageQualityAnalysis {
        comparison,
        source_metrics,
        assessed_metrics,
    })
}

fn checkpoint(control: Option<&NativeTaskControl>) -> Result<(), NativeImageError> {
    control.map_or(Ok(()), NativeTaskControl::checkpoint)
}

#[cfg(test)]
mod tests;
