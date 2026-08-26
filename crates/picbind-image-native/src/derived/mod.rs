mod placeholder;
mod thumbnail;

use crate::{
    NativeImageDimensions, NativeImageError, NativeParameterDocument, NativeTaskControl,
    replay_parameters, replay_parameters_with_control,
};

pub use placeholder::NativeSharePlaceholder;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeShareAssets {
    pub placeholder: NativeSharePlaceholder,
    pub thumbnail: Vec<u8>,
}

pub fn create_share_assets(
    input: &[u8],
    document: Option<&NativeParameterDocument>,
    container: NativeImageDimensions,
) -> Result<NativeShareAssets, NativeImageError> {
    create_share_assets_inner(input, document, container, None)
}

pub fn create_share_assets_with_control(
    input: &[u8],
    document: Option<&NativeParameterDocument>,
    container: NativeImageDimensions,
    control: &NativeTaskControl,
) -> Result<NativeShareAssets, NativeImageError> {
    create_share_assets_inner(input, document, container, Some(control))
}

fn create_share_assets_inner(
    input: &[u8],
    document: Option<&NativeParameterDocument>,
    container: NativeImageDimensions,
    control: Option<&NativeTaskControl>,
) -> Result<NativeShareAssets, NativeImageError> {
    if let Some(control) = control {
        control.checkpoint()?;
    }
    thumbnail::validate_container(container)?;
    let image = match document {
        Some(document) => match control {
            Some(control) => replay_parameters_with_control(input, document, control)?.into_image(),
            None => replay_parameters(input, document)?.into_image(),
        },
        None => crate::decode::decode(input)?.1,
    };
    if let Some(control) = control {
        control.checkpoint()?;
    }
    let placeholder = placeholder::generate(&image);
    if let Some(control) = control {
        control.checkpoint()?;
    }
    let thumbnail = thumbnail::generate(&image, container)?;
    if let Some(control) = control {
        control.checkpoint()?;
    }
    Ok(NativeShareAssets {
        placeholder,
        thumbnail,
    })
}

#[cfg(test)]
mod tests;
