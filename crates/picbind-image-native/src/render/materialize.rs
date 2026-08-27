use image::GenericImageView;

use crate::{
    NativeImageError, NativeImageFormat, NativeImageOutput, NativeParameterDocument,
    NativeTaskControl, codecs, decode, replay_parameters, replay_parameters_with_control,
};

use super::metadata_for;

pub fn materialize(
    input: &[u8],
    document: &NativeParameterDocument,
    output_format: Option<NativeImageFormat>,
    quality: u8,
    allow_alpha_loss: bool,
) -> Result<NativeImageOutput, NativeImageError> {
    materialize_inner(
        input,
        document,
        output_format,
        quality,
        allow_alpha_loss,
        None,
    )
}

pub fn materialize_with_control(
    input: &[u8],
    document: &NativeParameterDocument,
    output_format: Option<NativeImageFormat>,
    quality: u8,
    allow_alpha_loss: bool,
    control: &NativeTaskControl,
) -> Result<NativeImageOutput, NativeImageError> {
    materialize_inner(
        input,
        document,
        output_format,
        quality,
        allow_alpha_loss,
        Some(control),
    )
}

fn materialize_inner(
    input: &[u8],
    document: &NativeParameterDocument,
    output_format: Option<NativeImageFormat>,
    quality: u8,
    allow_alpha_loss: bool,
    control: Option<&NativeTaskControl>,
) -> Result<NativeImageOutput, NativeImageError> {
    if let Some(control) = control {
        control.checkpoint()?;
    }
    if !(1..=100).contains(&quality) {
        return Err(NativeImageError::InvalidParameters(
            "materialize quality must be between 1 and 100".into(),
        ));
    }
    let (source_format, source) = decode::decode(input)?;
    let format = output_format.unwrap_or(source_format);
    let source_has_alpha = decode::has_transparency(&source);
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
    let rendered = match control {
        Some(control) => replay_parameters_with_control(input, document, control)?,
        None => replay_parameters(input, document)?,
    };
    let image = rendered.into_image();
    let (width, height) = image.dimensions();
    let has_alpha = decode::has_transparency(&image);
    let bytes = codecs::encode(&image, format, quality, allow_alpha_loss)?;
    if let Some(control) = control {
        control.checkpoint()?;
    }
    Ok(NativeImageOutput {
        metadata: metadata_for(width, height, format, bytes.len(), has_alpha),
        bytes,
        returned_original: false,
    })
}
