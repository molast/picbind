use image::{DynamicImage, GenericImageView};
use serde::Deserialize;
use serde_json::Value;

use crate::NativeImageError;

use super::validation;

#[derive(Deserialize)]
struct CropParameters {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

pub(super) fn apply(image: DynamicImage, params: &Value) -> Result<DynamicImage, NativeImageError> {
    let crop: CropParameters = validation::parse(params, "crop")?;
    if ![crop.x, crop.y, crop.width, crop.height]
        .into_iter()
        .all(f64::is_finite)
        || crop.x < 0.0
        || crop.y < 0.0
        || crop.width <= 0.0
        || crop.height <= 0.0
        || crop.x + crop.width > 1.0
        || crop.y + crop.height > 1.0
    {
        return validation::invalid("crop bounds must be normalized inside the current image");
    }
    let (width, height) = image.dimensions();
    let x = ((crop.x * f64::from(width)).round() as u32).min(width - 1);
    let y = ((crop.y * f64::from(height)).round() as u32).min(height - 1);
    let target_width = ((crop.width * f64::from(width)).round() as u32)
        .max(1)
        .min(width - x);
    let target_height = ((crop.height * f64::from(height)).round() as u32)
        .max(1)
        .min(height - y);
    Ok(image.crop_imm(x, y, target_width, target_height))
}
