import Dexie, { type EntityTable } from "dexie";
import { defaultWorkspaceStyle, type WorkspaceActivity, type WorkspaceCommit, type WorkspaceIdentity, type WorkspaceImage, type WorkspaceProposal } from "./types";
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
    const normalized = { ...image, shared: image.shared ?? image.state !== "private" };
    const sourceAvailable = workspace?.role === "owner"
      || cacheKeys.has(`source:${workspaceId}:${image.imageId}`);
    const previewAvailable = cacheKeys.has(`preview:${workspaceId}:${image.imageId}`);
    try {
      const [source, preview] = await Promise.all([
        sourceAvailable
          ? repository.read("room", workspaceId, image.imageId, "original", image.mimeType)
          : Promise.resolve(null),
        previewAvailable
          ? repository.read("room", workspaceId, image.imageId, "thumbnail", image.preview?.type || "image/webp")
          : Promise.resolve(null),
      ]);
      return {
        ...normalized,
        source: sourceAvailable ? source || normalized.source : undefined,
        preview: previewAvailable ? preview || normalized.preview : undefined,
      };
    } catch {
      return {
        ...normalized,
        source: sourceAvailable ? normalized.source : undefined,
        preview: previewAvailable ? normalized.preview : undefined,
      };
    }
  }));
}
export async function saveWorkspaceImage(image: WorkspaceImage) {
  const { source, preview, ...metadata } = image;
  try {
    await getImageStorageRepository().put({ scope: "room", scopeKey: image.workspaceId, id: image.imageId,
      metadata: metadata as unknown as Record<string, unknown>, mimeType: image.mimeType, data: source,
      thumbnail: preview, thumbnailMimeType: preview?.type, createdAt: image.createdAt });
    await getWorkspaceDatabase().images.put(metadata);
  } catch {
    // IndexedDB Blob fallback is used only where OPFS/native storage is unavailable.
    await getWorkspaceDatabase().images.put(image);
  }
  const now=Date.now(),workspace=await getWorkspaceDatabase().workspaces.get(image.workspaceId),entries:CacheEntry[]=[];
  if(preview)entries.push({key:`preview:${image.workspaceId}:${image.imageId}`,workspaceId:image.workspaceId,kind:"preview",accessedAt:now,expiresAt:now+30*DAY});
  if(source&&workspace?.role==="collaborator")entries.push({key:`source:${image.workspaceId}:${image.imageId}`,workspaceId:image.workspaceId,kind:"source",accessedAt:now,expiresAt:now+90*DAY});
  if(entries.length)await getWorkspaceDatabase().cache.bulkPut(entries);
}
export async function deleteWorkspaceImage(imageId: string) {
  const image = await getWorkspaceDatabase().images.get(imageId);
  if (image) await getImageStorageRepository().delete("room", image.workspaceId, imageId).catch(() => undefined);
  await getWorkspaceDatabase().images.delete(imageId);
}
export async function saveProposal(value: WorkspaceProposal) { await getWorkspaceDatabase().proposals.put(value); }
export async function listProposals(workspaceId: string) { return getWorkspaceDatabase().proposals.where("workspaceId").equals(workspaceId).sortBy("createdAt"); }
export async function saveCommit(value: WorkspaceCommit) {
  const table = getWorkspaceDatabase().commits;
  await table.put(value);
  const commits = await table.where("imageId").equals(value.imageId).sortBy("createdAt");
  if (commits.length > 20) await table.bulkDelete(commits.slice(0, commits.length - 20).map((item) => item.commitId));
  const image=await getWorkspaceDatabase().images.get(value.imageId);
  if(image)await getWorkspaceDatabase().cache.put({key:`commit:${image.workspaceId}:${value.commitId}`,workspaceId:image.workspaceId,kind:"commit",accessedAt:Date.now(),expiresAt:Date.now()+30*DAY});
}
export async function listCommits(imageId: string) { const values=await getWorkspaceDatabase().commits.where("imageId").equals(imageId).sortBy("createdAt");const cutoff=Date.now()-30*DAY;return values.map((value)=>value.createdAt<cutoff?{...value,snapshot:undefined}:value); }
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
  for(const entry of expired){const recordId=entry.key.split(":").at(-1)||"";if(entry.kind==="preview"||entry.kind==="source"){const image=await db.images.get(recordId);if(image){await db.images.put({...image,[entry.kind]:undefined});await repository.deleteVariant("room",image.workspaceId,image.imageId,entry.kind==="preview"?"thumbnail":"original").catch(()=>undefined);}}else if(entry.kind==="commit"){const commit=await db.commits.get(recordId);if(commit?.snapshot)await db.commits.put({...commit,snapshot:undefined});}else if(entry.kind==="activity")await db.activities.delete(recordId);}
  await table.bulkDelete(expired.map((item) => item.key));
  await repository.pruneCache({maxBytes:512*1024*1024,maxAgeMillis:90*DAY}).catch(()=>undefined);
  return expired.length;
}
