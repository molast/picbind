export type ColorToneRange = "shadows" | "midtones" | "highlights";
export type SelectiveColorRange = "reds" | "yellows" | "greens" | "cyans" | "blues" | "magentas";
export type RecolorMode = "color" | "grayscale" | "sepia" | "monochrome";
export type ToneCurvePoint = { x: number; y: number };

export type ColorBalanceAxes = {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
};

export type RoomColorAdjustments = {
  brightness: number;
  contrast: number;
  blackPoint: number;
  midtone: number;
  whitePoint: number;
  curvePoints: ToneCurvePoint[];
  saturation: number;
  vibrance: number;
  hue: number;
  temperature: number;
  balance: Record<ColorToneRange, ColorBalanceAxes>;
  photoFilterColor: string;
  photoFilterDensity: number;
  selectiveRange: SelectiveColorRange;
  selectiveHue: number;
  selectiveSaturation: number;
  selectiveLightness: number;
  replaceEnabled: boolean;
  replaceSource: string;
  replaceTarget: string;
  replaceTolerance: number;
  replaceStrength: number;
  redChannel: number;
  greenChannel: number;
  blueChannel: number;
  recolorMode: RecolorMode;
  monochromeColor: string;
};

const EMPTY_BALANCE: ColorBalanceAxes = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 };

export const DEFAULT_COLOR_ADJUSTMENTS: RoomColorAdjustments = {
  brightness: 0,
  contrast: 0,
  blackPoint: 0,
  midtone: 0,
  whitePoint: 255,
  curvePoints: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  saturation: 0,
  vibrance: 0,
  hue: 0,
  temperature: 0,
  balance: {
    shadows: { ...EMPTY_BALANCE },
    midtones: { ...EMPTY_BALANCE },
    highlights: { ...EMPTY_BALANCE },
  },
  photoFilterColor: "#f59e0b",
  photoFilterDensity: 0,
  selectiveRange: "blues",
  selectiveHue: 0,
  selectiveSaturation: 0,
  selectiveLightness: 0,
  replaceEnabled: false,
  replaceSource: "#3b82f6",
  replaceTarget: "#ef4444",
  replaceTolerance: 20,
  replaceStrength: 100,
  redChannel: 0,
  greenChannel: 0,
  blueChannel: 0,
  recolorMode: "color",
  monochromeColor: "#64748b",
};

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function hexRgb(hex: string) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) || 0);
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness] as const;
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness] as const;
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  hue = ((hue % 1) + 1) % 1;
  if (saturation <= 0) return [lightness * 255, lightness * 255, lightness * 255];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset: number) => {
    let t = hue + offset; if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255];
}

const RANGE_HUES: Record<SelectiveColorRange, number> = {
  reds: 0,
  yellows: 1 / 6,
  greens: 1 / 3,
  cyans: 1 / 2,
  blues: 2 / 3,
  magentas: 5 / 6,
};

function toneWeights(lightness: number) {
  return {
    shadows: clamp((0.58 - lightness) / 0.45, 0, 1),
    midtones: clamp(1 - Math.abs(lightness - 0.5) / 0.38, 0, 1),
    highlights: clamp((lightness - 0.42) / 0.45, 0, 1),
  };
}

export function isRoomColorAdjustmentsNeutral(settings: RoomColorAdjustments) {
  const balanceIsNeutral = (Object.keys(settings.balance) as ColorToneRange[]).every((tone) => {
    const axes = settings.balance[tone];
    return axes.cyanRed === 0 && axes.magentaGreen === 0 && axes.yellowBlue === 0;
  });
  const curveIsNeutral = settings.curvePoints.length === 2
    && settings.curvePoints[0].x === 0
    && settings.curvePoints[0].y === 0
    && settings.curvePoints[1].x === 1
    && settings.curvePoints[1].y === 1;

  return settings.brightness === 0
    && settings.contrast === 0
    && settings.blackPoint === 0
    && settings.midtone === 0
    && settings.whitePoint === 255
    && curveIsNeutral
    && settings.saturation === 0
    && settings.vibrance === 0
    && settings.hue === 0
    && settings.temperature === 0
    && balanceIsNeutral
    && settings.photoFilterDensity === 0
    && settings.selectiveHue === 0
    && settings.selectiveSaturation === 0
    && settings.selectiveLightness === 0
    && !settings.replaceEnabled
    && settings.redChannel === 0
    && settings.greenChannel === 0
    && settings.blueChannel === 0
    && settings.recolorMode === "color";
}

