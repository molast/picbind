"use client";

// Owns the browser AVIF runtime shared by Web and Room workers.

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

export type AvifAssetLocator = (path: string, prefix: string) => string;

export type LibavifCodecConfig = {
  locateFile?: AvifAssetLocator;
};

type RawLibavifModule = {
  encode(
    data: Uint8Array,
    width: number,
    height: number,
    options: LibavifEncodeOptions,
  ): Uint8Array | null;
};

type ModuleCache = {
  singleThreaded: Promise<RawLibavifModule> | null;
  multiThreaded: Promise<RawLibavifModule> | null;
};

const defaultCache: ModuleCache = {
  singleThreaded: null,
  multiThreaded: null,
};
const cachesByLocator = new WeakMap<AvifAssetLocator, ModuleCache>();

function cacheFor(locateFile?: AvifAssetLocator) {
  if (!locateFile) return defaultCache;
  let cache = cachesByLocator.get(locateFile);
  if (!cache) {
    cache = { singleThreaded: null, multiThreaded: null };
    cachesByLocator.set(locateFile, cache);
  }
  return cache;
}

function canUseThreadedEncoder() {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof globalThis.SharedArrayBuffer !== "undefined"
  );
}

async function createLibavifModule(
  threaded: boolean,
  locateFile?: AvifAssetLocator,
) {
  const { default: createModule } = threaded
    ? await import("@jsquash/avif/codec/enc/avif_enc_mt.js")
    : await import("@jsquash/avif/codec/enc/avif_enc.js");
  return (await createModule({
    noInitialRun: true,
    ...(locateFile ? { locateFile } : {}),
  })) as RawLibavifModule;
}

function getLibavifModule(threaded: boolean, locateFile?: AvifAssetLocator) {
  const cache = cacheFor(locateFile);
  const key = threaded ? "multiThreaded" : "singleThreaded";
  cache[key] ??= createLibavifModule(threaded, locateFile);
  return cache[key];
}

function invalidateLibavifModule(
  threaded: boolean,
  locateFile?: AvifAssetLocator,
) {
  const cache = cacheFor(locateFile);
  cache[threaded ? "multiThreaded" : "singleThreaded"] = null;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export async function encodeWithLibavif(
  image: ImageData,
  options: LibavifEncodeOptions,
  config: LibavifCodecConfig = {},
) {
  const locateFile = config.locateFile;
  const data = new Uint8Array(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength,
  );
  const initialOptions = optionsForImageSize(image.width, image.height, options);
  const threaded = canUseThreadedEncoder();
  let encoded: Uint8Array | null = null;
  let initialError: unknown;

  try {
    const encoder = await getLibavifModule(threaded, locateFile);
    encoded = encoder.encode(data, image.width, image.height, initialOptions);
  } catch (error) {
    initialError = error;
    invalidateLibavifModule(threaded, locateFile);
  }

  if (!encoded) {
    invalidateLibavifModule(threaded, locateFile);
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
    let fallbackError: unknown;

    try {
      const encoder = await getLibavifModule(threaded, locateFile);
      encoded = encoder.encode(
        data,
        image.width,
        image.height,
        conservativeOptions,
      );
    } catch (error) {
      fallbackError = error;
      invalidateLibavifModule(threaded, locateFile);
    }

    if (!encoded && threaded) {
      try {
        const encoder = await getLibavifModule(false, locateFile);
        encoded = encoder.encode(
          data,
          image.width,
          image.height,
          conservativeOptions,
        );
      } catch (error) {
        fallbackError = error;
        invalidateLibavifModule(false, locateFile);
      }
    }

    if (!encoded) {
      const details = [initialError, fallbackError]
        .map(errorMessage)
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `libavif/libaom failed to encode ${image.width}x${image.height} image` +
          (details ? ` (${details})` : ""),
      );
    }
  }

  return encoded.slice();
}
