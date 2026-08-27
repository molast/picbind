use std::borrow::Cow;

use image::{DynamicImage, RgbaImage};

use crate::{NativeEncodeOptions, NativeImageError, NativeImageFormat, NativeTaskControl, decode};

use super::{guardrails, quality};

struct PassingCandidate {
    bytes: Vec<u8>,
}

pub(crate) fn encode_best_candidate(
    source: &DynamicImage,
    source_format: NativeImageFormat,
    options: &NativeEncodeOptions,
    control: Option<&NativeTaskControl>,
) -> Result<Vec<u8>, NativeImageError> {
    if source_format != options.format
        || matches!(
            options.format,
            NativeImageFormat::WebP | NativeImageFormat::JpegXl
        )
    {
        return encode_single_candidate(source, options, control);
    }

    let qualities = candidate_qualities(options.format, options.effective_quality());
    let candidate = match options.format {
        NativeImageFormat::Jpeg => {
            let pixels = crate::codecs::jpeg::PreparedJpegPixels::from_image(
                source,
                &crate::codecs::jpeg::encoder::JpegEncoderOptions::new(
                    options.effective_quality(),
                    options.allow_alpha_loss,
                ),
            )?;
            first_passing_candidate(&qualities, |quality| {
                checkpoint(control)?;
                let bytes = pixels.encode(quality)?;
                evaluate_candidate(source, options.format, bytes)
            })?
        }
        NativeImageFormat::JpegXl => unreachable!("JPEG XL planner uses the single-candidate path"),
        NativeImageFormat::Png => {
            let rgba = rgba_pixels(source);
            first_passing_candidate(&qualities, |quality| {
                checkpoint(control)?;
                let bytes = crate::codecs::png::encode_quantized_rgba(rgba.as_ref(), quality)?;
                evaluate_candidate(source, options.format, bytes)
            })?
        }
        NativeImageFormat::Avif => {
            let pixels = crate::codecs::avif::PreparedAvifPixels::from_image(source)?;
            first_passing_candidate(&qualities, |quality| {
                checkpoint(control)?;
                let bytes = pixels.encode(quality)?;
                evaluate_candidate(source, options.format, bytes)
            })?
        }
        NativeImageFormat::WebP => unreachable!("WebP planner uses the single-candidate path"),
    };
    checkpoint(control)?;
    candidate
        .map(|candidate| candidate.bytes)
        .ok_or_else(|| no_passing_candidate(options.format))
}

fn encode_single_candidate(
    source: &DynamicImage,
    options: &NativeEncodeOptions,
    control: Option<&NativeTaskControl>,
) -> Result<Vec<u8>, NativeImageError> {
    checkpoint(control)?;
    let quality = options.effective_quality();
    match options.format {
        NativeImageFormat::Jpeg => {
            let pixels = crate::codecs::jpeg::PreparedJpegPixels::from_image(
                source,
                &crate::codecs::jpeg::encoder::JpegEncoderOptions::new(
                    quality,
                    options.allow_alpha_loss,
                ),
            )?;
            pixels.encode(quality)
        }
        NativeImageFormat::JpegXl => crate::codecs::jpeg_xl::encode(source, quality),
        NativeImageFormat::Png => {
            let rgba = rgba_pixels(source);
            crate::codecs::png::encode_quantized_rgba(rgba.as_ref(), quality)
        }
        NativeImageFormat::WebP => crate::codecs::webp::encode(source, quality),
        NativeImageFormat::Avif => {
            crate::codecs::avif::PreparedAvifPixels::from_image(source)?.encode(quality)
        }
    }
}

fn evaluate_candidate(
    source: &DynamicImage,
    format: NativeImageFormat,
    bytes: Vec<u8>,
) -> Result<Option<PassingCandidate>, NativeImageError> {
    let decoded = if format == NativeImageFormat::Avif {
        std::panic::catch_unwind(|| decode::decode(&bytes))
            .map_err(|_| NativeImageError::InvalidImage("AVIF decoder panicked".into()))??
    } else {
        decode::decode(&bytes)?
    };
    if decoded.0 != format {
        return Err(NativeImageError::EncodeFailed(
            "candidate output format does not match the requested format".into(),
        ));
    }
    let metrics = quality::compare(source, &decoded.1)?;
    if !guardrails::passes(format, metrics) {
        return Ok(None);
    }
    Ok(Some(PassingCandidate { bytes }))
}

