import Dexie, { type EntityTable } from "dexie";
import type { ImageProcessingSource } from "@picbind/shared";
import { defaultWorkspaceStyle, type WorkspaceActivity, type WorkspaceCommit, type WorkspaceIdentity, type WorkspaceImage, type WorkspaceProposal } from "./types";
import { normalizeWorkspaceImageLocation } from "./image-flow";
import { getImageStorageRepository } from "../database/repositories/image-storage-repository-selector";
import { createPrefixedId } from "../utils/id";

type StoredImage = Omit<WorkspaceImage, "source" | "preview" | "sourceAddress"> & { source?: Blob; preview?: Blob };
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
    this.version(2).stores({
      workspaces: "workspaceId, updatedAt, shareToken",
      images: "imageId, workspaceId, [workspaceId+updatedAt], state",
      proposals: "proposalId, workspaceId, imageId, state, createdAt",
      commits: "commitId, imageId, createdAt",
      activities: "eventId, workspaceId, scope, [workspaceId+scope+createdAt], [workspaceId+createdAt]",
      cache: "key, workspaceId, kind, expiresAt, accessedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("activities").toCollection().modify((activity) => {
        activity.scope = "workspaceLog";
      });
    });
  }
}

let database: WorkspaceDatabase | null = null;
export function getWorkspaceDatabase() { return database ??= new WorkspaceDatabase(); }
export function setWorkspaceDatabaseForTests(value: WorkspaceDatabase | null) { database = value; }
export { WorkspaceDatabase };

const LOCAL_WORKSPACE_KEY = "picbind.workspace.local-id";
const DAY = 86_400_000;

export async function restoreLocalWorkspace(now = Date.now()): Promise<WorkspaceIdentity> {
  let workspaceId = localStorage.getItem(LOCAL_WORKSPACE_KEY);
  if (workspaceId) {
    const restored = await getWorkspaceDatabase().workspaces.get(workspaceId);
    if (restored) return restored;
  }
  workspaceId = createPrefixedId("local");
  const workspace: WorkspaceIdentity = { workspaceId, name: "My Workspace", role: "owner", shareToken: null,
    ownerCapability: null, createdAt: now, updatedAt: now, style: defaultWorkspaceStyle() };
  await getWorkspaceDatabase().workspaces.put(workspace);
  localStorage.setItem(LOCAL_WORKSPACE_KEY, workspaceId);
  return workspace;
}

export async function saveWorkspace(workspace: WorkspaceIdentity) { await getWorkspaceDatabase().workspaces.put(workspace); }
export async function restoreProvisionedWorkspace(workspace: WorkspaceIdentity) {
  const db = getWorkspaceDatabase();
  const localId = localStorage.getItem(LOCAL_WORKSPACE_KEY);
  if (!localId || localId === workspace.workspaceId) {
    const existing = await db.workspaces.get(workspace.workspaceId);
    const restored = existing
      ? { ...workspace, style: existing.style }
      : workspace;
    await db.workspaces.put(restored);
    localStorage.setItem(LOCAL_WORKSPACE_KEY, restored.workspaceId);
    return restored;
  }
  const local = await db.workspaces.get(localId);
  // Only the anonymous local workspace may be promoted after login. A
  // provisioned owner or collaborator Workspace must keep its own cache when
  // the user opens another share ID.
  const isAnonymousLocal = local
    && local.shareToken === null
    && local.ownerCapability === null;
  if (isAnonymousLocal) {
    const promoted = { ...workspace, style: local.style };
    await promoteLocalWorkspace(localId, promoted);
    return promoted;
  }
  await db.workspaces.put(workspace);
  localStorage.setItem(LOCAL_WORKSPACE_KEY, workspace.workspaceId);
  return workspace;
}
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
        repository.read("workspace", previousId, image.imageId, "original", image.mimeType),
        repository.read("workspace", previousId, image.imageId, "thumbnail", image.preview?.type || "image/webp"),
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
        "workspace", previousId, `commit:${commit.commitId}`, "original",
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
    await repository.delete("workspace", previousId, image.imageId).catch(() => undefined);
  }));
  await Promise.all(commits.map(async (commit, index) => {
    await saveCommit({ ...commit, snapshot: commitSnapshots[index] || undefined });
    await repository.delete("workspace", previousId, `commit:${commit.commitId}`).catch(() => undefined);
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
      "workspace", workspaceId, image.imageId,
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
    const sourceAddress = sourceCached && repository.address
      ? await repository.address("workspace", workspaceId, image.imageId, "original").catch(() => null)
      : null;
    return {
      ...normalized,
      sourceCached,
      previewCached,
      sourceAddress: sourceAddress || undefined,
      source: undefined,
      preview: undefined,
    };
  }));
}

