use image::GenericImageView;

use crate::{
    NativeImageError, NativeImageFormat, NativeImageOutput, NativeParameterDocument, decode,
    formats, replay_parameters,
};

use super::metadata_for;

pub fn materialize(
    input: &[u8],
    document: &NativeParameterDocument,
    output_format: Option<NativeImageFormat>,
    quality: u8,
    allow_alpha_loss: bool,
) -> Result<NativeImageOutput, NativeImageError> {
    if !(1..=100).contains(&quality) {
        return Err(NativeImageError::InvalidParameters(
            "materialize quality must be between 1 and 100".into(),
        ));
    }
    let (source_format, source) = decode::decode(input)?;
    let format = output_format.unwrap_or(source_format);
    let source_has_alpha = source.to_rgba8().pixels().any(|pixel| pixel[3] < 255);
    if format == NativeImageFormat::Jpeg && source_has_alpha && !allow_alpha_loss {
        return Err(NativeImageError::AlphaLossDenied);
    }
    if document.operations.is_empty() && format == source_format {
        let (width, height) = source.dimensions();
        return Ok(NativeImageOutput {
            bytes: input.to_vec(),
            metadata: metadata_for(width, height, format, input.len(), source_has_alpha),
            returned_original: true,
        });
    }
    let rendered = replay_parameters(input, document)?;
    let image = rendered.into_image();
    let (width, height) = image.dimensions();
    let has_alpha = image.to_rgba8().pixels().any(|pixel| pixel[3] < 255);
    let bytes = formats::encode(&image, format, quality, allow_alpha_loss)?;
    Ok(NativeImageOutput {
        metadata: metadata_for(width, height, format, bytes.len(), has_alpha),
        bytes,
        returned_original: false,
    })
}
