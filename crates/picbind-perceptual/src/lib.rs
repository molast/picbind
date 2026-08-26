use butteraugli::{ButteraugliParams, ButteraugliReference};
use js_sys::{Object, Reflect};
use wasm_bindgen::prelude::*;

const MAX_PIXELS: usize = 2_000_000;

fn validate_rgba(rgba: &[u8], width: usize, height: usize) -> Result<(), JsValue> {
    if width < 8 || height < 8 {
        return Err(JsValue::from_str("Butteraugli images must be at least 8x8"));
    }
    let pixels = width
        .checked_mul(height)
        .ok_or_else(|| JsValue::from_str("Image dimensions overflow"))?;
    if pixels > MAX_PIXELS {
        return Err(JsValue::from_str(
            "Butteraugli analysis image exceeds 2,000,000 pixels",
        ));
    }
    let expected = pixels
        .checked_mul(4)
        .ok_or_else(|| JsValue::from_str("RGBA dimensions overflow"))?;
    if rgba.len() != expected {
        return Err(JsValue::from_str(
            "RGBA byte length does not match image dimensions",
        ));
    }
    Ok(())
}

fn composite_rgb(rgba: &[u8], background: u8) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.as_chunks::<4>().0 {
        let alpha = pixel[3] as u16;
        let inverse = 255 - alpha;
        for &channel in &pixel[..3] {
            let composited = (channel as u16 * alpha + background as u16 * inverse + 127) / 255;
            rgb.push(composited as u8);
        }
    }
    rgb
}

fn contains_transparency(rgba: &[u8]) -> bool {
    rgba.as_chunks::<4>().0.iter().any(|pixel| pixel[3] != 255)
}

#[wasm_bindgen]
pub struct ButteraugliSession {
    width: usize,
    height: usize,
    light_reference: ButteraugliReference,
    dark_reference: Option<ButteraugliReference>,
}

#[wasm_bindgen]
impl ButteraugliSession {
    #[wasm_bindgen(constructor)]
    pub fn new(rgba: &[u8], width: u32, height: u32) -> Result<ButteraugliSession, JsValue> {
        let width = width as usize;
        let height = height as usize;
        validate_rgba(rgba, width, height)?;

        let params = ButteraugliParams::default().with_compute_diffmap(false);
        let light_rgb = composite_rgb(rgba, 255);
        let light_reference = ButteraugliReference::new(&light_rgb, width, height, params.clone())
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let dark_reference = if contains_transparency(rgba) {
            let dark_rgb = composite_rgb(rgba, 0);
            Some(
                ButteraugliReference::new(&dark_rgb, width, height, params)
                    .map_err(|error| JsValue::from_str(&error.to_string()))?,
            )
        } else {
            None
        };

        Ok(ButteraugliSession {
            width,
            height,
            light_reference,
            dark_reference,
        })
    }

    pub fn compare(&self, rgba: &[u8]) -> Result<JsValue, JsValue> {
        validate_rgba(rgba, self.width, self.height)?;

        let light_rgb = composite_rgb(rgba, 255);
        let light = self
            .light_reference
            .compare(&light_rgb)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let mut score = light.score;
        let mut pnorm_3 = light.pnorm_3;

        if let Some(reference) = &self.dark_reference {
            let dark_rgb = composite_rgb(rgba, 0);
            let dark = reference
                .compare(&dark_rgb)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            score = score.max(dark.score);
            pnorm_3 = pnorm_3.max(dark.pnorm_3);
        }

        let result = Object::new();
        Reflect::set(&result, &"score".into(), &score.into())?;
        Reflect::set(&result, &"pnorm3".into(), &pnorm_3.into())?;
        Ok(result.into())
    }
}
