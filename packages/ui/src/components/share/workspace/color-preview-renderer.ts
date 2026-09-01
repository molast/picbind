import {
  applyWorkspaceColorAdjustments,
  buildToneCurveLut,
  isWorkspaceColorAdjustmentsNeutral,
  type ColorToneRange,
  type WorkspaceColorAdjustments,
} from "../../../utils/workspace-color-adjustments";

export type ColorPreviewQuality = "interactive" | "settled";

export type ColorPreviewRenderResult = {
  width: number;
  height: number;
  resized: boolean;
};

export type ColorPreviewRenderer = {
  readonly canvas: HTMLCanvasElement;
  readonly engine: "webgl2" | "canvas2d";
  render(
    adjustments: WorkspaceColorAdjustments,
    quality: ColorPreviewQuality,
  ): ColorPreviewRenderResult;
  dispose(): void;
};

const INTERACTIVE_MAX_PIXELS = 150_000;
const SELECTIVE_RANGE_HUES = {
  reds: 0,
  yellows: 1 / 6,
  greens: 1 / 3,
  cyans: 1 / 2,
  blues: 2 / 3,
  magentas: 5 / 6,
} as const;
const RECOLOR_MODES = { color: 0, grayscale: 1, sepia: 2, monochrome: 3 } as const;

