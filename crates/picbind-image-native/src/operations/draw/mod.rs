mod raster;
mod text;

use image::DynamicImage;
use serde::Deserialize;
use serde_json::Value;

use crate::{MAX_PIXELS, NativeImageError};

use super::validation;
use raster::{Color, Point, Surface};

const MAX_ANNOTATIONS: usize = 512;
const MAX_POINTS: usize = 10_000;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AnnotationType {
    Arrow,
    Line,
    Rectangle,
    Circle,
    Pen,
    Text,
    Emoji,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum StrokeStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Annotation {
    #[serde(rename = "type")]
    annotation_type: AnnotationType,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale_x: f64,
    scale_y: f64,
    rotation: f64,
    #[serde(default)]
    points: Vec<f64>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    emoji: Option<String>,
    stroke: String,
    #[serde(default)]
    fill: Option<String>,
    stroke_width: f64,
    #[serde(default)]
    stroke_style: StrokeStyle,
}

#[derive(Deserialize)]
struct DrawParameters {
    annotations: Vec<Annotation>,
}

pub(super) fn apply(image: DynamicImage, params: &Value) -> Result<DynamicImage, NativeImageError> {
    let draw: DrawParameters = validation::parse(params, "draw")?;
    if draw.annotations.len() > MAX_ANNOTATIONS {
        return validation::invalid("draw supports at most 512 annotations");
    }
    let mut rgba = image.to_rgba8();
    if u64::from(rgba.width()) * u64::from(rgba.height()) > MAX_PIXELS {
        return validation::invalid("draw output exceeds the native pixel limit");
    }
    let mut surface = Surface::new(&mut rgba);
    for annotation in &draw.annotations {
        annotation.validate()?;
        annotation.render(&mut surface)?;
    }
    Ok(DynamicImage::ImageRgba8(rgba))
}

impl Annotation {
    fn validate(&self) -> Result<(), NativeImageError> {
        let values = [
            self.x,
            self.y,
            self.width,
            self.height,
            self.scale_x,
            self.scale_y,
            self.rotation,
            self.stroke_width,
        ];
        if values
            .into_iter()
            .chain(self.points.iter().copied())
            .any(|value| !value.is_finite() || value.abs() > 1_000_000.0)
            || self.stroke_width <= 0.0
            || self.stroke_width > 1024.0
            || self.points.len() > MAX_POINTS
            || !self.points.len().is_multiple_of(2)
        {
            return validation::invalid("draw annotation geometry is invalid");
        }
        if self
            .text
            .as_deref()
            .is_some_and(|value| value.len() > 2_000)
            || self.emoji.as_deref().is_some_and(|value| value.len() > 64)
        {
            return validation::invalid("draw text or emoji is too long");
        }
        Color::parse(&self.stroke)?;
        if let Some(fill) = self.fill.as_deref() {
            Color::parse(fill)?;
        }
        Ok(())
    }

    fn render(&self, surface: &mut Surface<'_>) -> Result<(), NativeImageError> {
        let stroke = Color::parse(&self.stroke)?;
        let fill = self.fill.as_deref().map(Color::parse).transpose()?;
        let width = self.stroke_width.max(0.75);
        match self.annotation_type {
            AnnotationType::Arrow | AnnotationType::Line | AnnotationType::Pen => {
                let local = if self.points.len() >= 4 {
                    self.points
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|point| Point::new(point[0], point[1]))
                        .collect::<Vec<_>>()
                } else {
                    vec![Point::new(0.0, 0.0), Point::new(self.width, self.height)]
                };
                let points = local
                    .into_iter()
                    .map(|point| self.transform(point))
                    .collect::<Vec<_>>();
                surface.polyline(&points, stroke, width, self.stroke_style);
                if matches!(self.annotation_type, AnnotationType::Arrow) && points.len() >= 2 {
                    surface.arrow_head(
                        points[points.len() - 2],
                        points[points.len() - 1],
                        stroke,
                        width,
                    );
                }
            }
            AnnotationType::Rectangle => {
                let corners = [
                    Point::new(0.0, 0.0),
                    Point::new(self.width, 0.0),
                    Point::new(self.width, self.height),
                    Point::new(0.0, self.height),
                ]
                .map(|point| self.transform(point));
                surface.polygon(&corners, stroke, fill, width, self.stroke_style);
            }
            AnnotationType::Circle => surface.ellipse(
                Point::new(self.x, self.y),
                self.width.abs() * self.scale_x.abs() / 2.0,
                self.height.abs() * self.scale_y.abs() / 2.0,
                self.rotation.to_radians(),
                stroke,
                fill,
                width,
            ),
            AnnotationType::Text => text::render_text(
                surface,
                self.text.as_deref().unwrap_or_default(),
                stroke,
                self.width,
                self.height,
                |point| self.transform(point),
            )?,
            AnnotationType::Emoji => text::render_emoji(
                surface,
                self.emoji.as_deref().unwrap_or_default(),
                self.width,
                self.height,
                |point| self.transform(point),
            )?,
        }
        Ok(())
    }

    fn transform(&self, point: Point) -> Point {
        let scaled = Point::new(point.x * self.scale_x, point.y * self.scale_y);
        let radians = self.rotation.to_radians();
        Point::new(
            self.x + scaled.x * radians.cos() - scaled.y * radians.sin(),
            self.y + scaled.x * radians.sin() + scaled.y * radians.cos(),
        )
    }
}
