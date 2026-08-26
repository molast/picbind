use image::DynamicImage;

const BASE83: &[u8; 83] =
    b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
const COMPONENTS_X: usize = 4;
const COMPONENTS_Y: usize = 3;
const SAMPLE_EDGE: u32 = 32;

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSharePlaceholder {
    pub width: u32,
    pub height: u32,
    pub dominant_color: String,
    pub blur_hash: String,
}

pub(super) fn generate(image: &DynamicImage) -> NativeSharePlaceholder {
    let sample = image.thumbnail(SAMPLE_EDGE, SAMPLE_EDGE).to_rgba8();
    let pixels = sample
        .pixels()
        .map(|pixel| {
            let alpha = f64::from(pixel[3]) / 255.0;
            [
                srgb_to_linear(pixel[0]) * alpha + 1.0 - alpha,
                srgb_to_linear(pixel[1]) * alpha + 1.0 - alpha,
                srgb_to_linear(pixel[2]) * alpha + 1.0 - alpha,
            ]
        })
        .collect::<Vec<_>>();
    let average = pixels.iter().fold([0.0; 3], |mut sum, pixel| {
        for channel in 0..3 {
            sum[channel] += pixel[channel];
        }
        sum
    });
    let count = pixels.len().max(1) as f64;
    NativeSharePlaceholder {
        width: image.width(),
        height: image.height(),
        dominant_color: format!(
            "#{:02x}{:02x}{:02x}",
            linear_to_srgb(average[0] / count),
            linear_to_srgb(average[1] / count),
            linear_to_srgb(average[2] / count),
        ),
        blur_hash: blur_hash(&pixels, sample.width(), sample.height()),
    }
}

fn blur_hash(pixels: &[[f64; 3]], width: u32, height: u32) -> String {
    let mut factors = Vec::with_capacity(COMPONENTS_X * COMPONENTS_Y);
    let count = f64::from(width * height);
    for component_y in 0..COMPONENTS_Y {
        for component_x in 0..COMPONENTS_X {
            let normalization = if component_x == 0 && component_y == 0 {
                1.0
            } else {
                2.0
            };
            let mut factor = [0.0; 3];
            for y in 0..height {
                for x in 0..width {
                    let basis = normalization
                        * (std::f64::consts::PI * component_x as f64 * f64::from(x)
                            / f64::from(width))
                        .cos()
                        * (std::f64::consts::PI * component_y as f64 * f64::from(y)
                            / f64::from(height))
                        .cos();
                    let pixel = pixels[(y * width + x) as usize];
                    for channel in 0..3 {
                        factor[channel] += basis * pixel[channel] / count;
                    }
                }
            }
            factors.push(factor);
        }
    }
    let mut output = encode_base83(((COMPONENTS_X - 1) + (COMPONENTS_Y - 1) * 9) as u32, 1);
    let maximum = factors
        .iter()
        .skip(1)
        .flat_map(|factor| factor.iter())
        .fold(0.0_f64, |current, value| current.max(value.abs()));
    let quantized_maximum = ((maximum * 166.0 - 0.5).floor() as i32).clamp(0, 82);
    let maximum_value = (f64::from(quantized_maximum) + 1.0) / 166.0;
    output.push_str(&encode_base83(quantized_maximum as u32, 1));
    let dc = factors[0];
    output.push_str(&encode_base83(
        (u32::from(linear_to_srgb(dc[0])) << 16)
            + (u32::from(linear_to_srgb(dc[1])) << 8)
            + u32::from(linear_to_srgb(dc[2])),
        4,
    ));
    for factor in factors.iter().skip(1) {
        let quantize = |value: f64| {
            ((value / maximum_value).abs().sqrt().copysign(value) * 9.0 + 9.5)
                .floor()
                .clamp(0.0, 18.0) as u32
        };
        output.push_str(&encode_base83(
            quantize(factor[0]) * 19 * 19 + quantize(factor[1]) * 19 + quantize(factor[2]),
            2,
        ));
    }
    output
}

fn encode_base83(mut value: u32, length: usize) -> String {
    let mut output = vec![BASE83[0]; length];
    for index in (0..length).rev() {
        output[index] = BASE83[(value % 83) as usize];
        value /= 83;
    }
    String::from_utf8(output).expect("BlurHash alphabet is valid UTF-8")
}

fn srgb_to_linear(value: u8) -> f64 {
    let value = f64::from(value) / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(value: f64) -> u8 {
    let value = value.clamp(0.0, 1.0);
    let encoded = if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    };
    (encoded * 255.0 + 0.5).floor().clamp(0.0, 255.0) as u8
}
