import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type StoredIlinkAccount = {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  syncBuffer?: string;
  contextTokens?: Record<string, string>;
  savedAt: string;
};

export class CredentialStore {
  readonly root: string;
  private readonly accountPath: string;
  private readonly lockPath: string;

  constructor(root = process.env.PICBIND_MESSAGING_DATA_DIR || path.join(os.homedir(), ".picbind", "messaging")) {
    this.root = root;
    this.accountPath = path.join(root, "weixin-account.json");
    this.lockPath = path.join(root, "weixin-poll.lock");
  }

  async load(): Promise<StoredIlinkAccount | null> {
    try {
      return JSON.parse(await readFile(this.accountPath, "utf8")) as StoredIlinkAccount;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(account: StoredIlinkAccount) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.accountPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(account, null, 2), { mode: 0o600 });
    await rename(temporaryPath, this.accountPath);
    await chmod(this.accountPath, 0o600);
  }

  async clear() {
    await rm(this.accountPath, { force: true });
  }

  async acquireProcessLock(): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const file = await open(this.lockPath, "wx", 0o600);
        await file.writeFile(String(process.pid));
        await file.close();
        return async () => rm(this.lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const owner = Number(await readFile(this.lockPath, "utf8").catch(() => "0"));
        try {
          if (owner > 0) process.kill(owner, 0);
        } catch (probeError) {
          if ((probeError as NodeJS.ErrnoException).code === "ESRCH") {
            await rm(this.lockPath, { force: true });
            continue;
          }
        }
        throw new Error(`Another Messaging Gateway process (${owner || "unknown"}) is polling this iLink account`);
      }
    }
    throw new Error("Unable to acquire the iLink polling lock");
  }
}
