import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type StoredMedia = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
};

const MEDIA_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class MediaStore {
  private readonly root: string;

  constructor(dataRoot: string) {
    this.root = path.join(dataRoot, "media");
  }

  async save(data: Uint8Array, fileName: string, mimeType: string): Promise<StoredMedia> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const media: StoredMedia = {
      id: randomUUID(),
      fileName,
      mimeType,
      size: data.byteLength,
      createdAt: Date.now(),
    };
    await Promise.all([
      writeFile(this.dataPath(media.id), data, { mode: 0o600 }),
      writeFile(this.metadataPath(media.id), JSON.stringify(media), { mode: 0o600 }),
    ]);
    void this.cleanup().catch(() => undefined);
    return media;
  }

  async read(id: string) {
    this.assertId(id);
    const metadata = JSON.parse(await readFile(this.metadataPath(id), "utf8")) as StoredMedia;
    const data = await readFile(this.dataPath(id));
    return { metadata, data };
  }

  async cleanup(ttlMs = Number(process.env.PICBIND_MESSAGING_MEDIA_TTL_MS || DEFAULT_TTL_MS)) {
    const entries = await readdir(this.root).catch(() => [] as string[]);
    const now = Date.now();
    await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map(async (entry) => {
      const metadataPath = path.join(this.root, entry);
      const details = await stat(metadataPath).catch(() => null);
      if (!details || now - details.mtimeMs < ttlMs) return;
      const id = entry.slice(0, -5);
      await Promise.all([
        rm(metadataPath, { force: true }),
        rm(this.dataPath(id), { force: true }),
      ]);
    }));
  }

  private assertId(id: string) {
    if (!MEDIA_ID_PATTERN.test(id)) throw new Error("Invalid media id");
  }

  private dataPath(id: string) {
    return path.join(this.root, `${id}.bin`);
  }

  private metadataPath(id: string) {
    return path.join(this.root, `${id}.json`);
  }
}