export function colorPreviewOutputSize(
  width: number,
  height: number,
  quality: ColorPreviewQuality,
) {
  if (quality === "settled" || width * height <= INTERACTIVE_MAX_PIXELS) {
    return { width, height };
  }
  const scale = Math.sqrt(INTERACTIVE_MAX_PIXELS / (width * height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

function hexRgb(value: string): [number, number, number] {
  const source = value.replace("#", "");
  const normalized = source.length === 3
    ? source.split("").map((part) => part + part).join("")
    : source.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((index) => (
    Number.parseInt(normalized.slice(index, index + 2), 16) || 0
  )) as [number, number, number];
}

class CanvasColorPreviewRenderer implements ColorPreviewRenderer {
  readonly canvas = document.createElement("canvas");
  readonly engine = "canvas2d" as const;
  private readonly baseCanvas = document.createElement("canvas");
  private readonly outputContext: CanvasRenderingContext2D;
  private readonly baseContext: CanvasRenderingContext2D;
  private basePixels: ImageData | null = null;

  constructor(private readonly source: HTMLCanvasElement) {
    const outputContext = this.canvas.getContext("2d");
    const baseContext = this.baseCanvas.getContext("2d", { willReadFrequently: true });
    if (!outputContext || !baseContext) throw new Error("Canvas 2D is unavailable");
    this.outputContext = outputContext;
    this.baseContext = baseContext;
  }

  render(adjustments: WorkspaceColorAdjustments, quality: ColorPreviewQuality) {
    const size = colorPreviewOutputSize(this.source.width, this.source.height, quality);
    const resized = this.canvas.width !== size.width || this.canvas.height !== size.height;
    if (resized || !this.basePixels) {
      this.canvas.width = this.baseCanvas.width = size.width;
      this.canvas.height = this.baseCanvas.height = size.height;
      this.baseContext.imageSmoothingEnabled = true;
      this.baseContext.imageSmoothingQuality = "high";
      this.baseContext.clearRect(0, 0, size.width, size.height);
      this.baseContext.drawImage(this.source, 0, 0, size.width, size.height);
      this.basePixels = this.baseContext.getImageData(0, 0, size.width, size.height);
    }
    const pixels = new ImageData(
      new Uint8ClampedArray(this.basePixels.data),
      size.width,
      size.height,
    );
    this.outputContext.putImageData(
      applyWorkspaceColorAdjustments(pixels, adjustments),
      0,
      0,
    );
    return { ...size, resized };
  }

  dispose() {
    this.basePixels = null;
    this.canvas.width = this.canvas.height = 1;
    this.baseCanvas.width = this.baseCanvas.height = 1;
  }
}

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = (aPosition + 1.0) * 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform sampler2D uCurve;
uniform int uNeutral;
uniform float uContrastFactor;
uniform float uGamma;
uniform float uBlackPoint;
uniform float uLevelRange;
uniform float uBrightness;
uniform vec3 uChannelGains;
uniform int uHslActive;
uniform float uHueOffset;
uniform float uSaturationGain;
uniform float uVibranceGain;
uniform int uSelectiveActive;
uniform float uSelectiveTargetHue;
uniform float uSelectiveHueOffset;
uniform float uSelectiveSaturationGain;
uniform float uSelectiveLightnessOffset;
uniform float uTemperature;
uniform int uBalanceActive;
uniform vec3 uBalanceShadows;
uniform vec3 uBalanceMidtones;
uniform vec3 uBalanceHighlights;
uniform float uFilterMix;
uniform vec3 uFilterColor;
uniform int uReplaceEnabled;
uniform vec3 uReplaceSource;
uniform vec3 uReplaceTarget;
uniform float uReplaceTolerance;
uniform float uReplaceStrength;
uniform int uRecolorMode;
uniform vec3 uMonochromeColor;

float channelCurve(float value, float gain) {
  float next = value * 255.0 * gain + uBrightness;
  next = uContrastFactor * (next - 128.0) + 128.0;
  next = 255.0 * pow(clamp((next - uBlackPoint) / uLevelRange, 0.0, 1.0), uGamma);
  int index = int(floor(clamp(next, 0.0, 255.0) + 0.5));
  return texelFetch(uCurve, ivec2(index, 0), 0).r * 255.0;
}

float hueChannel(float p, float q, float hue) {
  float value = hue;
  if (value < 0.0) value += 1.0;
  if (value > 1.0) value -= 1.0;
  if (value < 1.0 / 6.0) return p + (q - p) * 6.0 * value;
  if (value < 0.5) return q;
  if (value < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - value) * 6.0;
  return p;
}

void main() {
  vec4 source = texture(uSource, vUv);
  if (uNeutral == 1) {
    outColor = source;
    return;
  }

  float r = channelCurve(source.r, uChannelGains.r);
  float g = channelCurve(source.g, uChannelGains.g);
  float b = channelCurve(source.b, uChannelGains.b);
  float lightness = 0.0;

  if (uHslActive == 1) {
    float normalizedR = r / 255.0;
    float normalizedG = g / 255.0;
    float normalizedB = b / 255.0;
    float maximum = max(normalizedR, max(normalizedG, normalizedB));
    float minimum = min(normalizedR, min(normalizedG, normalizedB));
    float delta = maximum - minimum;
    lightness = (maximum + minimum) * 0.5;
    float hue = 0.0;
    float saturation = 0.0;
    if (delta != 0.0) {
      saturation = lightness > 0.5
        ? delta / (2.0 - maximum - minimum)
        : delta / (maximum + minimum);
      if (maximum == normalizedR) {
        hue = (normalizedG - normalizedB) / delta + (normalizedG < normalizedB ? 6.0 : 0.0);
      } else if (maximum == normalizedG) {
        hue = (normalizedB - normalizedR) / delta + 2.0;
      } else {
        hue = (normalizedR - normalizedG) / delta + 4.0;
      }
      hue /= 6.0;
    }
    hue = mod(mod(hue + uHueOffset, 1.0) + 1.0, 1.0);
    saturation = clamp(
      saturation * uSaturationGain + (1.0 - saturation) * uVibranceGain,
      0.0,
      1.0
    );
    if (uSelectiveActive == 1) {
      float hueDistance = abs(hue - uSelectiveTargetHue);
      hueDistance = min(hueDistance, 1.0 - hueDistance);
      float selectiveWeight = clamp(1.0 - hueDistance / 0.12, 0.0, 1.0);
      hue += uSelectiveHueOffset * selectiveWeight;
      saturation = clamp(
        saturation * (1.0 + uSelectiveSaturationGain * selectiveWeight),
        0.0,
        1.0
      );
      lightness = clamp(
        lightness + uSelectiveLightnessOffset * selectiveWeight,
        0.0,
        1.0
      );
    }
    hue = mod(mod(hue, 1.0) + 1.0, 1.0);
    if (saturation <= 0.0) {
      r = lightness * 255.0;
      g = r;
      b = r;
    } else {
      float q = lightness < 0.5
        ? lightness * (1.0 + saturation)
        : lightness + saturation - lightness * saturation;
      float p = 2.0 * lightness - q;
      r = hueChannel(p, q, hue + 1.0 / 3.0) * 255.0;
      g = hueChannel(p, q, hue) * 255.0;
      b = hueChannel(p, q, hue - 1.0 / 3.0) * 255.0;
    }
  } else if (uBalanceActive == 1) {
    lightness = (max(r, max(g, b)) + min(r, min(g, b))) / 510.0;
  }

  if (uTemperature != 0.0) {
    r += uTemperature;
    b -= uTemperature;
  }

  if (uBalanceActive == 1) {
    float shadowWeight = clamp((0.58 - lightness) / 0.45, 0.0, 1.0) * 0.9;
    float midtoneWeight = clamp(1.0 - abs(lightness - 0.5) / 0.38, 0.0, 1.0) * 0.9;
    float highlightWeight = clamp((lightness - 0.42) / 0.45, 0.0, 1.0) * 0.9;
    vec3 weights = vec3(shadowWeight, midtoneWeight, highlightWeight);
    vec3 cyanRed = vec3(uBalanceShadows.r, uBalanceMidtones.r, uBalanceHighlights.r);
    vec3 magentaGreen = vec3(uBalanceShadows.g, uBalanceMidtones.g, uBalanceHighlights.g);
    vec3 yellowBlue = vec3(uBalanceShadows.b, uBalanceMidtones.b, uBalanceHighlights.b);
    float redAxis = dot(cyanRed, weights);
    float greenAxis = dot(magentaGreen, weights);
    float blueAxis = dot(yellowBlue, weights);
    r += redAxis - greenAxis * 0.35 - blueAxis * 0.35;
    g += greenAxis - redAxis * 0.35 - blueAxis * 0.35;
    b += blueAxis - redAxis * 0.35 - greenAxis * 0.35;
  }

  if (uFilterMix > 0.0) {
    r = mix(r, uFilterColor.r, uFilterMix);
    g = mix(g, uFilterColor.g, uFilterMix);
    b = mix(b, uFilterColor.b, uFilterMix);
  }

  if (uReplaceEnabled == 1) {
    float distanceValue = distance(vec3(r, g, b), uReplaceSource) * (100.0 / 441.67);
    float matchValue = clamp(1.0 - distanceValue / uReplaceTolerance, 0.0, 1.0) * uReplaceStrength;
    r = mix(r, uReplaceTarget.r, matchValue);
    g = mix(g, uReplaceTarget.g, matchValue);
    b = mix(b, uReplaceTarget.b, matchValue);
  }

  if (uRecolorMode != 0) {
    float gray = clamp(r * 0.299 + g * 0.587 + b * 0.114, 0.0, 255.0);
    if (uRecolorMode == 1) {
      r = gray;
      g = gray;
      b = gray;
    } else if (uRecolorMode == 2) {
      vec3 previous = vec3(r, g, b);
      r = dot(previous, vec3(0.393, 0.769, 0.189));
      g = dot(previous, vec3(0.349, 0.686, 0.168));
      b = dot(previous, vec3(0.272, 0.534, 0.131));
    } else {
      r = gray * uMonochromeColor.r / 255.0;
      g = gray * uMonochromeColor.g / 255.0;
      b = gray * uMonochromeColor.b / 255.0;
    }
  }

  outColor = vec4(clamp(vec3(r, g, b) / 255.0, 0.0, 1.0), source.a);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "WebGL shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function balanceVector(
  settings: WorkspaceColorAdjustments,
  tone: ColorToneRange,
): [number, number, number] {
  const value = settings.balance[tone];
  return [value.cyanRed, value.magentaGreen, value.yellowBlue];
}

class WebGlColorPreviewRenderer implements ColorPreviewRenderer {
  readonly canvas = document.createElement("canvas");
  readonly engine = "webgl2" as const;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly sourceTexture: WebGLTexture;
  private readonly curveTexture: WebGLTexture;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly uniformLocations = new Map<string, WebGLUniformLocation>();
  private curveKey = "";

  constructor(private readonly source: HTMLCanvasElement) {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("WebGL program allocation failed");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "WebGL program linking failed";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    this.program = program;

    const sourceTexture = gl.createTexture();
    const curveTexture = gl.createTexture();
    const vertexBuffer = gl.createBuffer();
    const vertexArray = gl.createVertexArray();
    if (!sourceTexture || !curveTexture || !vertexBuffer || !vertexArray) {
      throw new Error("WebGL preview resource allocation failed");
    }
    this.sourceTexture = sourceTexture;
    this.curveTexture = curveTexture;
    this.vertexBuffer = vertexBuffer;
    this.vertexArray = vertexArray;

    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source,
    );

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, curveTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(this.uniform("uSource"), 0);
    gl.uniform1i(this.uniform("uCurve"), 1);
  }

  private uniform(name: string) {
    const cached = this.uniformLocations.get(name);
    if (cached) return cached;
    const location = this.gl.getUniformLocation(this.program, name);
    if (!location) throw new Error(`WebGL uniform ${name} is unavailable`);
    this.uniformLocations.set(name, location);
    return location;
  }

  render(adjustments: WorkspaceColorAdjustments, quality: ColorPreviewQuality) {
    const gl = this.gl;
    const size = colorPreviewOutputSize(this.source.width, this.source.height, quality);
    const resized = this.canvas.width !== size.width || this.canvas.height !== size.height;
    if (resized) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    gl.viewport(0, 0, size.width, size.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);

    const curveKey = adjustments.curvePoints
      .map((point) => `${point.x}:${point.y}`)
      .join("|");
    if (curveKey !== this.curveKey) {
      this.curveKey = curveKey;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        256,
        1,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        buildToneCurveLut(adjustments.curvePoints),
      );
    }

    const selectiveActive = adjustments.selectiveHue !== 0
      || adjustments.selectiveSaturation !== 0
      || adjustments.selectiveLightness !== 0;
    const hslActive = adjustments.hue !== 0
      || adjustments.saturation !== 0
      || adjustments.vibrance !== 0
      || selectiveActive;
    const balanceActive = (Object.keys(adjustments.balance) as ColorToneRange[])
      .some((tone) => {
        const axes = adjustments.balance[tone];
        return axes.cyanRed !== 0
          || axes.magentaGreen !== 0
          || axes.yellowBlue !== 0;
      });
    const contrast = Math.max(-99, Math.min(99, adjustments.contrast));
    const filterColor = hexRgb(adjustments.photoFilterColor);
    const replaceSource = hexRgb(adjustments.replaceSource);
    const replaceTarget = hexRgb(adjustments.replaceTarget);
    const monochromeColor = hexRgb(adjustments.monochromeColor);
    const set1f = (name: string, value: number) => {
      gl.uniform1f(this.uniform(name), value);
    };
    const set1i = (name: string, value: number) => {
      gl.uniform1i(this.uniform(name), value);
    };
    const set3f = (name: string, value: [number, number, number]) => {
      gl.uniform3f(this.uniform(name), value[0], value[1], value[2]);
    };

    set1i("uNeutral", isWorkspaceColorAdjustmentsNeutral(adjustments) ? 1 : 0);
    set1f("uContrastFactor", (259 * (contrast + 255)) / (255 * (259 - contrast)));
    set1f("uGamma", Math.pow(2, -adjustments.midtone / 100));
    set1f("uBlackPoint", adjustments.blackPoint);
    set1f("uLevelRange", Math.max(1, adjustments.whitePoint - adjustments.blackPoint));
    set1f("uBrightness", adjustments.brightness * 2.55);
    set3f("uChannelGains", [
      1 + adjustments.redChannel / 100,
      1 + adjustments.greenChannel / 100,
      1 + adjustments.blueChannel / 100,
    ]);
    set1i("uHslActive", hslActive ? 1 : 0);
    set1f("uHueOffset", adjustments.hue / 360);
    set1f("uSaturationGain", 1 + adjustments.saturation / 100);
    set1f("uVibranceGain", adjustments.vibrance / 140);
    set1i("uSelectiveActive", selectiveActive ? 1 : 0);
    set1f("uSelectiveTargetHue", SELECTIVE_RANGE_HUES[adjustments.selectiveRange]);
    set1f("uSelectiveHueOffset", adjustments.selectiveHue / 360);
    set1f("uSelectiveSaturationGain", adjustments.selectiveSaturation / 100);
    set1f("uSelectiveLightnessOffset", adjustments.selectiveLightness / 200);
    set1f("uTemperature", adjustments.temperature * 0.9);
    set1i("uBalanceActive", balanceActive ? 1 : 0);
    set3f("uBalanceShadows", balanceVector(adjustments, "shadows"));
    set3f("uBalanceMidtones", balanceVector(adjustments, "midtones"));
    set3f("uBalanceHighlights", balanceVector(adjustments, "highlights"));
    set1f("uFilterMix", adjustments.photoFilterDensity / 100);
    set3f("uFilterColor", filterColor);
    set1i("uReplaceEnabled", adjustments.replaceEnabled ? 1 : 0);
    set3f("uReplaceSource", replaceSource);
    set3f("uReplaceTarget", replaceTarget);
    set1f("uReplaceTolerance", Math.max(1, adjustments.replaceTolerance));
    set1f("uReplaceStrength", adjustments.replaceStrength / 100);
    set1i("uRecolorMode", RECOLOR_MODES[adjustments.recolorMode]);
    set3f("uMonochromeColor", monochromeColor);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.flush();
    return { ...size, resized };
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.curveTexture);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
    this.canvas.width = this.canvas.height = 1;
  }
}

export function createColorPreviewRenderer(source: HTMLCanvasElement): ColorPreviewRenderer {
  try {
    return new WebGlColorPreviewRenderer(source);
  } catch {
    return new CanvasColorPreviewRenderer(source);
  }
}
