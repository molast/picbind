#[cfg(feature = "codecs")]
mod analysis;
#[cfg(feature = "avif-decoder")]
mod avif;
#[cfg(feature = "codecs")]
mod codecs;
#[cfg(feature = "codecs")]
mod decode;
#[cfg(feature = "codecs")]
mod derived;
#[cfg(feature = "codecs")]
mod engine;
mod error;
#[cfg(feature = "codecs")]
mod messaging;
mod model;
#[cfg(feature = "operations")]
mod operations;
#[cfg(feature = "codecs")]
mod planner;
#[cfg(feature = "codecs")]
mod render;
mod task;

#[cfg(feature = "avif-decoder")]
pub use avif::decode_avif;
#[cfg(feature = "codecs")]
pub use decode::{NativeDecodedImage, decode_image};

#[cfg(feature = "codecs")]
pub use analysis::{
    NativeImageAnalysis, NativeImageQualityAnalysis, NativeImageQualityComparison, compare_quality,
    compare_quality_with_control,
};
#[cfg(feature = "codecs")]
pub use derived::{
    NativeShareAssets, NativeSharePlaceholder, create_share_assets,
    create_share_assets_with_control,
};
#[cfg(feature = "codecs")]
pub use engine::{
    encode, encode_auto, encode_auto_planned, encode_auto_planned_with_control,
    encode_auto_with_control, encode_planned, encode_planned_with_control, encode_with_control,
    inspect,
};
pub use error::NativeImageError;
#[cfg(feature = "codecs")]
pub use messaging::{
    NativeMessagingCompressionOptions, compress_for_messaging, compress_for_messaging_with_control,
};
pub use model::{
    MAX_DIMENSION, MAX_INPUT_BYTES, MAX_PIXELS, NativeEncodeOptions, NativeImageDimensions,
    NativeImageFormat, NativeImageMetadata, NativeImageOutput,
};
#[cfg(feature = "operations")]
pub use operations::{
    NativeImageOperation, NativeOperationType, NativeParameterDocument, NativeRenderedImage,
    replay_dynamic_image,
};
#[cfg(feature = "codecs")]
pub use operations::{replay_parameters, replay_parameters_with_control};
#[cfg(feature = "codecs")]
pub use planner::{NativeImageFeatures, predict_format};
#[cfg(feature = "codecs")]
pub use render::{
    NativePreviewOutput, materialize, materialize_with_control, render_preview,
    render_preview_from_decoded_with_control, render_preview_with_control,
};
pub use task::NativeTaskControl;

#[cfg(test)]
mod tests;
