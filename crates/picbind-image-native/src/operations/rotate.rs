use image::DynamicImage;
use serde::Deserialize;
use serde_json::Value;

use crate::NativeImageError;

use super::validation;

#[derive(Deserialize)]
struct RotateParameters {
    degrees: u16,
}

pub(super) fn apply(image: DynamicImage, params: &Value) -> Result<DynamicImage, NativeImageError> {
    let rotation: RotateParameters = validation::parse(params, "rotate")?;
    match rotation.degrees {
        90 => Ok(image.rotate90()),
        180 => Ok(image.rotate180()),
        270 => Ok(image.rotate270()),
        _ => validation::invalid("rotation must be 90, 180 or 270 degrees"),
    }
}
