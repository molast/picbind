use image::{DynamicImage, RgbaImage};
use serde::Deserialize;
use serde_json::Value;

use crate::NativeImageError;

use super::validation;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurvePoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct BalanceAxes {
    cyan_red: f64,
    magenta_green: f64,
    yellow_blue: f64,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(default)]
struct ColorBalance {
    shadows: BalanceAxes,
    midtones: BalanceAxes,
    highlights: BalanceAxes,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SelectiveRange {
    Reds,
    Yellows,
    Greens,
    Cyans,
    #[default]
    Blues,
    Magentas,
}

#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum RecolorMode {
    #[default]
    Color,
    Grayscale,
    Sepia,
    Monochrome,
}

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ColorSettings {
    brightness: f64,
    contrast: f64,
    black_point: f64,
    midtone: f64,
    white_point: f64,
    curve_points: Vec<CurvePoint>,
    saturation: f64,
    vibrance: f64,
    hue: f64,
    temperature: f64,
    balance: ColorBalance,
    photo_filter_color: String,
    photo_filter_density: f64,
    selective_range: SelectiveRange,
    selective_hue: f64,
    selective_saturation: f64,
    selective_lightness: f64,
    replace_enabled: bool,
    replace_source: String,
    replace_target: String,
    replace_tolerance: f64,
    replace_strength: f64,
    red_channel: f64,
    green_channel: f64,
    blue_channel: f64,
    recolor_mode: RecolorMode,
    monochrome_color: String,
}

impl Default for ColorSettings {
    fn default() -> Self {
        Self {
            brightness: 0.0,
            contrast: 0.0,
            black_point: 0.0,
            midtone: 0.0,
            white_point: 255.0,
            curve_points: vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }],
            saturation: 0.0,
            vibrance: 0.0,
            hue: 0.0,
            temperature: 0.0,
            balance: ColorBalance::default(),
            photo_filter_color: "#f59e0b".into(),
            photo_filter_density: 0.0,
            selective_range: SelectiveRange::Blues,
            selective_hue: 0.0,
            selective_saturation: 0.0,
            selective_lightness: 0.0,
            replace_enabled: false,
            replace_source: "#3b82f6".into(),
            replace_target: "#ef4444".into(),
            replace_tolerance: 20.0,
            replace_strength: 100.0,
            red_channel: 0.0,
            green_channel: 0.0,
            blue_channel: 0.0,
            recolor_mode: RecolorMode::Color,
            monochrome_color: "#64748b".into(),
        }
    }
}

pub(super) fn apply(image: DynamicImage, params: &Value) -> Result<DynamicImage, NativeImageError> {
    let settings: ColorSettings = validation::parse(params, "color")?;
    settings.validate()?;
    if settings.is_neutral() {
        return Ok(image);
    }
    let mut rgba = image.to_rgba8();
    apply_pixels(&mut rgba, &settings);
    Ok(DynamicImage::ImageRgba8(rgba))
}

impl ColorSettings {
    fn validate(&self) -> Result<(), NativeImageError> {
        let bounded = [
            (self.brightness, -100.0, 100.0),
            (self.contrast, -100.0, 100.0),
            (self.black_point, 0.0, 255.0),
            (self.midtone, -100.0, 100.0),
            (self.white_point, 0.0, 255.0),
            (self.saturation, -100.0, 100.0),
            (self.vibrance, -100.0, 100.0),
            (self.hue, -180.0, 180.0),
            (self.temperature, -100.0, 100.0),
            (self.photo_filter_density, 0.0, 100.0),
            (self.selective_hue, -180.0, 180.0),
            (self.selective_saturation, -100.0, 100.0),
            (self.selective_lightness, -100.0, 100.0),
            (self.replace_tolerance, 1.0, 100.0),
            (self.replace_strength, 0.0, 100.0),
            (self.red_channel, -100.0, 100.0),
            (self.green_channel, -100.0, 100.0),
            (self.blue_channel, -100.0, 100.0),
        ];
        if bounded
            .into_iter()
            .any(|(value, min, max)| !value.is_finite() || value < min || value > max)
            || self.white_point <= self.black_point
        {
            return validation::invalid("color values are outside their supported ranges");
        }
        if self.curve_points.len() < 2
            || self.curve_points.len() > 12
            || self.curve_points.iter().any(|point| {
                !point.x.is_finite()
                    || !point.y.is_finite()
                    || !(0.0..=1.0).contains(&point.x)
                    || !(0.0..=1.0).contains(&point.y)
            })
        {
            return validation::invalid("color curve must contain 2 to 12 normalized points");
        }
        for axes in [
            self.balance.shadows,
            self.balance.midtones,
            self.balance.highlights,
        ] {
            if [axes.cyan_red, axes.magenta_green, axes.yellow_blue]
                .into_iter()
                .any(|value| !value.is_finite() || !(-100.0..=100.0).contains(&value))
            {
                return validation::invalid("color balance values must be between -100 and 100");
            }
        }
        for color in [
            &self.photo_filter_color,
            &self.replace_source,
            &self.replace_target,
            &self.monochrome_color,
        ] {
            parse_hex(color)?;
        }
        Ok(())
    }

