use std::fmt::{self, Display};

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum NativeImageError {
    Cancelled,
    InputTooLarge,
    InvalidImage(String),
    UnsupportedFormat(String),
    AlphaLossDenied,
    InvalidDimensions(String),
    InvalidParameters(String),
    UnsupportedOperation(String),
    EncodeFailed(String),
}

impl Display for NativeImageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("Image processing was cancelled"),
            Self::InputTooLarge => formatter.write_str("Image exceeds the native input limit"),
            Self::InvalidImage(message) => write!(formatter, "Invalid image: {message}"),
            Self::UnsupportedFormat(format) => write!(formatter, "Unsupported format: {format}"),
            Self::AlphaLossDenied => formatter.write_str("JPEG output would discard transparency"),
            Self::InvalidDimensions(message) => write!(formatter, "Invalid dimensions: {message}"),
            Self::InvalidParameters(message) => write!(formatter, "Invalid parameters: {message}"),
            Self::UnsupportedOperation(operation) => {
                write!(formatter, "Unsupported image operation: {operation}")
            }
            Self::EncodeFailed(message) => write!(formatter, "Image encoding failed: {message}"),
        }
    }
}

impl std::error::Error for NativeImageError {}
