import Dexie, { type EntityTable } from "dexie";
import { defaultWorkspaceStyle, type WorkspaceActivity, type WorkspaceCommit, type WorkspaceIdentity, type WorkspaceImage, type WorkspaceProposal } from "./types";
import { normalizeWorkspaceImageLocation } from "./image-flow";
import { getImageStorageRepository } from "../database/repositories/image-storage-repository-selector";

type StoredImage = Omit<WorkspaceImage, "source" | "preview"> & { source?: Blob; preview?: Blob };
type CacheEntry = { key: string; workspaceId: string; kind: "preview" | "source" | "commit" | "activity"; accessedAt: number; expiresAt: number | null };

class WorkspaceDatabase extends Dexie {
  workspaces!: EntityTable<WorkspaceIdentity, "workspaceId">;
  images!: EntityTable<StoredImage, "imageId">;
  proposals!: EntityTable<WorkspaceProposal, "proposalId">;
  commits!: EntityTable<WorkspaceCommit, "commitId">;
  activities!: EntityTable<WorkspaceActivity & { workspaceId: string }, "eventId">;
  cache!: EntityTable<CacheEntry, "key">;

  constructor(name = "PicBindWorkspaceV3") {
    super(name);
    this.version(1).stores({
      workspaces: "workspaceId, updatedAt, shareToken",
      images: "imageId, workspaceId, [workspaceId+updatedAt], state",
      proposals: "proposalId, workspaceId, imageId, state, createdAt",
      commits: "commitId, imageId, createdAt",
      activities: "eventId, workspaceId, [workspaceId+createdAt]",
      cache: "key, workspaceId, kind, expiresAt, accessedAt",
    });
  }
}

let database: WorkspaceDatabase | null = null;
export function getWorkspaceDatabase() { return database ??= new WorkspaceDatabase(); }
export function setWorkspaceDatabaseForTests(value: WorkspaceDatabase | null) { database = value; }
export { WorkspaceDatabase };

const LOCAL_WORKSPACE_KEY = "picbind.workspace.local-id";
const DAY = 86_400_000;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export async function restoreLocalWorkspace(now = Date.now()): Promise<WorkspaceIdentity> {
  let workspaceId = localStorage.getItem(LOCAL_WORKSPACE_KEY);
  if (workspaceId) {
    const restored = await getWorkspaceDatabase().workspaces.get(workspaceId);
    if (restored) return restored;
  }
  workspaceId = id("local");
  const workspace: WorkspaceIdentity = { workspaceId, name: "My Workspace", role: "owner", shareToken: null,
    ownerCapability: null, createdAt: now, updatedAt: now, style: defaultWorkspaceStyle() };
  await getWorkspaceDatabase().workspaces.put(workspace);
  localStorage.setItem(LOCAL_WORKSPACE_KEY, workspaceId);
  return workspace;
}

