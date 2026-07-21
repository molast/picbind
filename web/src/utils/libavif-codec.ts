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
  const encoded = encoderModule.encode(data, image.width, image.height, options);
  if (!encoded) {
    throw new Error("libavif/libaom failed to encode the image");
  }
  return encoded.slice();
}
