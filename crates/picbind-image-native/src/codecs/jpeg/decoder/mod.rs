use image::DynamicImage;

use crate::NativeImageError;

pub(crate) fn decode(input: &[u8]) -> Result<DynamicImage, NativeImageError> {
    image::load_from_memory_with_format(input, image::ImageFormat::Jpeg)
        .map_err(|error| NativeImageError::InvalidImage(error.to_string()))
}
