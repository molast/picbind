mod materialize;
mod preview;

use crate::NativeImageMetadata;

pub use materialize::materialize;
pub use preview::render_preview;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativePreviewOutput {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn metadata_for(
    width: u32,
    height: u32,
    format: crate::NativeImageFormat,
    size_bytes: usize,
    has_alpha: bool,
) -> NativeImageMetadata {
    NativeImageMetadata {
        width,
        height,
        format,
        mime_type: format.mime_type(),
        size_bytes,
        has_alpha,
    }
}

#[cfg(test)]
mod tests;
