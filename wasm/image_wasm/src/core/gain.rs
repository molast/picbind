pub const DEFAULT_COMPRESSION_GAIN: f64 = 1.0;
pub const MIN_COMPRESSION_GAIN: f64 = 0.5;
pub const MAX_COMPRESSION_GAIN: f64 = 2.0;

pub fn normalize_compression_gain(gain: f64) -> f64 {
    if gain.is_finite() {
        gain.clamp(MIN_COMPRESSION_GAIN, MAX_COMPRESSION_GAIN)
    } else {
        DEFAULT_COMPRESSION_GAIN
    }
}

pub fn amplify_quality_loss(quality: u8, gain: f64, floor: u8) -> u8 {
    let gain = normalize_compression_gain(gain);
    let loss = (100.0 - f64::from(quality)) * gain;
    (100.0 - loss).round().clamp(f64::from(floor), 100.0) as u8
}

pub fn amplify_max_error(value: f64, gain: f64) -> f64 {
    value * normalize_compression_gain(gain)
}

pub fn amplify_min_similarity(value: f64, gain: f64) -> f64 {
    (1.0 - (1.0 - value) * normalize_compression_gain(gain)).clamp(0.0, 1.0)
}

pub fn amplify_palette_budget(colors: u32, gain: f64) -> u32 {
    let gain = normalize_compression_gain(gain);
    (f64::from(colors) / gain.sqrt()).round().clamp(16.0, 256.0) as u32
}

#[cfg(test)]
mod tests {
    use super::{
        amplify_max_error, amplify_min_similarity, amplify_palette_budget, amplify_quality_loss,
    };

    #[test]
    fn unity_gain_is_an_identity() {
        assert_eq!(amplify_quality_loss(80, 1.0, 20), 80);
        assert_eq!(amplify_max_error(3.5, 1.0), 3.5);
        assert_eq!(amplify_min_similarity(0.98, 1.0), 0.98);
        assert_eq!(amplify_palette_budget(256, 1.0), 256);
    }

    #[test]
    fn stronger_gain_monotonically_increases_compression_amplitude() {
        assert!(amplify_quality_loss(80, 1.5, 20) < 80);
        assert!(amplify_max_error(3.5, 1.5) > 3.5);
        assert!(amplify_min_similarity(0.98, 1.5) < 0.98);
        assert!(amplify_palette_budget(256, 1.5) < 256);
    }

    #[test]
    fn gain_is_bounded() {
        assert_eq!(amplify_quality_loss(80, 10.0, 20), 60);
        assert_eq!(amplify_quality_loss(80, 0.1, 20), 90);
    }
}
