use crate::{
    NativeEncodeOptions, NativeImageError, NativeImageMetadata, NativeImageOutput,
    NativeTaskControl, decode, formats,
};

pub fn inspect(input: &[u8]) -> Result<NativeImageMetadata, NativeImageError> {
    let (format, image) = decode::decode(input)?;
    decode::metadata(&image, format, input.len())
}

pub fn encode(
    input: &[u8],
    options: &NativeEncodeOptions,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(input, options, Target::Fixed, Strategy::Interactive, None)
}

pub fn encode_with_control(
    input: &[u8],
    options: &NativeEncodeOptions,
    control: &NativeTaskControl,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(
        input,
        options,
        Target::Fixed,
        Strategy::Interactive,
        Some(control),
    )
}

pub fn encode_auto(
    input: &[u8],
    options: &NativeEncodeOptions,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(input, options, Target::Auto, Strategy::Interactive, None)
}

pub fn encode_auto_with_control(
    input: &[u8],
    options: &NativeEncodeOptions,
    control: &NativeTaskControl,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(
        input,
        options,
        Target::Auto,
        Strategy::Interactive,
        Some(control),
    )
}

pub fn encode_planned(
    input: &[u8],
    options: &NativeEncodeOptions,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(input, options, Target::Fixed, Strategy::Planner, None)
}

pub fn encode_planned_with_control(
    input: &[u8],
    options: &NativeEncodeOptions,
    control: &NativeTaskControl,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(
        input,
        options,
        Target::Fixed,
        Strategy::Planner,
        Some(control),
    )
}

pub fn encode_auto_planned(
    input: &[u8],
    options: &NativeEncodeOptions,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(input, options, Target::Auto, Strategy::Planner, None)
}

pub fn encode_auto_planned_with_control(
    input: &[u8],
    options: &NativeEncodeOptions,
    control: &NativeTaskControl,
) -> Result<NativeImageOutput, NativeImageError> {
    encode_with(
        input,
        options,
        Target::Auto,
        Strategy::Planner,
        Some(control),
    )
}

#[derive(Clone, Copy)]
enum Target {
    Fixed,
    Auto,
}

#[derive(Clone, Copy)]
enum Strategy {
    Interactive,
    Planner,
}

fn encode_with(
    input: &[u8],
    options: &NativeEncodeOptions,
    target: Target,
    strategy: Strategy,
    control: Option<&NativeTaskControl>,
) -> Result<NativeImageOutput, NativeImageError> {
    checkpoint(control)?;
    if matches!(strategy, Strategy::Planner) && options.dimensions.is_some() {
        return Err(NativeImageError::InvalidDimensions(
            "planner compression does not accept resize dimensions".into(),
        ));
    }
    let (source_format, source_image) = decode::decode(input)?;
    checkpoint(control)?;
    let (image, dimensions_changed) = crate::resize::apply(source_image, options.dimensions)?;
    checkpoint(control)?;
    let mut selected = options.clone();
    if matches!(target, Target::Auto) {
        selected.format = crate::planner::predict_format(&image);
    }
    let has_alpha = decode::has_transparency(&image);
    if selected.format == crate::NativeImageFormat::Jpeg && has_alpha && !selected.allow_alpha_loss
    {
        return Err(NativeImageError::AlphaLossDenied);
    }

    let encoded = match strategy {
        Strategy::Interactive => formats::encode(
            &image,
            selected.format,
            selected.effective_quality(),
            selected.allow_alpha_loss,
        ),
        Strategy::Planner => {
            crate::planner::encode_best_candidate(&image, source_format, &selected, control)
        }
    };
    checkpoint(control)?;
    let encoded = match encoded {
        Ok(candidate) => candidate,
        Err(_)
            if matches!(strategy, Strategy::Planner)
                && !dimensions_changed
                && !selected.force_encode
                && source_format == selected.format =>
        {
            return original_output(input, &image, source_format);
        }
        Err(error) => return Err(error),
    };
    if !dimensions_changed
        && !selected.force_encode
        && source_format == selected.format
        && encoded.len() >= input.len()
    {
        return original_output(input, &image, source_format);
    }
    let metadata = if selected.format == crate::NativeImageFormat::Avif {
        NativeImageMetadata {
            width: image.width(),
            height: image.height(),
            format: selected.format,
            mime_type: selected.format.mime_type(),
            size_bytes: encoded.len(),
            has_alpha,
        }
    } else {
        inspect(&encoded)?
    };
    Ok(NativeImageOutput {
        bytes: encoded,
        metadata,
        returned_original: false,
    })
}

fn checkpoint(control: Option<&NativeTaskControl>) -> Result<(), NativeImageError> {
    control.map_or(Ok(()), NativeTaskControl::checkpoint)
}

fn original_output(
    input: &[u8],
    image: &image::DynamicImage,
    source_format: crate::NativeImageFormat,
) -> Result<NativeImageOutput, NativeImageError> {
    Ok(NativeImageOutput {
        bytes: input.to_vec(),
        metadata: decode::metadata(image, source_format, input.len())?,
        returned_original: true,
    })
}
