use crate::NativeImageFormat;

use super::quality::QualityMetrics;

pub(crate) fn passes(format: NativeImageFormat, metrics: QualityMetrics) -> bool {
    let (minimum_ssim, minimum_psnr, minimum_edge_retention) = match format {
        NativeImageFormat::Jpeg => (0.955, 28.0, 0.72),
        NativeImageFormat::JpegXl => (0.999, 60.0, 0.99),
        NativeImageFormat::Png => (0.985, 32.0, 0.86),
        NativeImageFormat::WebP => (0.960, 29.0, 0.74),
        NativeImageFormat::Avif => (0.955, 22.5, 0.72),
    };
    let alpha_is_preserved = match format {
        NativeImageFormat::Jpeg => true,
        NativeImageFormat::Png | NativeImageFormat::JpegXl => {
            metrics.alpha_mean_error <= 0.1 && metrics.alpha_p95_error <= 1.0
        }
        NativeImageFormat::WebP | NativeImageFormat::Avif => {
            metrics.alpha_mean_error <= 1.0 && metrics.alpha_p95_error <= 3.0
        }
    };
    metrics.ssim >= minimum_ssim
        && metrics.psnr >= minimum_psnr
        && metrics.edge_retention >= minimum_edge_retention
        && alpha_is_preserved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visibly_damaged_candidate_fails() {
        let metrics = QualityMetrics {
            ssim: 0.70,
            psnr: 18.0,
            edge_retention: 0.30,
            alpha_mean_error: 0.0,
            alpha_p95_error: 0.0,
        };
        assert!(!passes(NativeImageFormat::WebP, metrics));
    }
}
