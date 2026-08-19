export interface DownloadRepository {
  save(blob: Blob, fileName: string): Promise<boolean>;
}
