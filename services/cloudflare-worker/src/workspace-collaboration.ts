import {
  createWorkspaceShareId,
  failure,
  randomToken,
  sha256,
  success,
  uuidV7,
  type AuthEnv,
} from "./auth";
import { generateTurnIceServers } from "./realtime/share-room";
import {
  WORKSPACE_REALTIME_PROTOCOL,
  WORKSPACE_TICKET_BYTES,
  WORKSPACE_TICKET_TTL_SECONDS,
  parseWorkspaceHandshake,
  type WorkspaceRole,
  type WorkspaceTicketMetadata,
} from "./realtime/workspace-v2-protocol";

type WorkspaceRow = {
  id: string;
  share_id: string;
  owner_capability_hash?: string;
  name: string;
  created_at: string;
  updated_at: string;
};

const OWNER_CAPABILITY_HEADER = "x-picbind-owner-capability";

async function requireOwnerCapability(request: Request, row: WorkspaceRow) {
  const capability = request.headers.get(OWNER_CAPABILITY_HEADER) || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability)) return false;
  return Boolean(row.owner_capability_hash)
    && await sha256(capability) === row.owner_capability_hash;
}

function publicWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    shareId: row.share_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function workspaceRequestBody(request: Request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return null;
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 16_384) return null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384) return null;
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function handleWorkspaces(request: Request, env: AuthEnv) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const body = await workspaceRequestBody(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return failure("invalid_input", "Invalid workspace name", 400);
  const id = uuidV7();
  const shareId = createWorkspaceShareId();
  const ownerCapability = randomToken(32);
  const now = new Date().toISOString();
  await env.USER_DB.prepare(
    "INSERT INTO workspaces (id, share_id, owner_capability_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, shareId, await sha256(ownerCapability), name, now, now).run();
  return success({
    workspace: publicWorkspace({
      id,
      share_id: shareId,
      name,
      created_at: now,
      updated_at: now,
    }),
    ownerCapability,
  }, { status: 201 });
}

export async function handleWorkspaceJoin(
  request: Request,
  env: AuthEnv,
  shareId: string,
) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const workspace = await env.USER_DB.prepare(
    "SELECT id, share_id, name, created_at, updated_at FROM workspaces WHERE share_id = ?",
  ).bind(shareId).first<WorkspaceRow>();
  if (!workspace) return failure("workspace_not_found", "Workspace not found", 404);
  return success({ workspace: publicWorkspace(workspace) });
}

export async function handleWorkspaceShareLink(
  request: Request,
  env: AuthEnv,
  workspaceId: string,
) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const workspace = await env.USER_DB.prepare(
    "SELECT id, share_id, owner_capability_hash, name, created_at, updated_at FROM workspaces WHERE id = ?",
  ).bind(workspaceId).first<WorkspaceRow>();
  if (!workspace) return failure("workspace_not_found", "Workspace not found", 404);
  if (!await requireOwnerCapability(request, workspace)) {
    return failure("owner_capability_invalid", "Owner capability is invalid", 403);
  }
  const shareId = createWorkspaceShareId();
  const updatedAt = new Date().toISOString();
  await env.USER_DB.prepare("UPDATE workspaces SET share_id = ?, updated_at = ? WHERE id = ?")
    .bind(shareId, updatedAt, workspaceId)
    .run();
  return success({
    workspace: publicWorkspace({ ...workspace, share_id: shareId, updated_at: updatedAt }),
  });
}

export async function handleWorkspaceDetail(
  request: Request,
  env: AuthEnv,
  workspaceId: string,
) {
  if (request.method !== "GET") return failure("method_not_allowed", "Method not allowed", 405);
  const workspace = await env.USER_DB.prepare(
    "SELECT id, share_id, owner_capability_hash, name, created_at, updated_at FROM workspaces WHERE id = ?",
  ).bind(workspaceId).first<WorkspaceRow>();
  if (!workspace) return failure("workspace_not_found", "Workspace not found", 404);
  if (!await requireOwnerCapability(request, workspace)) {
    return failure("owner_capability_invalid", "Owner capability is invalid", 403);
  }
  return success({ workspace: publicWorkspace(workspace) });
}

export type WorkspaceRealtimeEnv = AuthEnv & {
  WORKSPACE_REALTIME: DurableObjectNamespace;
  LOCAL_RUNTIME?: string;
  TURN_TOKEN_ID?: string;
  TURN_API_TOKEN?: string;
};