export async function readWorkspaceImageSource(image: WorkspaceImage) {
  if (image.source) return image.source;
  try {
    const source = await getImageStorageRepository().read(
      "workspace", image.workspaceId, image.imageId, "original", image.mimeType,
    );
    if (source) return source;
  } catch {
    // IndexedDB is the compatibility fallback when file-backed storage is unavailable.
  }
  return (await getWorkspaceDatabase().images.get(image.imageId))?.source ?? null;
}

export async function getWorkspaceImageProcessingSource(
  image: WorkspaceImage,
): Promise<ImageProcessingSource | null> {
  if (image.source) {
    return {
      kind: "blob",
      blob: image.source,
      name: image.name,
      mimeType: image.source.type || image.mimeType,
    };
  }

  const repository = getImageStorageRepository();
  if (image.sourceCached && repository.address) {
    const record = await repository.get("workspace", image.workspaceId, image.imageId).catch(() => null);
    if (record && record.byteSize > 0) {
      return {
        kind: "stored",
        asset: {
          scope: "workspace",
          scopeKey: image.workspaceId,
          id: image.imageId,
          variant: "original",
          mimeType: record.mimeType || image.mimeType,
          revision: record.revision,
        },
        name: image.name,
      };
    }
  }

  const source = await readWorkspaceImageSource(image);
  return source
    ? { kind: "blob", blob: source, name: image.name, mimeType: source.type || image.mimeType }
    : null;
}

export async function getWorkspaceImageSourceAddress(image: WorkspaceImage) {
  if (image.sourceAddress) return image.sourceAddress;
  const repository = getImageStorageRepository();
  return image.sourceCached && repository.address
    ? repository.address("workspace", image.workspaceId, image.imageId, "original")
    : null;
}

export async function saveExternalWorkspaceImage(image: WorkspaceImage, path: string) {
  const { source, preview, sourceAddress: _sourceAddress, ...metadata } = image;
  const repository = getImageStorageRepository();
  if (!repository.linkExternal) throw new Error("External image links are unavailable");
  await repository.linkExternal({
    scope: "workspace",
    scopeKey: image.workspaceId,
    id: image.imageId,
    metadata: metadata as unknown as Record<string, unknown>,
    mimeType: image.mimeType,
    path,
    createdAt: image.createdAt,
  });
  await getWorkspaceDatabase().images.put(metadata);
  return repository.address
    ? repository.address("workspace", image.workspaceId, image.imageId, "original")
    : null;
}

