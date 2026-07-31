"use client";

const ROOT_DIRECTORIES = [
  "database",
  "cache",
  "temp",
  "files",
] as const;

function safeSegment(value: string) {
  return encodeURIComponent(value).replaceAll("%", "_");
}

class OpfsFileStorage {
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;

  segment(value: string) {
    return safeSegment(value);
  }

  async write(path: string, blob: Blob) {
    const { directory, name } = await this.resolveParent(path, true);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    return path;
  }

  async read(path: string) {
    const { directory, name } = await this.resolveParent(path, false);
    const handle = await directory.getFileHandle(name);
    return handle.getFile();
  }

  async remove(path: string | null | undefined) {
    if (!path) return;
    try {
      const { directory, name } = await this.resolveParent(path, false);
      await directory.removeEntry(name);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return;
      throw error;
    }
  }

  private getRoot() {
    if (!this.rootPromise) {
      if (!navigator.storage?.getDirectory) {
        return Promise.reject(new Error("OPFS is unavailable"));
      }
      this.rootPromise = navigator.storage.getDirectory().then(async (root) => {
        await Promise.all(
          ROOT_DIRECTORIES.map((name) =>
            root.getDirectoryHandle(name, { create: true }),
          ),
        );
        return root;
      });
    }
    return this.rootPromise;
  }

  private async resolveParent(path: string, create: boolean) {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (
      !name ||
      !parts.length ||
      !ROOT_DIRECTORIES.includes(parts[0] as (typeof ROOT_DIRECTORIES)[number])
    ) {
      throw new Error(`Invalid OPFS path: ${path}`);
    }
    let directory = await this.getRoot();
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create });
    }
    return { directory, name };
  }
}

export const fileStorage = new OpfsFileStorage();