    fn is_neutral(&self) -> bool {
        self.brightness == 0.0
            && self.contrast == 0.0
            && self.black_point == 0.0
            && self.midtone == 0.0
            && self.white_point == 255.0
            && self.curve_points.len() == 2
            && self.curve_points[0].x == 0.0
            && self.curve_points[0].y == 0.0
            && self.curve_points[1].x == 1.0
            && self.curve_points[1].y == 1.0
            && self.saturation == 0.0
            && self.vibrance == 0.0
            && self.hue == 0.0
            && self.temperature == 0.0
            && !self.balance_active()
            && self.photo_filter_density == 0.0
            && self.selective_hue == 0.0
            && self.selective_saturation == 0.0
            && self.selective_lightness == 0.0
            && !self.replace_enabled
            && self.red_channel == 0.0
            && self.green_channel == 0.0
            && self.blue_channel == 0.0
            && self.recolor_mode == RecolorMode::Color
    }

    fn balance_active(&self) -> bool {
        [
            self.balance.shadows,
            self.balance.midtones,
            self.balance.highlights,
        ]
        .into_iter()
        .any(|axes| axes.cyan_red != 0.0 || axes.magenta_green != 0.0 || axes.yellow_blue != 0.0)
    }
}

fn apply_pixels(image: &mut RgbaImage, settings: &ColorSettings) {
    let contrast = settings.contrast.clamp(-99.0, 99.0);
    let contrast_factor = (259.0 * (contrast + 255.0)) / (255.0 * (259.0 - contrast));
    let gamma = 2.0_f64.powf(-settings.midtone / 100.0);
    let filter_mix = settings.photo_filter_density / 100.0;
    let filter = parse_hex(&settings.photo_filter_color).unwrap_or([0.0; 3]);
    let replace_source = parse_hex(&settings.replace_source).unwrap_or([0.0; 3]);
    let replace_target = parse_hex(&settings.replace_target).unwrap_or([0.0; 3]);
    let monochrome = parse_hex(&settings.monochrome_color).unwrap_or([0.0; 3]);
    let curve = curve_lut(&settings.curve_points);
    let level_range = (settings.white_point - settings.black_point).max(1.0);
    let brightness = settings.brightness * 2.55;
    let gains = [
        1.0 + settings.red_channel / 100.0,
        1.0 + settings.green_channel / 100.0,
        1.0 + settings.blue_channel / 100.0,
    ];
    let channel_luts = gains.map(|gain| {
        std::array::from_fn::<_, 256, _>(|value| {
            let mut next = value as f64 * gain + brightness;
            next = contrast_factor * (next - 128.0) + 128.0;
            next = 255.0 * clamp((next - settings.black_point) / level_range, 0.0, 1.0).powf(gamma);
            curve[clamp(next, 0.0, 255.0).round() as usize]
        })
    });
    let selective_active = settings.selective_hue != 0.0
        || settings.selective_saturation != 0.0
        || settings.selective_lightness != 0.0;
    let hsl_active = settings.hue != 0.0
        || settings.saturation != 0.0
        || settings.vibrance != 0.0
        || selective_active;
    let balance_active = settings.balance_active();

    for pixel in image.pixels_mut() {
        let mut rgb = [
            f64::from(channel_luts[0][pixel[0] as usize]),
            f64::from(channel_luts[1][pixel[1] as usize]),
            f64::from(channel_luts[2][pixel[2] as usize]),
        ];
        let mut lightness = 0.0;
        if hsl_active {
            let (mut hue, mut saturation, next_lightness) = rgb_to_hsl(rgb);
            lightness = next_lightness;
            hue = (hue + settings.hue / 360.0).rem_euclid(1.0);
            saturation = clamp(
                saturation * (1.0 + settings.saturation / 100.0)
                    + (1.0 - saturation) * (settings.vibrance / 140.0),
                0.0,
                1.0,
            );
            if selective_active {
                let target_hue = selective_hue(settings.selective_range);
                let distance = (hue - target_hue).abs().min(1.0 - (hue - target_hue).abs());
                let weight = clamp(1.0 - distance / 0.12, 0.0, 1.0);
                hue += settings.selective_hue / 360.0 * weight;
                saturation = clamp(
                    saturation * (1.0 + settings.selective_saturation / 100.0 * weight),
                    0.0,
                    1.0,
                );
                lightness = clamp(
                    lightness + settings.selective_lightness / 200.0 * weight,
                    0.0,
                    1.0,
                );
            }
            rgb = hsl_to_rgb(hue.rem_euclid(1.0), saturation, lightness);
        } else if balance_active {
            lightness = (rgb.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                + rgb.iter().copied().fold(f64::INFINITY, f64::min))
                / 510.0;
        }
        rgb[0] += settings.temperature * 0.9;
        rgb[2] -= settings.temperature * 0.9;
        if balance_active {
            apply_balance(&mut rgb, lightness, settings);
        }
        if filter_mix > 0.0 {
            for channel in 0..3 {
                rgb[channel] = rgb[channel] * (1.0 - filter_mix) + filter[channel] * filter_mix;
            }
        }
        if settings.replace_enabled {
            let distance = ((rgb[0] - replace_source[0]).powi(2)
                + (rgb[1] - replace_source[1]).powi(2)
                + (rgb[2] - replace_source[2]).powi(2))
            .sqrt()
                * (100.0 / 441.67);
            let strength = clamp(1.0 - distance / settings.replace_tolerance, 0.0, 1.0)
                * settings.replace_strength
                / 100.0;
            for channel in 0..3 {
                rgb[channel] = rgb[channel] * (1.0 - strength) + replace_target[channel] * strength;
            }
        }
        apply_recolor(&mut rgb, settings.recolor_mode, monochrome);
        for channel in 0..3 {
            pixel[channel] = clamp(rgb[channel], 0.0, 255.0).round() as u8;
        }
    }
}