export async function saveWorkspace(workspace: WorkspaceIdentity) { await getWorkspaceDatabase().workspaces.put(workspace); }
export async function promoteLocalWorkspace(previousId: string, workspace: WorkspaceIdentity) {
  const db = getWorkspaceDatabase();
  const repository = getImageStorageRepository();
  const [stored, proposals, activities, cacheEntries] = await Promise.all([
    db.images.where("workspaceId").equals(previousId).toArray(),
    db.proposals.where("workspaceId").equals(previousId).toArray(),
    db.activities.where("workspaceId").equals(previousId).toArray(),
    db.cache.where("workspaceId").equals(previousId).toArray(),
  ]);
  const images = await Promise.all(stored.map(async (image) => {
    try {
      const [source, preview] = await Promise.all([
        repository.read("room", previousId, image.imageId, "original", image.mimeType),
        repository.read("room", previousId, image.imageId, "thumbnail", image.preview?.type || "image/webp"),
      ]);
      return { ...image, source: source || image.source, preview: preview || image.preview, workspaceId: workspace.workspaceId };
    } catch { return { ...image, workspaceId: workspace.workspaceId }; }
  }));
  const commits = (await Promise.all(stored.map((image) =>
    db.commits.where("imageId").equals(image.imageId).toArray()))).flat();
  const commitSnapshots = await Promise.all(commits.map(async (commit) => {
    if (!commit.snapshotCached && !commit.snapshot) return null;
    try {
      return await repository.read(
        "room", previousId, `commit:${commit.commitId}`, "original",
        commit.snapshotMimeType || "application/octet-stream",
      ) || commit.snapshot || null;
    } catch {
      return commit.snapshot || null;
    }
  }));
  await db.transaction("rw", db.workspaces, db.images, db.proposals, db.activities, db.cache, async () => {
    await db.images.bulkPut(images);
    await db.proposals.bulkPut(proposals.map((value) => ({ ...value, workspaceId: workspace.workspaceId })));
    await db.activities.bulkPut(activities.map((value) => ({ ...value, workspaceId: workspace.workspaceId })));
    await db.cache.bulkDelete(cacheEntries.map((value) => value.key));
    await db.cache.bulkPut(cacheEntries.map((value) => ({
      ...value,
      key: value.key.replace(`:${previousId}:`, `:${workspace.workspaceId}:`),
      workspaceId: workspace.workspaceId,
    })));
    await db.workspaces.delete(previousId);
    await db.workspaces.put(workspace);
  });
  await Promise.all(images.map(async (image) => {
    await saveWorkspaceImage(image);
    await repository.delete("room", previousId, image.imageId).catch(() => undefined);
  }));
  await Promise.all(commits.map(async (commit, index) => {
    await saveCommit({ ...commit, snapshot: commitSnapshots[index] || undefined });
    await repository.delete("room", previousId, `commit:${commit.commitId}`).catch(() => undefined);
  }));
  localStorage.setItem(LOCAL_WORKSPACE_KEY, workspace.workspaceId);
}
export async function listWorkspaceImages(workspaceId: string) {
  const values = await getWorkspaceDatabase().images.where("workspaceId").equals(workspaceId).sortBy("createdAt");
  const db = getWorkspaceDatabase();
  const workspace = await db.workspaces.get(workspaceId);
  const now = Date.now();
  const cacheEntries = await db.cache.where("workspaceId").equals(workspaceId)
    .filter((entry) => entry.expiresAt === null || entry.expiresAt > now)
    .toArray();
  const cacheKeys = new Set(cacheEntries.map((entry) => entry.key));
  const repository = getImageStorageRepository();
  return Promise.all(values.map(async (image) => {
    const storageRecord = await repository.get<Record<string, unknown>>(
      "room", workspaceId, image.imageId,
    ).catch(() => null);
    const storedMetadata = storageRecord?.metadata || {};
    const merged = {
      ...image,
      ...storedMetadata,
    } as StoredImage;
    const shared = merged.shared ?? merged.state !== "private";
    const normalized = {
      ...merged,
      shared,
      workspaceLocation: normalizeWorkspaceImageLocation({ ...merged, shared }, workspace?.role || "owner"),
    };
    const sourceCached = Boolean(
      image.sourceCached
      || image.source
      || (workspace?.role === "owner" && storageRecord && storageRecord.byteSize > 0)
      || cacheKeys.has(`source:${workspaceId}:${image.imageId}`),
    );
    const previewCached = Boolean(
      image.previewCached
      || image.preview
      || storageRecord?.thumbnailAvailable
      || cacheKeys.has(`preview:${workspaceId}:${image.imageId}`),
    );
    return {
      ...normalized,
      sourceCached,
      previewCached,
      source: undefined,
      preview: undefined,
    };
  }));
}

export async function readWorkspaceImageSource(image: WorkspaceImage) {
  try {
    const source = await getImageStorageRepository().read(
      "room", image.workspaceId, image.imageId, "original", image.mimeType,
    );
    if (source) return source;
  } catch {
    // IndexedDB is the compatibility fallback when file-backed storage is unavailable.
  }
  return (await getWorkspaceDatabase().images.get(image.imageId))?.source ?? null;
}

