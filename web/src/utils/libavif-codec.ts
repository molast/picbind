"use client";

export type LibavifEncodeOptions = {
  quality: number;
  qualityAlpha: number;
  denoiseLevel: number;
  tileColsLog2: number;
  tileRowsLog2: number;
  speed: number;
  subsample: number;
  chromaDeltaQ: boolean;
  sharpness: number;
  tune: number;
  enableSharpYUV: boolean;
  bitDepth: 8;
  lossless: boolean;
};

type RawLibavifModule = {
  encode(
    data: Uint8Array,
    width: number,
    height: number,
    options: LibavifEncodeOptions,
  ): Uint8Array | null;
};

let cachedModule: Promise<RawLibavifModule> | null = null;

async function getLibavifModule() {
  if (!cachedModule) {
    cachedModule = import("@jsquash/avif/codec/enc/avif_enc.js").then(
      async ({ default: createModule }) =>
        (await createModule({ noInitialRun: true })) as RawLibavifModule,
    );
  }
  return cachedModule;
}

export async function encodeWithLibavif(
  image: ImageData,
  options: LibavifEncodeOptions,
) {
  const encoderModule = await getLibavifModule();
  const data = new Uint8Array(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength,
  );
  let encoded: Uint8Array | null = null;
  let initialError: unknown;
  try {
    encoded = encoderModule.encode(data, image.width, image.height, options);
  } catch (error) {
    initialError = error;
  }
  if (!encoded) {
    const conservativeOptions: LibavifEncodeOptions = {
      ...options,
      qualityAlpha: options.lossless ? 100 : -1,
      tileColsLog2: 0,
      tileRowsLog2: 0,
      speed: Math.max(6, options.speed),
      subsample: options.lossless ? 3 : 1,
      tune: 0,
      chromaDeltaQ: false,
      sharpness: 0,
      enableSharpYUV: false,
    };
    try {
      encoded = encoderModule.encode(
        data,
        image.width,
        image.height,
        conservativeOptions,
      );
    } catch (error) {
      const initialMessage =
        initialError instanceof Error
          ? initialError.message
          : String(initialError ?? "");
      const fallbackMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `libavif/libaom failed to encode ${image.width}x${image.height} image` +
          (initialMessage || fallbackMessage
            ? ` (${[initialMessage, fallbackMessage].filter(Boolean).join("; ")})`
            : ""),
      );
    }
  }
  if (!encoded) {
    throw new Error(
      `libavif/libaom failed to encode ${image.width}x${image.height} image`,
    );
  }
  return encoded.slice();
}