fn rgba_pixels(source: &DynamicImage) -> Cow<'_, RgbaImage> {
    match source.as_rgba8() {
        Some(rgba) => Cow::Borrowed(rgba),
        None => Cow::Owned(source.to_rgba8()),
    }
}

fn checkpoint(control: Option<&NativeTaskControl>) -> Result<(), NativeImageError> {
    control.map_or(Ok(()), NativeTaskControl::checkpoint)
}

fn no_passing_candidate(format: NativeImageFormat) -> NativeImageError {
    NativeImageError::EncodeFailed(format!(
        "no {format:?} candidate passed the native quality guardrails"
    ))
}

fn candidate_qualities(format: NativeImageFormat, base: u8) -> Vec<u8> {
    let minimum = match format {
        NativeImageFormat::Png => 50,
        NativeImageFormat::Jpeg | NativeImageFormat::WebP | NativeImageFormat::Avif => 45,
        NativeImageFormat::JpegXl => 100,
    };
    let mut qualities = [base.saturating_add(8), base, base.saturating_sub(8)]
        .into_iter()
        .map(|quality| quality.clamp(minimum, 100))
        .collect::<Vec<_>>();
    qualities.sort_unstable();
    qualities.dedup();
    qualities
}

fn first_passing_candidate<T, F>(
    qualities: &[u8],
    mut encode: F,
) -> Result<Option<T>, NativeImageError>
where
    F: FnMut(u8) -> Result<Option<T>, NativeImageError>,
{
    for quality in qualities {
        match encode(*quality) {
            Ok(Some(candidate)) => return Ok(Some(candidate)),
            Ok(None)
            | Err(NativeImageError::EncodeFailed(_))
            | Err(NativeImageError::InvalidImage(_)) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use crate::NativeImageError;

    use super::{PassingCandidate, candidate_qualities, first_passing_candidate};

    #[test]
    fn a_failed_candidate_does_not_discard_later_successes() {
        let selected = first_passing_candidate(&[90, 80, 70], |quality| match quality {
            90 => Err(NativeImageError::EncodeFailed("expected failure".into())),
            80 => Ok(None),
            _ => Ok(Some(PassingCandidate { bytes: vec![1] })),
        })
        .unwrap()
        .unwrap();
        assert_eq!(selected.bytes, vec![1]);
    }

    #[test]
    fn candidate_qualities_are_lowest_first_and_unique() {
        assert_eq!(
            candidate_qualities(crate::NativeImageFormat::Png, 80),
            [72, 80, 88]
        );
        assert_eq!(
            candidate_qualities(crate::NativeImageFormat::Avif, 100),
            [92, 100]
        );
    }

    #[test]
    fn avif_search_stops_at_the_first_passing_candidate() {
        let mut visited = Vec::new();
        let selected = first_passing_candidate(&[72, 80, 88], |quality| {
            visited.push(quality);
            match quality {
                72 => Err(NativeImageError::EncodeFailed("expected failure".into())),
                80 => Ok(Some(PassingCandidate { bytes: vec![2] })),
                _ => panic!("search continued after a passing AVIF candidate"),
            }
        })
        .unwrap()
        .unwrap();
        assert_eq!(visited, vec![72, 80]);
        assert_eq!(selected.bytes, vec![2]);
    }

    #[test]
    fn cancellation_is_not_treated_as_a_failed_candidate() {
        let mut visited = Vec::new();
        let result = first_passing_candidate::<PassingCandidate, _>(&[72, 80], |quality| {
            visited.push(quality);
            Err(NativeImageError::Cancelled)
        });
        assert!(matches!(result, Err(NativeImageError::Cancelled)));
        assert_eq!(visited, vec![72]);
    }
}
