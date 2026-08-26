#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImageAnalysis {
    pub width: u32,
    pub height: u32,
    pub pixel_count: usize,
    pub source_size_bytes: usize,
    pub source_size_mb: f64,
    pub source_format: String,
    pub has_alpha: bool,
    pub has_alpha_channel: bool,
    pub has_real_alpha: bool,
    pub alpha_min: u8,
    pub alpha_max: u8,
    pub alpha_ratio: f64,
    pub transparent_pixel_ratio: f64,
    pub semi_transparent_ratio: f64,
    pub sample_stride: usize,
    pub sample_count: usize,
    pub edge_strength: f64,
    pub brightness_variance: f64,
    pub color_complexity: f64,
    pub color_entropy: f64,
    pub noise_level: f64,
    pub gradient_coverage: f64,
    pub detail_coverage: f64,
    pub flat_coverage: f64,
    pub complexity_score: f64,
    pub compressibility_score: f64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImageQualityComparison {
    pub width: u32,
    pub height: u32,
    pub mse: f64,
    pub rmse: f64,
    pub psnr: f64,
    pub ssim: f64,
    pub ms_ssim: f64,
    pub edge_retention: f64,
    pub blur_loss_percent: f64,
    pub overall_quality_score: f64,
    pub original_edge_energy: f64,
    pub compressed_edge_energy: f64,
    pub original_laplacian_variance: f64,
    pub compressed_laplacian_variance: f64,
    pub mean_delta_e: f64,
    pub p95_delta_e: f64,
    pub p99_delta_e: f64,
    pub p95_masked_delta_e: f64,
    pub p99_masked_delta_e: f64,
    pub p95_luminance_error: f64,
    pub p95_chroma_error: f64,
    pub perceptual_distance: f64,
    pub mean_alpha_error: f64,
    pub p95_alpha_error: f64,
    pub p99_alpha_error: f64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImageQualityAnalysis {
    pub comparison: NativeImageQualityComparison,
    pub source_metrics: NativeImageAnalysis,
    pub assessed_metrics: NativeImageAnalysis,
}