function workspaceRealtimeObject(env: WorkspaceRealtimeEnv, workspaceId: string) {
  return env.WORKSPACE_REALTIME.get(env.WORKSPACE_REALTIME.idFromName(workspaceId));
}

async function registerWorkspaceTicket(
  env: WorkspaceRealtimeEnv,
  workspaceId: string,
  metadata: WorkspaceTicketMetadata,
) {
  const registered = await workspaceRealtimeObject(env, workspaceId).fetch(
    new Request("https://workspace-realtime/tickets/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(metadata),
    }),
  );
  if (!registered.ok) {
    return registered.status === 429
      ? failure("rate_limited", "Too many active realtime tickets", 429)
      : failure("realtime_ticket_unavailable", "Realtime Ticket is temporarily unavailable", 503);
  }
  return null;
}

function validGuestClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
}

export async function handleWorkspaceLinkRealtimeTicket(
  request: Request,
  env: WorkspaceRealtimeEnv,
  shareId: string,
) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const body = await request.json<Record<string, unknown>>().catch(() => null);
  const clientId = body?.clientId;
  if (!validGuestClientId(clientId)) {
    return failure("invalid_input", "A valid guest client ID is required", 400);
  }
  const workspace = await env.USER_DB.prepare(
    "SELECT id, share_id, name, created_at, updated_at FROM workspaces WHERE share_id = ?",
  ).bind(shareId).first<WorkspaceRow>();
  if (!workspace) return failure("workspace_not_found", "Workspace not found", 404);
  const origin = request.headers.get("origin") || "";
  const issuedAt = Date.now();
  const expiresAt = issuedAt + WORKSPACE_TICKET_TTL_SECONDS * 1000;
  const ticket = randomToken(WORKSPACE_TICKET_BYTES);
  const metadata: WorkspaceTicketMetadata = {
    ticketHash: await sha256(ticket),
    nonce: crypto.randomUUID(),
    userId: `guest-${clientId}`,
    shareId,
    workspaceId: workspace.id,
    role: "collaborator",
    displayName: "Guest",
    origin,
    issuedAt,
    expiresAt,
    consumedAt: null,
  };
  const failureResponse = await registerWorkspaceTicket(env, workspace.id, metadata);
  if (failureResponse) return failureResponse;
  return success({
    ticket,
    workspaceId: workspace.id,
    expiresAt: new Date(expiresAt).toISOString(),
    protocol: WORKSPACE_REALTIME_PROTOCOL,
    iceServers: await generateTurnIceServers(env),
  });
}

export async function handleWorkspaceRealtimeTicket(
  request: Request,
  env: WorkspaceRealtimeEnv,
  workspaceId: string,
) {
  if (request.method !== "POST") return failure("method_not_allowed", "Method not allowed", 405);
  const body = await request.json<Record<string, unknown>>().catch(() => null);
  const clientId = body?.clientId;
  if (!validGuestClientId(clientId)) {
    return failure("invalid_input", "A valid client ID is required", 400);
  }
  const workspace = await env.USER_DB.prepare(
    "SELECT id, share_id, owner_capability_hash, name, created_at, updated_at FROM workspaces WHERE id = ?",
  )
    .bind(workspaceId)
    .first<WorkspaceRow>();
  if (!workspace) return failure("workspace_not_found", "Workspace not found", 404);
  if (!await requireOwnerCapability(request, workspace)) {
    return failure("owner_capability_invalid", "Owner capability is invalid", 403);
  }
  const origin = request.headers.get("origin") || "";
  const issuedAt = Date.now();
  const expiresAt = issuedAt + WORKSPACE_TICKET_TTL_SECONDS * 1000;
  const ticket = randomToken(WORKSPACE_TICKET_BYTES);
  const metadata: WorkspaceTicketMetadata = {
    ticketHash: await sha256(ticket),
    nonce: crypto.randomUUID(),
    userId: `owner-${clientId}`,
    workspaceId,
    role: "owner",
    displayName: "Owner",
    origin,
    issuedAt,
    expiresAt,
    consumedAt: null,
  };
  const failureResponse = await registerWorkspaceTicket(env, workspaceId, metadata);
  if (failureResponse) return failureResponse;
  return success({
    ticket,
    expiresAt: new Date(expiresAt).toISOString(),
    protocol: WORKSPACE_REALTIME_PROTOCOL,
    iceServers: await generateTurnIceServers(env),
  });
}

export type ConsumedWorkspaceTicket = WorkspaceTicketMetadata & {
  currentRole: WorkspaceRole;
  currentDisplayName: string;
};

