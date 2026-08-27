use image::{DynamicImage, RgbImage};
use mozjpeg_rs::{Encoder, Preset, Subsampling};

use crate::NativeImageError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct JpegEncoderOptions {
    pub quality: u8,
    pub allow_alpha_loss: bool,
    pub alpha_background: [u8; 3],
    pub preset: Preset,
    pub progressive: bool,
    pub optimize_huffman: bool,
    /// None selects 4:4:4, 4:2:2, or 4:2:0 from the configured quality.
    pub subsampling: Option<Subsampling>,
}

impl JpegEncoderOptions {
    pub(crate) fn new(quality: u8, allow_alpha_loss: bool) -> Self {
        Self {
            quality,
            allow_alpha_loss,
            ..Self::default()
        }
    }

    fn validate(&self) -> Result<(), NativeImageError> {
        if !(1..=100).contains(&self.quality) {
            return Err(NativeImageError::InvalidParameters(
                "JPEG quality must be between 1 and 100".into(),
            ));
        }
        Ok(())
    }

    fn resolved_subsampling(&self) -> Subsampling {
        self.subsampling.unwrap_or_else(|| {
            if self.quality >= 96 {
                Subsampling::S444
            } else if self.quality >= 90 {
                Subsampling::S422
            } else {
                Subsampling::S420
            }
        })
    }
}

impl Default for JpegEncoderOptions {
    fn default() -> Self {
        Self {
            quality: 80,
            allow_alpha_loss: false,
            alpha_background: [255; 3],
            preset: Preset::ProgressiveBalanced,
            progressive: true,
            optimize_huffman: true,
            subsampling: None,
        }
    }
}

pub(crate) fn encode(
    image: &DynamicImage,
    quality: u8,
    allow_alpha_loss: bool,
) -> Result<Vec<u8>, NativeImageError> {
    encode_with_options(image, &JpegEncoderOptions::new(quality, allow_alpha_loss))
}

pub(crate) fn encode_with_options(
    image: &DynamicImage,
    options: &JpegEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    let rgb = prepare_rgb_with_options(image, options);
    encode_rgb_with_options(&rgb, options)
}

pub(crate) fn prepare_rgb(image: &DynamicImage, allow_alpha_loss: bool) -> RgbImage {
    prepare_rgb_with_options(image, &JpegEncoderOptions::new(80, allow_alpha_loss))
}

pub(crate) fn prepare_rgb_with_options(
    image: &DynamicImage,
    options: &JpegEncoderOptions,
) -> RgbImage {
    let rgba = image.to_rgba8();
    let mut rgb = RgbImage::new(rgba.width(), rgba.height());
    for (source, destination) in rgba.pixels().zip(rgb.pixels_mut()) {
        let alpha = u16::from(source[3]);
        for channel in 0..3 {
            let background = if options.allow_alpha_loss {
                u16::from(options.alpha_background[channel])
            } else {
                0
            };
            destination[channel] =
                ((u16::from(source[channel]) * alpha + background * (255 - alpha)) / 255) as u8;
        }
    }
    rgb
}

pub(crate) fn encode_rgb(image: &RgbImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_rgb_with_options(image, &JpegEncoderOptions::new(quality, false))
}

pub(crate) fn encode_rgb_with_options(
    image: &RgbImage,
    options: &JpegEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    options.validate()?;
    Encoder::new(options.preset)
        .quality(options.quality)
        .progressive(options.progressive)
        .subsampling(options.resolved_subsampling())
        .optimize_huffman(options.optimize_huffman)
        .encode_rgb(image.as_raw(), image.width(), image.height())
        .map_err(|error| NativeImageError::EncodeFailed(format!("JPEG: {error}")))
}