fn curve_lut(points: &[CurvePoint]) -> [u8; 256] {
    let mut sorted = points.to_vec();
    sorted.sort_by(|left, right| left.x.total_cmp(&right.x));
    std::array::from_fn(|index| {
        let x = index as f64 / 255.0;
        let segment = sorted
            .windows(2)
            .position(|pair| x >= pair[0].x && x <= pair[1].x)
            .unwrap_or(if x < sorted[0].x { 0 } else { sorted.len() - 2 });
        let p0 = sorted[segment.saturating_sub(1)];
        let p1 = sorted[segment];
        let p2 = sorted[(segment + 1).min(sorted.len() - 1)];
        let p3 = sorted[(segment + 2).min(sorted.len() - 1)];
        let t = clamp((x - p1.x) / (p2.x - p1.x).max(0.0001), 0.0, 1.0);
        let y = if sorted.len() == 2 {
            p1.y + (p2.y - p1.y) * t
        } else {
            0.5 * (2.0 * p1.y
                + (-p0.y + p2.y) * t
                + (2.0 * p0.y - 5.0 * p1.y + 4.0 * p2.y - p3.y) * t * t
                + (-p0.y + 3.0 * p1.y - 3.0 * p2.y + p3.y) * t * t * t)
        };
        (clamp(y, 0.0, 1.0) * 255.0).round() as u8
    })
}

fn rgb_to_hsl(rgb: [f64; 3]) -> (f64, f64, f64) {
    let [r, g, b] = rgb.map(|value| value / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let lightness = (max + min) / 2.0;
    if delta == 0.0 {
        return (0.0, 0.0, lightness);
    }
    let saturation = if lightness > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };
    let hue = if max == r {
        (g - b) / delta + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    } / 6.0;
    (hue, saturation, lightness)
}

