export type CachedCompressedImage = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceSize: number;
  name: string;
  type: string;
  format: string;
  size: number;
  blob: Blob;
  createdAt: number;
};
