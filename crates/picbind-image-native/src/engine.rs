use crate::{
    NativeEncodeOptions, NativeImageError, NativeImageMetadata, NativeImageOutput, decode, formats,
};

pub fn inspect(input: &[u8]) -> Result<NativeImageMetadata, NativeImageError> {
    let (format, image) = decode::decode(input)?;
    decode::metadata(&image, format, input.len())
}

pub fn encode(
    input: &[u8],
    options: &NativeEncodeOptions,
) -> Result<NativeImageOutput, NativeImageError> {
    let (source_format, image) = decode::decode(input)?;
    let has_alpha = image.to_rgba8().pixels().any(|pixel| pixel[3] < 255);
    if options.format == crate::NativeImageFormat::Jpeg && has_alpha && !options.allow_alpha_loss {
        return Err(NativeImageError::AlphaLossDenied);
    }
    let encoded = formats::encode(
        &image,
        options.format,
        options.effective_quality(),
        options.allow_alpha_loss,
    )?;
    if !options.force_encode && source_format == options.format && encoded.len() >= input.len() {
        return Ok(NativeImageOutput {
            bytes: input.to_vec(),
            metadata: decode::metadata(&image, source_format, input.len())?,
            returned_original: true,
        });
    }
    let metadata = inspect(&encoded)?;
    Ok(NativeImageOutput {
        bytes: encoded,
        metadata,
        returned_original: false,
    })
}
