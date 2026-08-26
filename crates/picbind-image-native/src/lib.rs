mod decode;
mod engine;
mod error;
mod formats;
mod model;

pub use engine::{encode, inspect};
pub use error::NativeImageError;
pub use model::{
    MAX_INPUT_BYTES, MAX_PIXELS, NativeEncodeOptions, NativeImageFormat, NativeImageMetadata,
    NativeImageOutput,
};

#[cfg(test)]
mod tests;