export async function consumeWorkspaceRealtimeTicket(
  env: WorkspaceRealtimeEnv,
  workspaceId: string,
  ticket: string,
  origin: string,
): Promise<{ ok: true; ticket: ConsumedWorkspaceTicket } | { ok: false; response: Response }> {
  const consumed = await workspaceRealtimeObject(env, workspaceId).fetch(
    new Request("https://workspace-realtime/tickets/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketHash: await sha256(ticket), workspaceId, origin }),
    }),
  );
  if (!consumed.ok) {
    const status = consumed.status === 403 ? 403 : 401;
    return { ok: false, response: failure("realtime_ticket_invalid", "Realtime Ticket is invalid", status) };
  }
  const metadata = await consumed.json<WorkspaceTicketMetadata>();
  if (metadata.shareId) {
    const workspace = await env.USER_DB.prepare(
      "SELECT id FROM workspaces WHERE id = ? AND share_id = ?",
    ).bind(workspaceId, metadata.shareId).first();
    if (!workspace || metadata.role !== "collaborator") {
      return { ok: false, response: failure("workspace_forbidden", "Workspace link is no longer valid", 403) };
    }
    return {
      ok: true,
      ticket: {
        ...metadata,
        currentRole: "collaborator",
        currentDisplayName: metadata.displayName || "Guest",
      },
    };
  }
  const workspace = await env.USER_DB.prepare("SELECT id FROM workspaces WHERE id = ?")
    .bind(workspaceId)
    .first();
  if (!workspace) {
    return { ok: false, response: failure("workspace_not_found", "Workspace not found", 404) };
  }
  return {
    ok: true,
    ticket: {
      ...metadata,
      currentRole: metadata.role,
      currentDisplayName: metadata.displayName,
    },
  };
}

export async function handleWorkspaceIceServers(
  request: Request,
  env: WorkspaceRealtimeEnv,
  workspaceId: string,
) {
  if (request.method !== "GET") return failure("method_not_allowed", "Method not allowed", 405);
  const workspace = await env.USER_DB.prepare(
    "SELECT id, share_id, owner_capability_hash, name, created_at, updated_at FROM workspaces WHERE id = ?",
  )
    .bind(workspaceId)
    .first<WorkspaceRow>();
  if (!workspace) return failure("workspace_not_found", "Workspace not found", 404);
  if (!await requireOwnerCapability(request, workspace)) {
    return failure("owner_capability_invalid", "Owner capability is invalid", 403);
  }
  return success({
    iceServers: await generateTurnIceServers(env),
  });
}

export async function handleWorkspaceRealtime(
  request: Request,
  env: WorkspaceRealtimeEnv,
  workspaceId: string,
) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return failure("upgrade_required", "WebSocket upgrade required", 426);
  }
  return failure("workspace_realtime_v1_removed", "Use Workspace realtime v2", 410);
}

export async function handleWorkspaceRealtimeV2(
  request: Request,
  env: WorkspaceRealtimeEnv,
  workspaceId: string,
) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return failure("upgrade_required", "WebSocket upgrade required", 426);
  }
  const queryTicket = new URL(request.url).searchParams.get("ticket");
  const parsed = parseWorkspaceHandshake(
    request.headers.get("sec-websocket-protocol"),
    queryTicket,
  );
  if (!parsed.ok) {
    return failure(parsed.error, "Workspace realtime protocol is invalid", 400);
  }
  const origin = request.headers.get("origin") || "";
  const consumed = await consumeWorkspaceRealtimeTicket(
    env,
    workspaceId,
    parsed.value.ticket,
    origin,
  );
  if (!consumed.ok) return consumed.response;
  const metadata = consumed.ticket;
  const headers = new Headers({
    upgrade: "websocket",
    "sec-websocket-protocol": WORKSPACE_REALTIME_PROTOCOL,
    "x-picbind-user-id": metadata.userId,
    "x-picbind-workspace-id": workspaceId,
    "x-picbind-user-name": encodeURIComponent(metadata.currentDisplayName),
    "x-picbind-workspace-role": metadata.currentRole,
    "x-picbind-workspace-v2": "1",
    "x-picbind-workspace-select-protocol": queryTicket === null ? "1" : "0",
  });
  return workspaceRealtimeObject(env, workspaceId).fetch(new Request(
    "https://workspace-realtime/connect-v2",
    { method: "GET", headers },
  ));
}
