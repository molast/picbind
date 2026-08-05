import { invoke } from "@tauri-apps/api/core";
import type { DownloadRepository } from "./download-repository";

const encoder = new TextEncoder();

export const tauriDownloadRepository: DownloadRepository = {
  async save(blob, fileName) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const metadata = encoder.encode(JSON.stringify({
      fileName,
      dataLength: data.byteLength,
    }));
    const frame = new Uint8Array(4 + metadata.byteLength + data.byteLength);
    new DataView(frame.buffer).setUint32(0, metadata.byteLength, true);
    frame.set(metadata, 4);
    frame.set(data, 4 + metadata.byteLength);
    return invoke<boolean>("save_download", frame);
  },
};