export async function readWorkspaceImagePreview(image: WorkspaceImage) {
  try {
    const preview = await getImageStorageRepository().read(
      "room", image.workspaceId, image.imageId, "thumbnail", "image/webp",
    );
    if (preview) return preview;
  } catch {
    // IndexedDB is the compatibility fallback when file-backed storage is unavailable.
  }
  return (await getWorkspaceDatabase().images.get(image.imageId))?.preview ?? null;
}
export async function saveWorkspaceImage(
  image: WorkspaceImage,
  options: { writeBlobs?: boolean } = {},
) {
  const { source, preview, ...rawMetadata } = image;
  const writeBlobs = options.writeBlobs ?? true;
  const db = getWorkspaceDatabase();
  const existing = await db.images.get(image.imageId);
  const metadata = {
    ...rawMetadata,
    sourceCached: rawMetadata.sourceCached || Boolean(source) || existing?.sourceCached || Boolean(existing?.source),
    previewCached: rawMetadata.previewCached || Boolean(preview) || existing?.previewCached || Boolean(existing?.preview),
  };
  if (!writeBlobs) {
    try {
      await getImageStorageRepository().put({
        scope: "room",
        scopeKey: image.workspaceId,
        id: image.imageId,
        metadata: metadata as unknown as Record<string, unknown>,
        mimeType: image.mimeType,
        createdAt: image.createdAt,
      });
    } catch {
      // The metadata table below remains the fallback when native/OPFS storage is unavailable.
    }
    await db.images.put({ ...existing, ...metadata });
    return;
  }
  try {
    await getImageStorageRepository().put({ scope: "room", scopeKey: image.workspaceId, id: image.imageId,
      metadata: metadata as unknown as Record<string, unknown>, mimeType: image.mimeType,
      data: writeBlobs ? source : undefined, thumbnail: writeBlobs ? preview : undefined,
      thumbnailMimeType: writeBlobs ? preview?.type : undefined, createdAt: image.createdAt });
    await db.images.put(metadata);
  } catch {
    // IndexedDB Blob fallback is used only where OPFS/native storage is unavailable.
    await db.images.put(image);
  }
  const now=Date.now(),workspace=await db.workspaces.get(image.workspaceId),entries:CacheEntry[]=[];
  if(preview)entries.push({key:`preview:${image.workspaceId}:${image.imageId}`,workspaceId:image.workspaceId,kind:"preview",accessedAt:now,expiresAt:now+30*DAY});
  if(source&&workspace?.role==="collaborator")entries.push({key:`source:${image.workspaceId}:${image.imageId}`,workspaceId:image.workspaceId,kind:"source",accessedAt:now,expiresAt:now+90*DAY});
  if(entries.length)await db.cache.bulkPut(entries);
}
export async function deleteWorkspaceImage(imageId: string) {
  const db = getWorkspaceDatabase();
  const image = await db.images.get(imageId);
  if (image) await getImageStorageRepository().delete("room", image.workspaceId, imageId).catch(() => undefined);
  const cacheKeys = image
    ? (await db.cache.where("workspaceId").equals(image.workspaceId)
      .filter((entry) => (entry.kind === "preview" || entry.kind === "source")
        && entry.key.endsWith(`:${imageId}`))
      .toArray())
      .map((entry) => entry.key)
    : [];
  await db.transaction("rw", db.images, db.cache, async () => {
    await db.images.delete(imageId);
    if (cacheKeys.length) await db.cache.bulkDelete(cacheKeys);
  });
}
export async function saveProposal(value: WorkspaceProposal) { await getWorkspaceDatabase().proposals.put(value); }
export async function listProposals(workspaceId: string) { return getWorkspaceDatabase().proposals.where("workspaceId").equals(workspaceId).sortBy("createdAt"); }
export async function saveCommit(value: WorkspaceCommit) {
  const table = getWorkspaceDatabase().commits;
  const { snapshot, ...metadata } = value;
  const image = await getWorkspaceDatabase().images.get(value.imageId);
  let snapshotStoredAsFile = false;
  if (snapshot && image) {
    try {
      await getImageStorageRepository().put({
        scope: "room",
        scopeKey: image.workspaceId,
        id: `commit:${value.commitId}`,
        metadata: metadata as unknown as Record<string, unknown>,
        mimeType: value.snapshotMimeType || snapshot.type || image.mimeType,
        data: snapshot,
        createdAt: value.createdAt,
      });
      snapshotStoredAsFile = true;
    } catch {
      // IndexedDB Blob fallback is retained only when file-backed storage is unavailable.
    }
  }
  await table.put({
    ...metadata,
    snapshotCached: Boolean(snapshot || value.snapshotCached),
    snapshot: snapshotStoredAsFile ? undefined : snapshot,
  });
  const commits = await table.where("imageId").equals(value.imageId).sortBy("createdAt");
  if (commits.length > 20) {
    const expired = commits.slice(0, commits.length - 20);
    await table.bulkDelete(expired.map((item) => item.commitId));
    if (image) await Promise.all(expired.map((item) =>
      getImageStorageRepository().delete("room", image.workspaceId, `commit:${item.commitId}`).catch(() => undefined)));
  }
  if(image)await getWorkspaceDatabase().cache.put({key:`commit:${image.workspaceId}:${value.commitId}`,workspaceId:image.workspaceId,kind:"commit",accessedAt:Date.now(),expiresAt:Date.now()+30*DAY});
}
export async function listCommits(imageId: string) { const values=await getWorkspaceDatabase().commits.where("imageId").equals(imageId).sortBy("createdAt");const cutoff=Date.now()-30*DAY;return values.map((value)=>value.createdAt<cutoff?{...value,snapshotCached:false,snapshot:undefined}:{...value,snapshot:undefined}); }
export async function readWorkspaceCommitSnapshot(commit: WorkspaceCommit) {
  if (!commit.snapshotCached) return null;
  const image = await getWorkspaceDatabase().images.get(commit.imageId);
  if (!image) return null;
  try {
    const snapshot = await getImageStorageRepository().read(
      "room", image.workspaceId, `commit:${commit.commitId}`, "original",
      commit.snapshotMimeType || image.mimeType,
    );
    if (snapshot) return snapshot;
  } catch {
    // Older databases may still contain the pre-file-cache Blob record.
  }
  return (await getWorkspaceDatabase().commits.get(commit.commitId))?.snapshot ?? null;
}
export async function saveActivity(workspaceId: string, value: WorkspaceActivity) {
  const table = getWorkspaceDatabase().activities;
  await table.put({ ...value, workspaceId });
  const values = await table.where("workspaceId").equals(workspaceId).sortBy("createdAt");
  if (values.length > 50) await table.bulkDelete(values.slice(0, values.length - 50).map((item) => item.eventId));
  await getWorkspaceDatabase().cache.put({key:`activity:${workspaceId}:${value.eventId}`,workspaceId,kind:"activity",accessedAt:Date.now(),expiresAt:value.createdAt+30*DAY});
}
export async function listActivities(workspaceId: string, now = Date.now()) {
  const cutoff = now - 30 * 86_400_000;
  const table = getWorkspaceDatabase().activities;
  const values = await table.where("workspaceId").equals(workspaceId).filter((item) => item.createdAt >= cutoff).sortBy("createdAt");
  return values.slice(-50);
}
export async function purgeExpiredCache(now = Date.now()) {
  const db=getWorkspaceDatabase(),table = db.cache;
  const expired = await table.filter((item) => item.expiresAt !== null && item.expiresAt <= now).toArray();
  const repository = getImageStorageRepository();
  for(const entry of expired){const recordId=entry.key.split(":").at(-1)||"";if(entry.kind==="preview"||entry.kind==="source"){const image=await db.images.get(recordId);if(image){await db.images.put({...image,[entry.kind]:undefined,[entry.kind==="preview"?"previewCached":"sourceCached"]:false});await repository.deleteVariant("room",image.workspaceId,image.imageId,entry.kind==="preview"?"thumbnail":"original").catch(()=>undefined);}}else if(entry.kind==="commit"){const commit=await db.commits.get(recordId);if(commit){await db.commits.put({...commit,snapshotCached:false,snapshot:undefined});await repository.delete("room",entry.workspaceId,`commit:${recordId}`).catch(()=>undefined);}}else if(entry.kind==="activity")await db.activities.delete(recordId);}
  await table.bulkDelete(expired.map((item) => item.key));
  await repository.pruneCache({maxBytes:512*1024*1024,maxAgeMillis:90*DAY}).catch(()=>undefined);
  return expired.length;
}