export function buildToneCurveLut(points: ToneCurvePoint[]) {
  const sorted = [...points]
    .map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))
    .sort((a, b) => a.x - b.x);
  if (sorted.length < 2) return Uint8Array.from({ length: 256 }, (_, index) => index);
  const lut = new Uint8Array(256);
  if (sorted.length === 2) {
    const [start, end] = sorted;
    const span = Math.max(0.0001, end.x - start.x);
    for (let index = 0; index < 256; index += 1) {
      const x = index / 255;
      const t = clamp((x - start.x) / span, 0, 1);
      lut[index] = Math.round(clamp(start.y + (end.y - start.y) * t, 0, 1) * 255);
    }
    return lut;
  }
  for (let index = 0; index < 256; index += 1) {
    const x = index / 255;
    let segment = sorted.findIndex((point, pointIndex) => pointIndex < sorted.length - 1 && x >= point.x && x <= sorted[pointIndex + 1].x);
    if (segment < 0) segment = x < sorted[0].x ? 0 : sorted.length - 2;
    const p0 = sorted[Math.max(0, segment - 1)];
    const p1 = sorted[segment];
    const p2 = sorted[Math.min(sorted.length - 1, segment + 1)];
    const p3 = sorted[Math.min(sorted.length - 1, segment + 2)];
    const span = Math.max(0.0001, p2.x - p1.x);
    const t = clamp((x - p1.x) / span, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const y = 0.5 * (
      2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    lut[index] = Math.round(clamp(y, 0, 1) * 255);
  }
  return lut;
}

export function applyRoomColorAdjustments(imageData: ImageData, settings: RoomColorAdjustments) {
  if (isRoomColorAdjustmentsNeutral(settings)) return imageData;
  const data = imageData.data;
  const contrast = Math.max(-99, Math.min(99, settings.contrast));
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const gamma = Math.pow(2, -settings.midtone / 100);
  const [filterR, filterG, filterB] = hexRgb(settings.photoFilterColor);
  const [replaceR, replaceG, replaceB] = hexRgb(settings.replaceSource);
  const [targetR, targetG, targetB] = hexRgb(settings.replaceTarget);
  const [monoR, monoG, monoB] = hexRgb(settings.monochromeColor);
  const targetHue = RANGE_HUES[settings.selectiveRange];
  const curveLut = buildToneCurveLut(settings.curvePoints);

  for (let index = 0; index < data.length; index += 4) {
    let r = data[index] * (1 + settings.redChannel / 100);
    let g = data[index + 1] * (1 + settings.greenChannel / 100);
    let b = data[index + 2] * (1 + settings.blueChannel / 100);

    r += settings.brightness * 2.55; g += settings.brightness * 2.55; b += settings.brightness * 2.55;
    r = contrastFactor * (r - 128) + 128; g = contrastFactor * (g - 128) + 128; b = contrastFactor * (b - 128) + 128;
    const range = Math.max(1, settings.whitePoint - settings.blackPoint);
    r = 255 * Math.pow(clamp((r - settings.blackPoint) / range, 0, 1), gamma);
    g = 255 * Math.pow(clamp((g - settings.blackPoint) / range, 0, 1), gamma);
    b = 255 * Math.pow(clamp((b - settings.blackPoint) / range, 0, 1), gamma);
    r = curveLut[Math.round(clamp(r))];
    g = curveLut[Math.round(clamp(g))];
    b = curveLut[Math.round(clamp(b))];

    let [h, s, l] = rgbToHsl(r, g, b);
    h += settings.hue / 360;
    h = ((h % 1) + 1) % 1;
    s = clamp(s * (1 + settings.saturation / 100) + (1 - s) * settings.vibrance / 140, 0, 1);
    let hueDistance = Math.abs(h - targetHue); hueDistance = Math.min(hueDistance, 1 - hueDistance);
    const selectiveWeight = clamp(1 - hueDistance / 0.12, 0, 1);
    h += (settings.selectiveHue / 360) * selectiveWeight;
    s = clamp(s * (1 + settings.selectiveSaturation / 100 * selectiveWeight), 0, 1);
    l = clamp(l + settings.selectiveLightness / 200 * selectiveWeight, 0, 1);
    [r, g, b] = hslToRgb(h, s, l);

    const temperature = settings.temperature * 0.9;
    r += temperature; b -= temperature;
    const weights = toneWeights(l);
    for (const tone of ["shadows", "midtones", "highlights"] as const) {
      const axes = settings.balance[tone]; const weight = weights[tone] * 0.9;
      r += axes.cyanRed * weight; g -= axes.cyanRed * weight * 0.35; b -= axes.cyanRed * weight * 0.35;
      g += axes.magentaGreen * weight; r -= axes.magentaGreen * weight * 0.35; b -= axes.magentaGreen * weight * 0.35;
      b += axes.yellowBlue * weight; r -= axes.yellowBlue * weight * 0.35; g -= axes.yellowBlue * weight * 0.35;
    }

    const filterMix = settings.photoFilterDensity / 100;
    r = r * (1 - filterMix) + filterR * filterMix;
    g = g * (1 - filterMix) + filterG * filterMix;
    b = b * (1 - filterMix) + filterB * filterMix;

    if (settings.replaceEnabled) {
      const distance = Math.hypot(r - replaceR, g - replaceG, b - replaceB) / 441.67 * 100;
      const match = clamp(1 - distance / Math.max(1, settings.replaceTolerance), 0, 1) * settings.replaceStrength / 100;
      r = r * (1 - match) + targetR * match; g = g * (1 - match) + targetG * match; b = b * (1 - match) + targetB * match;
    }

    const gray = clamp(r * 0.299 + g * 0.587 + b * 0.114);
    if (settings.recolorMode === "grayscale") r = g = b = gray;
    if (settings.recolorMode === "sepia") {
      const oldR = r; const oldG = g; const oldB = b;
      r = oldR * 0.393 + oldG * 0.769 + oldB * 0.189;
      g = oldR * 0.349 + oldG * 0.686 + oldB * 0.168;
      b = oldR * 0.272 + oldG * 0.534 + oldB * 0.131;
    }
    if (settings.recolorMode === "monochrome") {
      r = gray * monoR / 255; g = gray * monoG / 255; b = gray * monoB / 255;
    }
    data[index] = clamp(r); data[index + 1] = clamp(g); data[index + 2] = clamp(b);
  }
  return imageData;
}
