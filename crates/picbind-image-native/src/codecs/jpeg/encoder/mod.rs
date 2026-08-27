use std::borrow::Cow;

use image::{ColorType, DynamicImage, GenericImageView, GrayImage, Luma, RgbImage, RgbaImage};
use mozjpeg_rs::{Encoder, Preset, QuantTableIdx, Subsampling, TrellisConfig};

use crate::NativeImageError;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct JpegEncoderOptions {
    pub quality: u8,
    pub allow_alpha_loss: bool,
    pub alpha_background: [u8; 3],
    pub preset: Preset,
    pub progressive: bool,
    pub optimize_huffman: bool,
    /// None selects 4:4:4, 4:2:2, or 4:2:0 from the configured quality.
    pub subsampling: Option<Subsampling>,
    pub smoothing: u8,
    pub quantization_table: QuantTableIdx,
    pub custom_luma_qtable: Option<[u16; 64]>,
    pub custom_chroma_qtable: Option<[u16; 64]>,
    /// `mozjpeg-rs` currently ignores `use_scans_in_trellis` and `q_opt`.
    pub trellis: TrellisConfig,
    pub optimize_scans: bool,
    pub overshoot_deringing: bool,
    pub fast_color: bool,
    pub restart_interval: u16,
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
        if self.smoothing > 100 {
            return Err(NativeImageError::InvalidParameters(
                "JPEG smoothing must be between 0 and 100".into(),
            ));
        }
        for (name, table) in [
            ("luma", self.custom_luma_qtable.as_ref()),
            ("chroma", self.custom_chroma_qtable.as_ref()),
        ] {
            if table.is_some_and(|table| table.contains(&0)) {
                return Err(NativeImageError::InvalidParameters(format!(
                    "JPEG custom {name} quantization table values must be greater than zero"
                )));
            }
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

    pub(crate) fn resolved_smoothing(&self) -> u8 {
        let has_custom_qtables =
            self.custom_luma_qtable.is_some() || self.custom_chroma_qtable.is_some();
        if has_custom_qtables && self.quality > 80 {
            let minimum = ((f32::from(self.quality) - 75.0) * 0.4).round() as u8;
            self.smoothing.max(minimum)
        } else {
            self.smoothing
        }
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
            smoothing: 0,
            quantization_table: QuantTableIdx::ImageMagick,
            custom_luma_qtable: None,
            custom_chroma_qtable: None,
            trellis: TrellisConfig::default(),
            optimize_scans: false,
            overshoot_deringing: true,
            fast_color: false,
            restart_interval: 0,
        }
    }
}

