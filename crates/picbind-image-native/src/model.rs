#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeImageFormat {
    Jpeg,
    JpegXl,
    Png,
    WebP,
    Avif,
}

impl NativeImageFormat {
    pub const ALL: [Self; 5] = [Self::Jpeg, Self::JpegXl, Self::Png, Self::WebP, Self::Avif];

    pub fn parse(value: &str) -> Result<Self, crate::NativeImageError> {
        match value.to_ascii_lowercase().as_str() {
            "jpeg" | "jpg" => Ok(Self::Jpeg),
            "jpeg-xl" | "jpegxl" | "jxl" => Ok(Self::JpegXl),
            "png" => Ok(Self::Png),
            "webp" => Ok(Self::WebP),
            "avif" => Ok(Self::Avif),
            _ => Err(crate::NativeImageError::UnsupportedFormat(
                value.to_string(),
            )),
        }
    }

    pub const fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::JpegXl => "image/jxl",
            Self::Png => "image/png",
            Self::WebP => "image/webp",
            Self::Avif => "image/avif",
        }
    }

    pub const fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::JpegXl => "jxl",
            Self::Png => "png",
            Self::WebP => "webp",
            Self::Avif => "avif",
        }
    }
}

pub const MAX_INPUT_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 100_000_000;
pub const MAX_DIMENSION: u32 = 16_384;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NativeImageDimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeImageMetadata {
    pub width: u32,
    pub height: u32,
    pub format: NativeImageFormat,
    pub mime_type: &'static str,
    pub size_bytes: usize,
    pub has_alpha: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeEncodeOptions {
    pub format: NativeImageFormat,
    pub quality: u8,
    pub compression_gain: u16,
    pub allow_alpha_loss: bool,
    pub force_encode: bool,
    pub dimensions: Option<NativeImageDimensions>,
}

impl NativeEncodeOptions {
    pub fn new(format: NativeImageFormat) -> Self {
        Self {
            format,
            quality: 80,
            compression_gain: 100,
            allow_alpha_loss: false,
            force_encode: false,
            dimensions: None,
        }
    }

    pub(crate) fn effective_quality(&self) -> u8 {
        if self.quality == 100 {
            return 100;
        }
        let gain = f64::from(self.compression_gain.clamp(25, 400)) / 100.0;
        let loss = 100.0 - f64::from(self.quality);
        (100.0 - loss * gain).round().clamp(1.0, 100.0) as u8
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeImageOutput {
    pub bytes: Vec<u8>,
    pub metadata: NativeImageMetadata,
    pub returned_original: bool,
}
