use std::sync::OnceLock;

use fontdue::{Font, FontSettings};
use image::GenericImageView;
use twemoji_assets::png::PngTwemojiAsset;

use crate::NativeImageError;

use super::raster::{Color, Point, Surface};

const NOTO_SANS: &[u8] = include_bytes!("../../../assets/noto-sans-latin-regular.ttf");

pub(super) fn render_text(
    surface: &mut Surface<'_>,
    value: &str,
    color: Color,
    width: f64,
    height: f64,
    transform: impl Fn(Point) -> Point,
) -> Result<(), NativeImageError> {
    if value.is_empty() {
        return Ok(());
    }
    let font = font()?;
    let font_size = (height.abs() * 0.8).max(12.0) as f32;
    let line_height = f64::from(font_size) * 1.05;
    let max_width = width.abs().max(1.0);
    let mut cursor_x = 0.0;
    let mut cursor_y = (height.abs() - f64::from(font_size)).max(0.0) / 2.0;
    for character in value.chars() {
        if character == '\n' {
            cursor_x = 0.0;
            cursor_y += line_height;
            continue;
        }
        if !character.is_whitespace() && !font.has_glyph(character) {
            return Err(NativeImageError::UnsupportedOperation(format!(
                "draw:text-glyph:{character}"
            )));
        }
        let (metrics, bitmap) = font.rasterize(character, font_size);
        if cursor_x > 0.0 && cursor_x + f64::from(metrics.advance_width) > max_width {
            cursor_x = 0.0;
            cursor_y += line_height;
        }
        for row in 0..metrics.height {
            for column in 0..metrics.width {
                let alpha = bitmap[row * metrics.width + column];
                if alpha == 0 {
                    continue;
                }
                let local = Point::new(
                    cursor_x + metrics.xmin as f64 + column as f64,
                    cursor_y + f64::from(font_size) - metrics.ymin as f64 - metrics.height as f64
                        + row as f64,
                );
                surface.pixel(transform(local), color.with_alpha(alpha));
            }
        }
        cursor_x += f64::from(metrics.advance_width);
    }
    Ok(())
}

pub(super) fn render_emoji(
    surface: &mut Surface<'_>,
    value: &str,
    width: f64,
    height: f64,
    transform: impl Fn(Point) -> Point,
) -> Result<(), NativeImageError> {
    let asset = PngTwemojiAsset::from_emoji(value)
        .ok_or_else(|| NativeImageError::UnsupportedOperation(format!("draw:emoji:{value}")))?;
    let image = image::load_from_memory(asset.data.0)
        .map_err(|error| NativeImageError::InvalidImage(error.to_string()))?;
    let target_width = width.abs().round().clamp(1.0, 16_384.0) as u32;
    let target_height = height.abs().round().clamp(1.0, 16_384.0) as u32;
    let image = image.resize_exact(
        target_width,
        target_height,
        image::imageops::FilterType::Lanczos3,
    );
    for (x, y, pixel) in image.pixels() {
        if pixel[3] > 0 {
            surface.rgba_pixel(transform(Point::new(f64::from(x), f64::from(y))), pixel);
        }
    }
    Ok(())
}

fn font() -> Result<&'static Font, NativeImageError> {
    static FONT: OnceLock<Result<Font, String>> = OnceLock::new();
    FONT.get_or_init(|| {
        Font::from_bytes(NOTO_SANS, FontSettings::default()).map_err(|error| error.to_string())
    })
    .as_ref()
    .map_err(|error| NativeImageError::InvalidImage(format!("embedded font is invalid: {error}")))
}
