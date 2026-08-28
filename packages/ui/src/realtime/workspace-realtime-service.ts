import type {
  RealtimeConnectRequest,
  RealtimeService,
  RealtimeSession,
} from "@picbind/shared";
import {
  WorkspaceRealtimeClient,
  type WorkspaceRealtimeDependencies,
} from "../workspace/realtime";

const CLIENT_ID_KEY = "picbind.workspace.client-id";

export function getRealtimeClientId() {
  let value = localStorage.getItem(CLIENT_ID_KEY);
  if (!value) {
    value = `client_${crypto.randomUUID()}`;
    localStorage.setItem(CLIENT_ID_KEY, value);
  }
  return value;
}

export class WorkspaceRealtimeService implements RealtimeService {
  constructor(private readonly dependencies: WorkspaceRealtimeDependencies) {}

  async connect(request: RealtimeConnectRequest): Promise<RealtimeSession> {
    const session = new WorkspaceRealtimeClient({
      workspaceId: request.workspaceId,
      role: request.role,
      shareToken: request.shareToken ?? null,
      ownerCapability: request.ownerCapability ?? null,
    }, this.dependencies, request.clientId);

    // Start immediately, but return the session before ticket/socket I/O completes so
    // callers can subscribe without missing the initial connected/member events.
    void session.connect();
    return session;
  }
}
