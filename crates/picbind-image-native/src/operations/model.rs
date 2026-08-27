use image::{DynamicImage, RgbaImage};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::NativeImageFormat;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeParameterDocument {
    pub version: u8,
    pub operations: Vec<NativeImageOperation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImageOperation {
    pub id: String,
    pub user_id: String,
    pub time: f64,
    #[serde(rename = "type")]
    pub operation_type: NativeOperationType,
    pub params: Value,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeOperationType {
    Crop,
    Color,
    Draw,
    Rotate,
    Resize,
    Filter,
    Annotation,
    Ai,
}

#[derive(Clone, Debug)]
pub struct NativeRenderedImage {
    pub(crate) image: DynamicImage,
    pub(crate) source_format: NativeImageFormat,
}

impl NativeRenderedImage {
    pub fn width(&self) -> u32 {
        self.image.width()
    }

    pub fn height(&self) -> u32 {
        self.image.height()
    }

    pub const fn source_format(&self) -> NativeImageFormat {
        self.source_format
    }

    pub fn to_rgba8(&self) -> RgbaImage {
        self.image.to_rgba8()
    }

    pub fn into_image(self) -> DynamicImage {
        self.image
    }
}
