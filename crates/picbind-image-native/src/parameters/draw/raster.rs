use image::RgbaImage;

use crate::NativeImageError;

use super::{StrokeStyle, validation};

#[derive(Clone, Copy, Debug)]
pub(super) struct Point {
    pub(super) x: f64,
    pub(super) y: f64,
}

impl Point {
    pub(super) const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy)]
pub(super) struct Color([u8; 4]);

impl Color {
    pub(super) fn parse(value: &str) -> Result<Self, NativeImageError> {
        let value = value.trim();
        if value.eq_ignore_ascii_case("transparent") || value == "rgba(0, 0, 0, 0)" {
            return Ok(Self([0, 0, 0, 0]));
        }
        let hex = value.strip_prefix('#').unwrap_or(value);
        let expanded;
        let hex = if hex.len() == 3 {
            expanded = hex
                .chars()
                .flat_map(|value| [value, value])
                .collect::<String>();
            expanded.as_str()
        } else {
            hex
        };
        if hex.len() != 6 || !hex.bytes().all(|value| value.is_ascii_hexdigit()) {
            return validation::invalid("draw colors must use #RGB or #RRGGBB");
        }
        Ok(Self([
            u8::from_str_radix(&hex[0..2], 16).unwrap(),
            u8::from_str_radix(&hex[2..4], 16).unwrap(),
            u8::from_str_radix(&hex[4..6], 16).unwrap(),
            255,
        ]))
    }

    pub(super) fn with_alpha(self, alpha: u8) -> Self {
        Self([self.0[0], self.0[1], self.0[2], alpha])
    }
}

pub(super) struct Surface<'a> {
    image: &'a mut RgbaImage,
}

impl<'a> Surface<'a> {
    pub(super) fn new(image: &'a mut RgbaImage) -> Self {
        Self { image }
    }

    pub(super) fn pixel(&mut self, point: Point, color: Color) {
        self.blend(point.x.round() as i64, point.y.round() as i64, color);
    }

    pub(super) fn rgba_pixel(&mut self, point: Point, pixel: image::Rgba<u8>) {
        self.blend(
            point.x.round() as i64,
            point.y.round() as i64,
            Color(pixel.0),
        );
    }

    pub(super) fn polyline(
        &mut self,
        points: &[Point],
        color: Color,
        width: f64,
        style: StrokeStyle,
    ) {
        for pair in points.windows(2) {
            self.segment(pair[0], pair[1], color, width, style);
        }
    }

    pub(super) fn arrow_head(&mut self, from: Point, to: Point, color: Color, width: f64) {
        let angle = (to.y - from.y).atan2(to.x - from.x);
        let length = (width * 4.0).max(8.0);
        for offset in [-0.55, 0.55] {
            let end = Point::new(
                to.x - length * (angle + offset).cos(),
                to.y - length * (angle + offset).sin(),
            );
            self.segment(to, end, color, width, StrokeStyle::Solid);
        }
    }