#[derive(Debug)]
pub(crate) enum PreparedJpegPixels<'a> {
    Gray(Cow<'a, GrayImage>),
    Rgb(Cow<'a, RgbImage>),
}

impl<'a> PreparedJpegPixels<'a> {
    pub(crate) fn from_image(
        image: &'a DynamicImage,
        options: &JpegEncoderOptions,
    ) -> Result<Self, NativeImageError> {
        options.validate()?;
        let (width, height) = image.dimensions();
        ensure_dimensions(width, height)?;

        if let Some(gray) = image.as_luma8() {
            return Ok(Self::Gray(Cow::Borrowed(gray)));
        }
        if let Some(rgb) = image.as_rgb8() {
            return Ok(Self::Rgb(Cow::Borrowed(rgb)));
        }
        if image.color() == ColorType::L16 {
            return Ok(Self::Gray(Cow::Owned(image.to_luma8())));
        }
        if !image.color().has_alpha() {
            return Ok(Self::Rgb(Cow::Owned(image.to_rgb8())));
        }

        let rgba: Cow<'_, RgbaImage> = match image.as_rgba8() {
            Some(rgba) => Cow::Borrowed(rgba),
            None => Cow::Owned(image.to_rgba8()),
        };
        let has_transparency = rgba.pixels().any(|pixel| pixel[3] < 255);
        if has_transparency && !options.allow_alpha_loss {
            return Err(NativeImageError::AlphaLossDenied);
        }

        let is_grayscale = matches!(image.color(), ColorType::La8 | ColorType::La16);
        let background_is_gray = options
            .alpha_background
            .windows(2)
            .all(|pair| pair[0] == pair[1]);
        if is_grayscale && background_is_gray {
            return Ok(Self::Gray(Cow::Owned(composite_luma_alpha(
                image,
                options.alpha_background[0],
            ))));
        }
        Ok(Self::Rgb(Cow::Owned(composite_rgba(
            rgba.as_ref(),
            options.alpha_background,
        ))))
    }

    pub(crate) fn encode(&self, quality: u8) -> Result<Vec<u8>, NativeImageError> {
        match self {
            Self::Gray(gray) => encode_gray(gray.as_ref(), quality),
            Self::Rgb(rgb) => encode_rgb(rgb.as_ref(), quality),
        }
    }

    pub(crate) fn encode_with_options(
        &self,
        options: &JpegEncoderOptions,
    ) -> Result<Vec<u8>, NativeImageError> {
        match self {
            Self::Gray(gray) => encode_gray_with_options(gray.as_ref(), options),
            Self::Rgb(rgb) => encode_rgb_with_options(rgb.as_ref(), options),
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
    PreparedJpegPixels::from_image(image, options)?.encode_with_options(options)
}

fn composite_rgba(rgba: &RgbaImage, background: [u8; 3]) -> RgbImage {
    let mut rgb = RgbImage::new(rgba.width(), rgba.height());
    for (source, destination) in rgba.pixels().zip(rgb.pixels_mut()) {
        let alpha = u16::from(source[3]);
        for channel in 0..3 {
            destination[channel] = ((u16::from(source[channel]) * alpha
                + u16::from(background[channel]) * (255 - alpha))
                / 255) as u8;
        }
    }
    rgb
}

fn composite_luma_alpha(image: &DynamicImage, background: u8) -> GrayImage {
    let luma_alpha = image.to_luma_alpha8();
    GrayImage::from_fn(luma_alpha.width(), luma_alpha.height(), |x, y| {
        let source = luma_alpha.get_pixel(x, y);
        let alpha = u16::from(source[1]);
        Luma(
            [
                ((u16::from(source[0]) * alpha + u16::from(background) * (255 - alpha)) / 255)
                    as u8,
            ],
        )
    })
}

pub(crate) fn encode_rgb(image: &RgbImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_rgb_with_options(image, &JpegEncoderOptions::new(quality, false))
}

pub(crate) fn encode_rgb_with_options(
    image: &RgbImage,
    options: &JpegEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    ensure_dimensions(image.width(), image.height())?;
    configured_encoder(options)?
        .encode_rgb(image.as_raw(), image.width(), image.height())
        .map_err(|error| NativeImageError::EncodeFailed(format!("JPEG: {error}")))
}

pub(crate) fn encode_gray(image: &GrayImage, quality: u8) -> Result<Vec<u8>, NativeImageError> {
    encode_gray_with_options(image, &JpegEncoderOptions::new(quality, false))
}

pub(crate) fn encode_gray_with_options(
    image: &GrayImage,
    options: &JpegEncoderOptions,
) -> Result<Vec<u8>, NativeImageError> {
    ensure_dimensions(image.width(), image.height())?;
    configured_encoder(options)?
        .encode_gray(image.as_raw(), image.width(), image.height())
        .map_err(|error| NativeImageError::EncodeFailed(format!("JPEG: {error}")))
}

fn configured_encoder(options: &JpegEncoderOptions) -> Result<Encoder, NativeImageError> {
    options.validate()?;
    let mut encoder = Encoder::new(options.preset)
        .quality(options.quality)
        .progressive(options.progressive)
        .subsampling(options.resolved_subsampling())
        .quant_tables(options.quantization_table)
        .trellis(options.trellis)
        .optimize_huffman(options.optimize_huffman)
        .overshoot_deringing(options.overshoot_deringing)
        .optimize_scans(options.optimize_scans)
        .smoothing(options.resolved_smoothing())
        .restart_interval(options.restart_interval)
        .fast_color(options.fast_color);
    if let Some(table) = options.custom_luma_qtable {
        encoder = encoder.custom_luma_qtable(table);
    }
    if let Some(table) = options.custom_chroma_qtable {
        encoder = encoder.custom_chroma_qtable(table);
    }
    Ok(encoder)
}

fn ensure_dimensions(width: u32, height: u32) -> Result<(), NativeImageError> {
    if width == 0 || height == 0 {
        return Err(NativeImageError::InvalidImage(
            "JPEG encoder cannot encode an empty image".into(),
        ));
    }
    Ok(())
}
