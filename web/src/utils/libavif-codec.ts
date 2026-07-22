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

function canUseThreadedEncoder() {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof globalThis.SharedArrayBuffer !== "undefined"
  );
}

async function createLibavifModule(threaded: boolean) {
  const { default: createModule } = threaded
    ? await import("@jsquash/avif/codec/enc/avif_enc_mt.js")
    : await import("@jsquash/avif/codec/enc/avif_enc.js");
  return (await createModule({ noInitialRun: true })) as RawLibavifModule;
}

async function getLibavifModule() {
  if (!cachedModule) {
    cachedModule = createLibavifModule(canUseThreadedEncoder());
  }
  return cachedModule;
}

function optionsForImageSize(
  width: number,
  height: number,
  options: LibavifEncodeOptions,
) {
  const pixelCount = width * height;
  if (pixelCount >= 24_000_000) {
    return {
      ...options,
      speed: Math.max(options.speed, 9),
      tileColsLog2: Math.max(options.tileColsLog2, 2),
      tileRowsLog2: Math.max(options.tileRowsLog2, 2),
    };
  }
  if (pixelCount >= 12_000_000) {
    return {
      ...options,
      speed: Math.max(options.speed, 8),
      tileColsLog2: Math.max(options.tileColsLog2, 2),
      tileRowsLog2: Math.max(options.tileRowsLog2, 1),
    };
  }
  return options;
}

export async function encodeWithLibavif(
  image: ImageData,
  options: LibavifEncodeOptions,
) {
  const data = new Uint8Array(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength,
  );
  const initialOptions = optionsForImageSize(
    image.width,
    image.height,
    options,
  );
  let encoded: Uint8Array | null = null;
  let initialError: unknown;
  try {
    const encoder = await getLibavifModule();
    encoded = encoder.encode(data, image.width, image.height, initialOptions);
  } catch (error) {
    initialError = error;
    // Emscripten modules remain aborted after an `unreachable` trap. A retry
    // must use a new instance rather than the cached, poisoned module.
    cachedModule = null;
  }
  if (!encoded) {
    cachedModule = null;
    const conservativeOptions = optionsForImageSize(image.width, image.height, {
      ...initialOptions,
      qualityAlpha: options.lossless ? 100 : -1,
      speed: Math.max(8, initialOptions.speed),
      subsample: options.lossless ? 3 : 1,
      tune: 0,
      chromaDeltaQ: false,
      sharpness: 0,
      enableSharpYUV: false,
    });
    try {
      const encoder = await getLibavifModule();
      encoded = encoder.encode(
        data,
        image.width,
        image.height,
        conservativeOptions,
      );
    } catch (error) {
      cachedModule = null;
      let finalError: unknown = error;
      if (canUseThreadedEncoder()) {
        try {
          const singleThreaded = await createLibavifModule(false);
          cachedModule = Promise.resolve(singleThreaded);
          encoded = singleThreaded.encode(
            data,
            image.width,
            image.height,
            conservativeOptions,
          );
        } catch (singleThreadedError) {
          cachedModule = null;
          finalError = singleThreadedError;
        }
      }
      if (encoded) {
        return encoded.slice();
      }
      const initialMessage =
        initialError instanceof Error
          ? initialError.message
          : String(initialError ?? "");
      const fallbackMessage =
        error instanceof Error ? error.message : String(error);
      const finalMessage =
        finalError instanceof Error ? finalError.message : String(finalError);
      throw new Error(
        `libavif/libaom failed to encode ${image.width}x${image.height} image` +
          (initialMessage || fallbackMessage || finalMessage
            ? ` (${[initialMessage, fallbackMessage, finalMessage]
                .filter(Boolean)
                .join("; ")})`
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
