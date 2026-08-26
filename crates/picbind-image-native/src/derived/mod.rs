mod placeholder;
mod thumbnail;

use crate::{NativeImageDimensions, NativeImageError, NativeParameterDocument, replay_parameters};

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
    thumbnail::validate_container(container)?;
    let image = match document {
        Some(document) => replay_parameters(input, document)?.into_image(),
        None => crate::decode::decode(input)?.1,
    };
    let placeholder = placeholder::generate(&image);
    let thumbnail = thumbnail::generate(&image, container)?;
    Ok(NativeShareAssets {
        placeholder,
        thumbnail,
    })
}

#[cfg(test)]
mod tests;
