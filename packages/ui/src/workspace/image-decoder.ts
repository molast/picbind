"use client";

export type DecodedWorkspaceImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
};

export async function decodeWorkspaceImage(blob: Blob): Promise<DecodedWorkspaceImage> {
  try {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  } catch (bitmapError) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    try {
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw bitmapError;
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => {
          image.src = "";
          URL.revokeObjectURL(url);
        },
      };
    } catch {
      image.src = "";
      URL.revokeObjectURL(url);
      throw new Error("The received image could not be decoded", { cause: bitmapError });
    }
  }
}