    pub(super) fn polygon(
        &mut self,
        points: &[Point],
        stroke: Color,
        fill: Option<Color>,
        width: f64,
        style: StrokeStyle,
    ) {
        if let Some(fill) = fill {
            self.fill_polygon(points, fill);
        }
        for index in 0..points.len() {
            self.segment(
                points[index],
                points[(index + 1) % points.len()],
                stroke,
                width,
                style,
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn ellipse(
        &mut self,
        center: Point,
        radius_x: f64,
        radius_y: f64,
        rotation: f64,
        stroke: Color,
        fill: Option<Color>,
        width: f64,
    ) {
        if radius_x <= 0.0 || radius_y <= 0.0 {
            return;
        }
        let extent = radius_x.max(radius_y) + width;
        let (min_x, max_x) = self.x_bounds(center.x - extent, center.x + extent);
        let (min_y, max_y) = self.y_bounds(center.y - extent, center.y + extent);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let dx = x as f64 + 0.5 - center.x;
                let dy = y as f64 + 0.5 - center.y;
                let local_x = dx * rotation.cos() + dy * rotation.sin();
                let local_y = -dx * rotation.sin() + dy * rotation.cos();
                let distance = ((local_x / radius_x).powi(2) + (local_y / radius_y).powi(2)).sqrt();
                if distance <= 1.0 {
                    if let Some(fill) = fill {
                        self.blend(x, y, fill);
                    }
                    let edge_width = width / radius_x.min(radius_y).max(1.0);
                    if distance >= 1.0 - edge_width {
                        self.blend(x, y, stroke);
                    }
                }
            }
        }
    }

    fn segment(&mut self, start: Point, end: Point, color: Color, width: f64, style: StrokeStyle) {
        let Some((start, end)) = clip_segment(
            start,
            end,
            -width,
            f64::from(self.image.width()) + width,
            -width,
            f64::from(self.image.height()) + width,
        ) else {
            return;
        };
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let length = dx.hypot(dy);
        let steps = length.ceil().max(1.0) as usize;
        let radius = width / 2.0;
        for step in 0..=steps {
            let distance = step as f64 * length / steps as f64;
            if !stroke_visible(distance, width, style) {
                continue;
            }
            let ratio = step as f64 / steps as f64;
            self.disc(
                Point::new(start.x + dx * ratio, start.y + dy * ratio),
                radius,
                color,
            );
        }
    }

    fn disc(&mut self, center: Point, radius: f64, color: Color) {
        let (min_x, max_x) = self.x_bounds(center.x - radius, center.x + radius);
        let (min_y, max_y) = self.y_bounds(center.y - radius, center.y + radius);
        let radius_squared = radius.max(0.5).powi(2);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let dx = x as f64 + 0.5 - center.x;
                let dy = y as f64 + 0.5 - center.y;
                if dx * dx + dy * dy <= radius_squared {
                    self.blend(x, y, color);
                }
            }
        }
    }

    fn fill_polygon(&mut self, points: &[Point], color: Color) {
        let raw_min_x = points
            .iter()
            .map(|point| point.x)
            .fold(f64::INFINITY, f64::min);
        let raw_max_x = points
            .iter()
            .map(|point| point.x)
            .fold(f64::NEG_INFINITY, f64::max);
        let raw_min_y = points
            .iter()
            .map(|point| point.y)
            .fold(f64::INFINITY, f64::min);
        let raw_max_y = points
            .iter()
            .map(|point| point.y)
            .fold(f64::NEG_INFINITY, f64::max);
        let (min_x, max_x) = self.x_bounds(raw_min_x, raw_max_x);
        let (min_y, max_y) = self.y_bounds(raw_min_y, raw_max_y);
        for y in min_y..=max_y {
            for x in min_x..=max_x {
                if point_in_polygon(Point::new(x as f64 + 0.5, y as f64 + 0.5), points) {
                    self.blend(x, y, color);
                }
            }
        }
    }

    fn blend(&mut self, x: i64, y: i64, color: Color) {
        if x < 0
            || y < 0
            || x >= i64::from(self.image.width())
            || y >= i64::from(self.image.height())
        {
            return;
        }
        let destination = self.image.get_pixel_mut(x as u32, y as u32);
        let source_alpha = u32::from(color.0[3]);
        let destination_alpha = u32::from(destination[3]);
        let output_alpha = source_alpha + destination_alpha * (255 - source_alpha) / 255;
        if output_alpha == 0 {
            *destination = image::Rgba([0, 0, 0, 0]);
            return;
        }
        for channel in 0..3 {
            let source = u32::from(color.0[channel]) * source_alpha;
            let existing =
                u32::from(destination[channel]) * destination_alpha * (255 - source_alpha) / 255;
            destination[channel] = ((source + existing) / output_alpha).min(255) as u8;
        }
        destination[3] = output_alpha.min(255) as u8;
    }

    fn x_bounds(&self, minimum: f64, maximum: f64) -> (i64, i64) {
        bounded_range(minimum, maximum, self.image.width())
    }

    fn y_bounds(&self, minimum: f64, maximum: f64) -> (i64, i64) {
        bounded_range(minimum, maximum, self.image.height())
    }
}

fn stroke_visible(distance: f64, width: f64, style: StrokeStyle) -> bool {
    match style {
        StrokeStyle::Solid => true,
        StrokeStyle::Dashed => distance % (width * 6.5) <= width * 4.0,
        StrokeStyle::Dotted => distance % (width * 2.2) <= width.max(1.0) * 0.5,
    }
}

fn point_in_polygon(point: Point, polygon: &[Point]) -> bool {
    let mut inside = false;
    let mut previous = polygon[polygon.len() - 1];
    for &current in polygon {
        if (current.y > point.y) != (previous.y > point.y)
            && point.x
                < (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y)
                    + current.x
        {
            inside = !inside;
        }
        previous = current;
    }
    inside
}

fn bounded_range(minimum: f64, maximum: f64, length: u32) -> (i64, i64) {
    let last = i64::from(length.saturating_sub(1));
    (
        (minimum.floor() as i64).clamp(0, last),
        (maximum.ceil() as i64).clamp(0, last),
    )
}

#[allow(clippy::too_many_arguments)]
fn clip_segment(
    start: Point,
    end: Point,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
) -> Option<(Point, Point)> {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let mut lower = 0.0_f64;
    let mut upper = 1.0_f64;
    for (p, q) in [
        (-dx, start.x - min_x),
        (dx, max_x - start.x),
        (-dy, start.y - min_y),
        (dy, max_y - start.y),
    ] {
        if p.abs() <= f64::EPSILON {
            if q < 0.0 {
                return None;
            }
            continue;
        }
        let ratio = q / p;
        if p < 0.0 {
            lower = lower.max(ratio);
        } else {
            upper = upper.min(ratio);
        }
        if lower > upper {
            return None;
        }
    }
    Some((
        Point::new(start.x + lower * dx, start.y + lower * dy),
        Point::new(start.x + upper * dx, start.y + upper * dy),
    ))
}