export async function readWorkspaceImagePreview(image: WorkspaceImage) {
  try {
    const preview = await getImageStorageRepository().read(
      "workspace", image.workspaceId, image.imageId, "thumbnail", "image/webp",
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
  const { source, preview, sourceAddress: _sourceAddress, ...rawMetadata } = image;
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
        scope: "workspace",
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
    await getImageStorageRepository().put({ scope: "workspace", scopeKey: image.workspaceId, id: image.imageId,
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
  if (image) await getImageStorageRepository().delete("workspace", image.workspaceId, imageId).catch(() => undefined);
  const commits = await db.commits.where("imageId").equals(imageId).toArray();
  const activities = image
    ? await db.activities.where("workspaceId").equals(image.workspaceId)
      .filter((activity) => activity.scope === "collaborationActivity" && activity.imageId === imageId)
      .toArray()
    : [];
  if (image) await Promise.all(commits.map((commit) =>
    getImageStorageRepository().delete("workspace", image.workspaceId, `commit:${commit.commitId}`).catch(() => undefined)));
  const cacheKeys = image
    ? (await db.cache.where("workspaceId").equals(image.workspaceId)
      .filter((entry) => (entry.kind === "preview" || entry.kind === "source")
        && entry.key.endsWith(`:${imageId}`))
      .toArray())
      .map((entry) => entry.key)
    : [];
  await db.transaction("rw", db.images, db.proposals, db.commits, db.activities, db.cache, async () => {
    await db.images.delete(imageId);
    await db.proposals.where("imageId").equals(imageId).delete();
    await db.commits.where("imageId").equals(imageId).delete();
    await db.activities.bulkDelete(activities.map((activity) => activity.eventId));
    if (cacheKeys.length) await db.cache.bulkDelete(cacheKeys);
    if (image) await db.cache.where("workspaceId").equals(image.workspaceId)
      .filter((entry) => entry.key.includes(`:${imageId}`)
        || commits.some((commit) => entry.key.endsWith(`:${commit.commitId}`))
        || activities.some((activity) => entry.key.endsWith(`:${activity.eventId}`)))
      .delete();
  });
}

export async function clearWorkspaceImageHistory(imageId: string) {
  const db = getWorkspaceDatabase();
  const image = await db.images.get(imageId);
  if (!image) return;
  const [commits, activities] = await Promise.all([
    db.commits.where("imageId").equals(imageId).toArray(),
    db.activities.where("workspaceId").equals(image.workspaceId)
      .filter((activity) => activity.scope === "collaborationActivity" && activity.imageId === imageId)
      .toArray(),
  ]);
  await Promise.all(commits.map((commit) =>
    getImageStorageRepository().delete("workspace", image.workspaceId, `commit:${commit.commitId}`).catch(() => undefined)));
  const cacheKeys = [
    ...commits.map((commit) => `commit:${image.workspaceId}:${commit.commitId}`),
    ...activities.map((activity) => `activity:${image.workspaceId}:${activity.eventId}`),
  ];
  await db.transaction("rw", db.proposals, db.commits, db.activities, db.cache, async () => {
    await db.proposals.where("imageId").equals(imageId).delete();
    await db.commits.where("imageId").equals(imageId).delete();
    await db.activities.bulkDelete(activities.map((activity) => activity.eventId));
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
        scope: "workspace",
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
      getImageStorageRepository().delete("workspace", image.workspaceId, `commit:${item.commitId}`).catch(() => undefined)));
  }
  if(image)await getWorkspaceDatabase().cache.put({key:`commit:${image.workspaceId}:${value.commitId}`,workspaceId:image.workspaceId,kind:"commit",accessedAt:Date.now(),expiresAt:Date.now()+30*DAY});
}
export async function listCommits(imageId: string) { const values=await getWorkspaceDatabase().commits.where("imageId").equals(imageId).sortBy("createdAt");const cutoff=Date.now()-30*DAY;return values.map((value)=>value.createdAt<cutoff?{...value,snapshotCached:false,snapshot:undefined}:{...value,snapshot:undefined}); }
export async function deleteCommitsAfter(imageId: string, createdAt: number) {
  const db = getWorkspaceDatabase();
  const image = await db.images.get(imageId);
  const removed = await db.commits.where("imageId").equals(imageId)
    .filter((commit) => commit.createdAt > createdAt)
    .toArray();
  if (!removed.length) return [];
  await db.transaction("rw", db.commits, db.cache, async () => {
    await db.commits.bulkDelete(removed.map((commit) => commit.commitId));
    await db.cache.bulkDelete(removed.map((commit) => `commit:${image?.workspaceId || ""}:${commit.commitId}`));
  });
  if (image) await Promise.all(removed.map((commit) =>
    getImageStorageRepository().delete("workspace", image.workspaceId, `commit:${commit.commitId}`).catch(() => undefined)));
  return removed.map((commit) => commit.commitId);
}
export async function deleteCollaborationActivitiesAfter(
  workspaceId: string,
  imageId: string,
  createdAt: number,
) {
  const db = getWorkspaceDatabase();
  const removed = await db.activities.where("workspaceId").equals(workspaceId)
    .filter((activity) => activity.scope === "collaborationActivity"
      && activity.imageId === imageId
      && activity.createdAt > createdAt)
    .toArray();
  if (!removed.length) return [];
  await db.transaction("rw", db.activities, db.cache, async () => {
    await db.activities.bulkDelete(removed.map((activity) => activity.eventId));
    await db.cache.bulkDelete(removed.map((activity) => `activity:${workspaceId}:${activity.eventId}`));
  });
  return removed.map((activity) => activity.eventId);
}
export async function deleteCollaborationActivitiesByIds(workspaceId: string, eventIds: string[]) {
  if (!eventIds.length) return [];
  const db = getWorkspaceDatabase();
  const existing = await db.activities.where("workspaceId").equals(workspaceId)
    .filter((activity) => activity.scope === "collaborationActivity" && eventIds.includes(activity.eventId)).toArray();
  if (!existing.length) return [];
  await db.transaction("rw", db.activities, db.cache, async () => {
    await db.activities.bulkDelete(existing.map((activity) => activity.eventId));
    await db.cache.bulkDelete(existing.map((activity) => `activity:${workspaceId}:${activity.eventId}`));
  });
  return existing.map((activity) => activity.eventId);
}
export async function readWorkspaceCommitSnapshot(commit: WorkspaceCommit) {
  if (!commit.snapshotCached) return null;
  const image = await getWorkspaceDatabase().images.get(commit.imageId);
  if (!image) return null;
  try {
    const snapshot = await getImageStorageRepository().read(
      "workspace", image.workspaceId, `commit:${commit.commitId}`, "original",
      commit.snapshotMimeType || image.mimeType,
    );
    if (snapshot) return snapshot;
  } catch {
    // Older databases may still contain the pre-file-cache Blob record.
  }
  const legacySnapshot = (await getWorkspaceDatabase().commits.get(commit.commitId))?.snapshot;
  if (legacySnapshot) return legacySnapshot;
  return commit.commitId.startsWith("initial_") && (image.sourceCached || image.source)
    ? readWorkspaceImageSource(image)
    : null;
}
type NewWorkspaceActivity = Omit<WorkspaceActivity, "scope"> & { scope?: WorkspaceActivity["scope"] };

async function saveScopedActivity(
  workspaceId: string,
  value: NewWorkspaceActivity,
  scope: WorkspaceActivity["scope"],
  limit: number,
) {
  const table = getWorkspaceDatabase().activities;
  await table.put({ ...value, scope, workspaceId });
  const values = await table.where("workspaceId").equals(workspaceId)
    .filter((item) => item.scope === scope)
    .sortBy("createdAt");
  if (values.length > limit) await table.bulkDelete(values.slice(0, values.length - limit).map((item) => item.eventId));
  await getWorkspaceDatabase().cache.put({key:`activity:${workspaceId}:${value.eventId}`,workspaceId,kind:"activity",accessedAt:Date.now(),expiresAt:value.createdAt+30*DAY});
}

// Compatibility API: ordinary Workspace events belong to the complete operation log.
export async function saveActivity(workspaceId: string, value: NewWorkspaceActivity) {
  await saveScopedActivity(workspaceId, value, "workspaceLog", 500);
}

export async function saveCollaborationActivity(workspaceId: string, value: NewWorkspaceActivity) {
  await saveScopedActivity(workspaceId, value, "collaborationActivity", 100);
}

export async function listActivities(workspaceId: string, now = Date.now()) {
  const cutoff = now - 30 * 86_400_000;
  const table = getWorkspaceDatabase().activities;
  const values = await table.where("workspaceId").equals(workspaceId)
    .filter((item) => item.scope === "collaborationActivity" && item.createdAt >= cutoff)
    .sortBy("createdAt");
  return values.slice(-100);
}

export async function listOperationLogs(workspaceId: string, now = Date.now()) {
  const cutoff = now - 30 * 86_400_000;
  const values = await getWorkspaceDatabase().activities.where("workspaceId").equals(workspaceId)
    .filter((item) => item.scope !== "collaborationActivity" && item.createdAt >= cutoff)
    .sortBy("createdAt");
  return values.slice(-500);
}

export async function clearOperationLogs(workspaceId: string) {
  const table = getWorkspaceDatabase().activities;
  const logs = await table.where("workspaceId").equals(workspaceId).toArray();
  if (!logs.length) return;
  const db = getWorkspaceDatabase();
  await db.transaction("rw", db.activities, db.cache, async () => {
    await table.bulkDelete(logs.map((item) => item.eventId));
    await db.cache.bulkDelete(logs.map((item) => `activity:${workspaceId}:${item.eventId}`));
  });
}
export async function purgeExpiredCache(now = Date.now()) {
  const db=getWorkspaceDatabase(),table = db.cache;
  const expired = await table.filter((item) => item.expiresAt !== null && item.expiresAt <= now).toArray();
  const repository = getImageStorageRepository();
  for(const entry of expired){const recordId=entry.key.split(":").at(-1)||"";if(entry.kind==="preview"||entry.kind==="source"){const image=await db.images.get(recordId);if(image){await db.images.put({...image,[entry.kind]:undefined,[entry.kind==="preview"?"previewCached":"sourceCached"]:false});await repository.deleteVariant("workspace",image.workspaceId,image.imageId,entry.kind==="preview"?"thumbnail":"original").catch(()=>undefined);}}else if(entry.kind==="commit"){const commit=await db.commits.get(recordId);if(commit){await db.commits.put({...commit,snapshotCached:false,snapshot:undefined});await repository.delete("workspace",entry.workspaceId,`commit:${recordId}`).catch(()=>undefined);}}else if(entry.kind==="activity")await db.activities.delete(recordId);}
  await table.bulkDelete(expired.map((item) => item.key));
  await repository.pruneCache({maxBytes:512*1024*1024,maxAgeMillis:90*DAY}).catch(()=>undefined);
  return expired.length;
}
