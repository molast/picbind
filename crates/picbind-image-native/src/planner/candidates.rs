use image::DynamicImage;

use crate::{
    NativeEncodeOptions, NativeImageError, NativeImageFormat, NativeTaskControl, decode, formats,
};

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
    if options.format == NativeImageFormat::Avif {
        let rgba = source.to_rgba8();
        if source_format != NativeImageFormat::Avif {
            if let Some(control) = control {
                control.checkpoint()?;
            }
            return crate::formats::avif::encode_rgba(&rgba, options.effective_quality());
        }

        let mut qualities = candidate_qualities(options.format, options.effective_quality());
        qualities.sort_unstable();
        return first_passing_candidate(&qualities, |quality| {
            encode_avif_candidate(source, &rgba, quality, control)
        })
        .map(|candidate| candidate.bytes)
        .ok_or_else(|| no_passing_candidate(options.format));
    }

    let qualities = candidate_qualities(options.format, options.effective_quality());
    let candidates = collect_candidates(&qualities, |quality| {
        encode_candidate(source, options, quality, control)
    });
    if let Some(control) = control {
        control.checkpoint()?;
    }
    select_smallest(candidates)
        .map(|candidate| candidate.bytes)
        .ok_or_else(|| no_passing_candidate(options.format))
}

fn encode_candidate(
    source: &DynamicImage,
    options: &NativeEncodeOptions,
    quality: u8,
    control: Option<&NativeTaskControl>,
) -> Result<Option<PassingCandidate>, NativeImageError> {
    if let Some(control) = control {
        control.checkpoint()?;
    }
    let bytes = formats::encode(source, options.format, quality, options.allow_alpha_loss)?;
    let (decoded_format, decoded) = decode::decode(&bytes)?;
    if decoded_format != options.format {
        return Err(NativeImageError::EncodeFailed(
            "candidate output format does not match the requested format".into(),
        ));
    }
    let metrics = quality::compare(source, &decoded)?;
    if !guardrails::passes(options.format, metrics) {
        return Ok(None);
    }
    Ok(Some(PassingCandidate { bytes }))
}

fn encode_avif_candidate(
    source: &DynamicImage,
    rgba: &image::RgbaImage,
    quality: u8,
    control: Option<&NativeTaskControl>,
) -> Result<Option<PassingCandidate>, NativeImageError> {
    if let Some(control) = control {
        control.checkpoint()?;
    }
    let bytes = crate::formats::avif::encode_rgba(rgba, quality)?;
    let decoded = std::panic::catch_unwind(|| decode::decode(&bytes))
        .map_err(|_| NativeImageError::InvalidImage("AVIF decoder panicked".into()))??;
    if decoded.0 != NativeImageFormat::Avif {
        return Err(NativeImageError::EncodeFailed(
            "candidate output format does not match the requested format".into(),
        ));
    }
    let metrics = quality::compare(source, &decoded.1)?;
    if !guardrails::passes(NativeImageFormat::Avif, metrics) {
        return Ok(None);
    }
    Ok(Some(PassingCandidate { bytes }))
}

fn no_passing_candidate(format: NativeImageFormat) -> NativeImageError {
    NativeImageError::EncodeFailed(format!(
        "no {format:?} candidate passed the native quality guardrails"
    ))
}

fn select_smallest<T>(candidates: Vec<T>) -> Option<T>
where
    T: AsRef<[u8]>,
{
    candidates
        .into_iter()
        .min_by_key(|candidate| candidate.as_ref().len())
}

impl AsRef<[u8]> for PassingCandidate {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}

fn candidate_qualities(format: NativeImageFormat, base: u8) -> Vec<u8> {
    let minimum = match format {
        NativeImageFormat::Png => 50,
        NativeImageFormat::Jpeg | NativeImageFormat::WebP | NativeImageFormat::Avif => 45,
    };
    let mut qualities = [base.saturating_add(8), base, base.saturating_sub(8)]
        .into_iter()
        .map(|quality| quality.clamp(minimum, 100))
        .collect::<Vec<_>>();
    qualities.dedup();
    qualities
}

fn collect_candidates<T, F>(qualities: &[u8], mut encode: F) -> Vec<T>
where
    F: FnMut(u8) -> Result<Option<T>, NativeImageError>,
{
    qualities
        .iter()
        .filter_map(|quality| encode(*quality).ok().flatten())
        .collect()
}

fn first_passing_candidate<T, F>(qualities: &[u8], mut encode: F) -> Option<T>
where
    F: FnMut(u8) -> Result<Option<T>, NativeImageError>,
{
    qualities
        .iter()
        .find_map(|quality| encode(*quality).ok().flatten())
}

#[cfg(test)]
mod tests {
    use crate::NativeImageError;

    use super::{PassingCandidate, collect_candidates, first_passing_candidate, select_smallest};

    #[test]
    fn a_failed_candidate_does_not_discard_later_successes() {
        let candidates = collect_candidates(&[90, 80, 70], |quality| match quality {
            90 => Err(NativeImageError::EncodeFailed("expected failure".into())),
            80 => Ok(None),
            _ => Ok(Some(PassingCandidate { bytes: vec![1] })),
        });
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].bytes, vec![1]);
    }

    #[test]
    fn the_smallest_passing_candidate_wins() {
        let selected = select_smallest(vec![
            PassingCandidate { bytes: vec![1; 9] },
            PassingCandidate { bytes: vec![2; 4] },
            PassingCandidate { bytes: vec![3; 7] },
        ])
        .unwrap();
        assert_eq!(selected.bytes, vec![2; 4]);
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
        .unwrap();
        assert_eq!(visited, vec![72, 80]);
        assert_eq!(selected.bytes, vec![2]);
    }
}
