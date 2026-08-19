import type { WorkspaceIdentity } from "./types";

const API_BASE = "https://api.picbind.com";
type Envelope<T> = { data: T } | { error: { code: string; message: string } };

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const envelope = await response.json() as Envelope<T>;
  if (!response.ok || "error" in envelope) throw new Error("error" in envelope ? envelope.error.message : `Request failed (${response.status})`);
  return envelope.data;
}

type RemoteWorkspace = { id: string; shareId: string; name: string; createdAt: string; updatedAt: string };
export async function createWorkspaceShare(name: string) {
  return request<{ workspace: RemoteWorkspace; ownerCapability: string }>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) });
}
export async function rotateWorkspaceShare(workspace: WorkspaceIdentity) {
  if (!workspace.ownerCapability) throw new Error("Owner capability is missing");
  return request<{ workspace: RemoteWorkspace }>(`/api/workspaces/${encodeURIComponent(workspace.workspaceId)}/share-link`, {
    method: "POST", headers: { "x-picbind-owner-capability": workspace.ownerCapability },
  });
}
export async function joinWorkspace(shareToken: string) {
  return request<{ workspace: RemoteWorkspace }>(`/api/workspace-links/${encodeURIComponent(shareToken)}/join`, { method: "POST" });
}

export async function realtimeTicket(workspace: WorkspaceIdentity, clientId: string) {
  const owner = workspace.role === "owner";
  const path = owner
    ? `/api/workspaces/${encodeURIComponent(workspace.workspaceId)}/realtime-ticket`
    : `/api/workspace-links/${encodeURIComponent(workspace.shareToken || "")}/realtime-ticket`;
  return request<{ ticket: string; workspaceId?: string; expiresAt: string; protocol: string; iceServers: RTCIceServer[] }>(path, {
    method: "POST",
    headers: owner && workspace.ownerCapability ? { "x-picbind-owner-capability": workspace.ownerCapability } : {},
    body: JSON.stringify({ clientId }),
  });
}

export function shareUrl(shareToken: string) {
  return `${location.origin}/workspace/${encodeURIComponent(shareToken)}`;
}
