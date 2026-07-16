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
  try {
    const mod = await initWasm();
    if (!mod || typeof mod.generate_share_placeholder !== "function") {
      throw new Error("WASM module does not expose generate_share_placeholder");
    }
    const input = new Uint8Array(await image.arrayBuffer());
    const value = mod.generate_share_placeholder(input) as Partial<ImagePlaceholderMetadata>;
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || Number(value.width) <= 0 || Number(value.height) <= 0 || typeof value.dominantColor !== "string" || !/^#[0-9a-f]{6}$/i.test(value.dominantColor) || typeof value.blurHash !== "string") {
      throw new Error("WASM returned invalid placeholder metadata");
    }
    return value as ImagePlaceholderMetadata;
  } catch (error) {
    if (image.type !== "image/avif") throw error;
    return generateAvifPlaceholder(image);
  }
}

function encode83(value: number, length: number) {
  let encoded = "";
  for (let index = length - 1; index >= 0; index -= 1) {
    encoded += BASE83[Math.floor(value / 83 ** index) % 83];
  }
  return encoded;
}

async function generateAvifPlaceholder(image: Blob): Promise<ImagePlaceholderMetadata> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable for AVIF placeholder generation");
    context.drawImage(bitmap, 0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    const dominantColor = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    // A 1×1 BlurHash is a valid compact solid-color fallback (6 characters).
    return {
      width: bitmap.width,
      height: bitmap.height,
      dominantColor,
      blurHash: `00${encode83((red << 16) + (green << 8) + blue, 4)}`,
    };
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
