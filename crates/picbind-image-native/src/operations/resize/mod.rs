use image::{DynamicImage, GenericImageView, imageops::FilterType};

use crate::{MAX_DIMENSION, MAX_PIXELS, NativeImageDimensions, NativeImageError};

pub(crate) fn apply(
    image: DynamicImage,
    dimensions: Option<NativeImageDimensions>,
) -> Result<(DynamicImage, bool), NativeImageError> {
    let Some(dimensions) = dimensions else {
        return Ok((image, false));
    };
    validate(dimensions)?;
    if image.dimensions() == (dimensions.width, dimensions.height) {
        return Ok((image, false));
    }
    Ok((
        image.resize_exact(dimensions.width, dimensions.height, FilterType::Lanczos3),
        true,
    ))
}

fn validate(dimensions: NativeImageDimensions) -> Result<(), NativeImageError> {
    if dimensions.width == 0
        || dimensions.height == 0
        || dimensions.width > MAX_DIMENSION
        || dimensions.height > MAX_DIMENSION
    {
        return Err(NativeImageError::InvalidDimensions(format!(
            "width and height must be between 1 and {MAX_DIMENSION}"
        )));
    }
    if u64::from(dimensions.width) * u64::from(dimensions.height) > MAX_PIXELS {
        return Err(NativeImageError::InvalidDimensions(format!(
            "pixel count exceeds the {MAX_PIXELS} pixel limit"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use image::{DynamicImage, RgbaImage};

    use crate::{NativeImageDimensions, NativeImageError};

    use super::apply;

    fn image() -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::new(24, 18))
    }

    #[test]
    fn unchanged_dimensions_do_not_resize() {
        let (_, changed) = apply(
            image(),
            Some(NativeImageDimensions {
                width: 24,
                height: 18,
            }),
        )
        .unwrap();
        assert!(!changed);
    }

    #[test]
    fn rejects_zero_and_excessive_pixel_dimensions() {
        assert!(matches!(
            apply(
                image(),
                Some(NativeImageDimensions {
                    width: 0,
                    height: 10,
                })
            ),
            Err(NativeImageError::InvalidDimensions(_))
        ));
        assert!(matches!(
            apply(
                image(),
                Some(NativeImageDimensions {
                    width: 16_384,
                    height: 16_384,
                })
            ),
            Err(NativeImageError::InvalidDimensions(_))
        ));
    }
}
