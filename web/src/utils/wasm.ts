"use client";

import { compressImageWithAlgorithms } from "@/utils/compress-algorithms";
import { buildCompressedFileName, type OutputFormat } from "@/utils/compress-shared";
import { initWasm } from "@/utils/wasm-runtime";

export type { OutputFormat };
export { buildCompressedFileName, initWasm };

export async function compressWithWasm(
  file: File,
  quality = 80,
  targetFormat?: OutputFormat,
  allowAlphaLoss = false,
) {
  return compressImageWithAlgorithms(file, quality, targetFormat, allowAlphaLoss);
}
