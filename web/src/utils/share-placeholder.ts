"use client";

import { initWasm } from "./wasm-runtime";

const BASE83 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

export type ImagePlaceholderMetadata = {
  width: number;
  height: number;
  dominantColor: string;
  blurHash: string;
};

export async function generateSharePlaceholder(
  image: Blob,
): Promise<ImagePlaceholderMetadata> {
  const mod = await initWasm();
  if (!mod || typeof mod.generate_share_placeholder !== "function") {
    throw new Error("WASM module does not expose generate_share_placeholder");
  }
  try {
    const input = new Uint8Array(await image.arrayBuffer());
    return validatePlaceholderMetadata(mod.generate_share_placeholder(input));
  } catch (error) {
    if (image.type !== "image/avif") throw error;
    return generateAvifPlaceholder(mod, image);
  }
}

function validatePlaceholderMetadata(value: unknown): ImagePlaceholderMetadata {
  const metadata = value as Partial<ImagePlaceholderMetadata> | null;
  if (
    !metadata ||
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height) ||
    Number(metadata.width) <= 0 ||
    Number(metadata.height) <= 0 ||
    typeof metadata.dominantColor !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(metadata.dominantColor) ||
    typeof metadata.blurHash !== "string" ||
    metadata.blurHash.length < 6
  ) {
    throw new Error("WASM returned invalid placeholder metadata");
  }
  return metadata as ImagePlaceholderMetadata;
}

async function generateAvifPlaceholder(
  mod: Record<string, unknown>,
  image: Blob,
): Promise<ImagePlaceholderMetadata> {
  const generateFromRgba = mod.generate_share_placeholder_from_rgba;
  if (typeof generateFromRgba !== "function") {
    throw new Error(
      "WASM module does not expose generate_share_placeholder_from_rgba",
    );
  }
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, 32 / Math.max(bitmap.width, bitmap.height));
    const sampleWidth = Math.max(1, Math.round(bitmap.width * scale));
    const sampleHeight = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Canvas is unavailable for AVIF decoding");
    }
    context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
    const rgba = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    return validatePlaceholderMetadata(
      generateFromRgba(
        bitmap.width,
        bitmap.height,
        sampleWidth,
        sampleHeight,
        rgba,
      ),
    );
  } finally {
    bitmap.close();
  }
}

function decode83(value: string) {
  let result = 0;
  for (const character of value) {
    const digit = BASE83.indexOf(character);
    if (digit === -1) throw new Error("Invalid BlurHash character");
    result = result * 83 + digit;
  }
  return result;
}

function srgbToLinear(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

function signedPow(value: number, exponent: number) {
  return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

export function decodeBlurHash(hash: string, width: number, height: number) {
  if (hash.length < 6 || width <= 0 || height <= 0) {
    throw new Error("Invalid BlurHash input");
  }
  const sizeFlag = decode83(hash[0]);
  const componentsX = (sizeFlag % 9) + 1;
  const componentsY = Math.floor(sizeFlag / 9) + 1;
  if (hash.length !== 4 + 2 * componentsX * componentsY) {
    throw new Error("Invalid BlurHash length");
  }

  const maximumValue = (decode83(hash[1]) + 1) / 166;
  const colors: Array<[number, number, number]> = [];
  const dc = decode83(hash.slice(2, 6));
  colors.push([
    srgbToLinear(dc >> 16),
    srgbToLinear((dc >> 8) & 255),
    srgbToLinear(dc & 255),
  ]);
  for (let index = 1; index < componentsX * componentsY; index += 1) {
    const ac = decode83(hash.slice(4 + index * 2, 6 + index * 2));
    colors.push([
      signedPow(Math.floor(ac / (19 * 19)) - 9, 2) / 81 * maximumValue,
      signedPow(Math.floor(ac / 19) % 19 - 9, 2) / 81 * maximumValue,
      signedPow(ac % 19 - 9, 2) / 81 * maximumValue,
    ]);
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = [0, 0, 0];
      for (let componentY = 0; componentY < componentsY; componentY += 1) {
        for (let componentX = 0; componentX < componentsX; componentX += 1) {
          const basis =
            Math.cos((Math.PI * x * componentX) / width) *
            Math.cos((Math.PI * y * componentY) / height);
          const factor = colors[componentY * componentsX + componentX];
          color[0] += factor[0] * basis;
          color[1] += factor[1] * basis;
          color[2] += factor[2] * basis;
        }
      }
      const offset = (y * width + x) * 4;
      pixels[offset] = linearToSrgb(color[0]);
      pixels[offset + 1] = linearToSrgb(color[1]);
      pixels[offset + 2] = linearToSrgb(color[2]);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
