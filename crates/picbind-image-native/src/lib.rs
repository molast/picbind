mod decode;
mod engine;
mod error;
mod formats;
mod model;
mod planner;
mod resize;

pub use engine::{encode, encode_auto, encode_auto_planned, encode_planned, inspect};
pub use error::NativeImageError;
pub use model::{
    MAX_DIMENSION, MAX_INPUT_BYTES, MAX_PIXELS, NativeEncodeOptions, NativeImageDimensions,
    NativeImageFormat, NativeImageMetadata, NativeImageOutput,
};
pub use planner::{NativeImageFeatures, predict_format};

#[cfg(test)]
mod tests;
