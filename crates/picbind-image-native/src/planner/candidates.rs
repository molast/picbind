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
    options: &NativeEncodeOptions,
    control: Option<&NativeTaskControl>,
) -> Result<Vec<u8>, NativeImageError> {
    let qualities = candidate_qualities(options.format, options.effective_quality());
    let candidates = collect_candidates(&qualities, |quality| {
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
    });
    if let Some(control) = control {
        control.checkpoint()?;
    }
    select_smallest(candidates)
        .map(|candidate| candidate.bytes)
        .ok_or_else(|| {
            NativeImageError::EncodeFailed(format!(
                "no {:?} candidate passed the native quality guardrails",
                options.format
            ))
        })
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

#[cfg(test)]
mod tests {
    use crate::NativeImageError;

    use super::{PassingCandidate, collect_candidates, select_smallest};

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
}