fn hsl_to_rgb(hue: f64, saturation: f64, lightness: f64) -> [f64; 3] {
    if saturation <= 0.0 {
        return [lightness * 255.0; 3];
    }
    let q = if lightness < 0.5 {
        lightness * (1.0 + saturation)
    } else {
        lightness + saturation - lightness * saturation
    };
    let p = 2.0 * lightness - q;
    [
        hue_channel(p, q, hue + 1.0 / 3.0),
        hue_channel(p, q, hue),
        hue_channel(p, q, hue - 1.0 / 3.0),
    ]
    .map(|value| value * 255.0)
}

fn hue_channel(p: f64, q: f64, hue: f64) -> f64 {
    let value = hue.rem_euclid(1.0);
    if value < 1.0 / 6.0 {
        p + (q - p) * 6.0 * value
    } else if value < 0.5 {
        q
    } else if value < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - value) * 6.0
    } else {
        p
    }
}

fn selective_hue(range: SelectiveRange) -> f64 {
    match range {
        SelectiveRange::Reds => 0.0,
        SelectiveRange::Yellows => 1.0 / 6.0,
        SelectiveRange::Greens => 1.0 / 3.0,
        SelectiveRange::Cyans => 0.5,
        SelectiveRange::Blues => 2.0 / 3.0,
        SelectiveRange::Magentas => 5.0 / 6.0,
    }
}

fn apply_balance(rgb: &mut [f64; 3], lightness: f64, settings: &ColorSettings) {
    let tones = [
        (
            settings.balance.shadows,
            clamp((0.58 - lightness) / 0.45, 0.0, 1.0),
        ),
        (
            settings.balance.midtones,
            clamp(1.0 - (lightness - 0.5).abs() / 0.38, 0.0, 1.0),
        ),
        (
            settings.balance.highlights,
            clamp((lightness - 0.42) / 0.45, 0.0, 1.0),
        ),
    ];
    for (axes, weight) in tones {
        let weight = weight * 0.9;
        rgb[0] += axes.cyan_red * weight;
        rgb[1] -= axes.cyan_red * weight * 0.35;
        rgb[2] -= axes.cyan_red * weight * 0.35;
        rgb[1] += axes.magenta_green * weight;
        rgb[0] -= axes.magenta_green * weight * 0.35;
        rgb[2] -= axes.magenta_green * weight * 0.35;
        rgb[2] += axes.yellow_blue * weight;
        rgb[0] -= axes.yellow_blue * weight * 0.35;
        rgb[1] -= axes.yellow_blue * weight * 0.35;
    }
}

fn apply_recolor(rgb: &mut [f64; 3], mode: RecolorMode, monochrome: [f64; 3]) {
    if mode == RecolorMode::Color {
        return;
    }
    let gray = clamp(rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114, 0.0, 255.0);
    match mode {
        RecolorMode::Color => {}
        RecolorMode::Grayscale => *rgb = [gray; 3],
        RecolorMode::Sepia => {
            let [r, g, b] = *rgb;
            *rgb = [
                r * 0.393 + g * 0.769 + b * 0.189,
                r * 0.349 + g * 0.686 + b * 0.168,
                r * 0.272 + g * 0.534 + b * 0.131,
            ];
        }
        RecolorMode::Monochrome => {
            *rgb = monochrome.map(|channel| gray * channel / 255.0);
        }
    }
}

fn parse_hex(value: &str) -> Result<[f64; 3], NativeImageError> {
    let value = value.strip_prefix('#').unwrap_or(value);
    let expanded;
    let value = if value.len() == 3 {
        expanded = value
            .chars()
            .flat_map(|value| [value, value])
            .collect::<String>();
        expanded.as_str()
    } else {
        value
    };
    if value.len() != 6 || !value.bytes().all(|value| value.is_ascii_hexdigit()) {
        return validation::invalid("color values must use #RGB or #RRGGBB");
    }
    Ok([
        u8::from_str_radix(&value[0..2], 16).unwrap() as f64,
        u8::from_str_radix(&value[2..4], 16).unwrap() as f64,
        u8::from_str_radix(&value[4..6], 16).unwrap() as f64,
    ])
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}
