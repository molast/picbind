export const AUTH_HANDOFF_TTL_SECONDS = 60;
export const WORKSPACE_TICKET_TTL_SECONDS = 45;

export const WORKSPACE_V1_PATH_SUFFIX = "/realtime";
export const WORKSPACE_V2_PATH_SUFFIX = "/realtime-v2";
export const WORKSPACE_REALTIME_PROTOCOL = "picbind.workspace.v2";
export const WORKSPACE_TICKET_PROTOCOL_PREFIX = "picbind.ticket.";
export const WORKSPACE_TICKET_BYTES = 32;
export const RTC_PROMOTED_CLOSE_CODE = 1000;
export const RTC_PROMOTED_CLOSE_REASON = "rtc-promoted";

export const RTC_HEALTH = Object.freeze({
  requiredPingPongs: 3,
  maximumRttMs: 500,
  maximumBufferedAmountBytes: 256 * 1024,
  minimumStableMs: 2_000,
  disconnectedFallbackMs: 3_000,
  pingTimeoutsBeforeFallback: 3,
  degradedMaximumRttMs: 1_500,
  degradedMaximumBufferedAmountBytes: 1024 * 1024,
  degradedMetricWindowMs: 5_000,
  sendFailuresBeforeFallback: 3,
});

export const REALTIME_V2_PATHS = Object.freeze({
  authExchange: "/api/auth/exchange",
  workspaceJoin: (shareId: string) => `/api/workspace-links/${encodeURIComponent(shareId)}/join`,
  workspaceTicket: (workspaceId: string) =>
    `/api/workspaces/${encodeURIComponent(workspaceId)}/realtime-ticket`,
  workspaceSocket: (workspaceId: string) =>
    `/api/workspaces/${encodeURIComponent(workspaceId)}${WORKSPACE_V2_PATH_SUFFIX}`,
});

export const AUTH_EXCHANGE_ERROR_CODES = [
  "auth_code_invalid",
  "auth_code_expired",
  "auth_code_used",
  "auth_origin_mismatch",
  "rate_limited",
] as const;

export const REALTIME_TICKET_ERROR_CODES = [
  "realtime_origin_mismatch",
  "workspace_not_found",
  "rate_limited",
] as const;

export type WorkspaceRole = "owner" | "collaborator";

export type WorkspaceTicketMetadata = {
  ticketHash: string;
  nonce: string;
  userId: string;
  shareId?: string;
  workspaceId: string;
  role: WorkspaceRole;
  displayName: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export type AuthHandoffRecord = {
  codeHash: string;
  userId: string;
  returnOrigin: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export type WorkspaceTicketResponse = {
  ticket: string;
  expiresAt: string;
  protocol: typeof WORKSPACE_REALTIME_PROTOCOL;
  iceServers: RTCIceServer[];
};

export type TransportState =
  | "Idle"
  | "SocketConnecting"
  | "SocketReady"
  | "RtcNegotiating"
  | "Hybrid"
  | "RtcQualified"
  | "RtcPrimary"
  | "FallingBack"
  | "Unavailable";

export type TransportReadyMessage = {
  type: "transportReady";
  transportEpoch: number;
  transport: "webRtcDataChannel";
};

export type TransportFallbackMessage = {
  type: "transportFallback";
  transportEpoch: number;
  reason: "peer-failed" | "channel-closed" | "health-check-failed" | "owner-requested";
};

export type RtcQualificationSnapshot = {
  peerConnectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  controlChannelState: RTCDataChannelState;
  bulkChannelState: RTCDataChannelState;
  successfulPingPongs: number;
  lostPingPongs: number;
  latestRttMs: number;
  maximumBufferedAmountBytes: number;
  stableForMs: number;
  localReadyEpoch: number | null;
  remoteReadyEpoch: number | null;
  reliableQueueSettled: boolean;
};

export type RtcFallbackSnapshot = {
  peerConnectionState: RTCPeerConnectionState;
  controlChannelState: RTCDataChannelState;
  bulkChannelState: RTCDataChannelState;
  disconnectedForMs: number;
  consecutivePingTimeouts: number;
  latestRttMs: number;
  excessiveRttForMs: number;
  maximumBufferedAmountBytes: number;
  excessiveBufferForMs: number;
  consecutiveSendFailures: number;
  remoteFallbackRequested: boolean;
};

export type ParsedWorkspaceSubprotocol = {
  protocol: typeof WORKSPACE_REALTIME_PROTOCOL;
  ticket: string;
};

export type SubprotocolParseResult =
  | { ok: true; value: ParsedWorkspaceSubprotocol }
  | {
    ok: false;
    error: "protocol_header_invalid" | "protocol_missing" | "ticket_missing" | "ticket_invalid";
  };

export type TicketConsumptionContext = {
  now: number;
  requestOrigin: string | null;
  workspaceId: string;
};

export type TicketConsumptionResult =
  | { ok: true; role: WorkspaceRole }
  | {
    ok: false;
    error:
      | "ticket_expired"
      | "ticket_used"
      | "ticket_origin_mismatch"
      | "ticket_workspace_mismatch";
  };

const TRANSPORT_TRANSITIONS: Readonly<Record<TransportState, readonly TransportState[]>> = {
  Idle: ["SocketConnecting", "Unavailable"],
  SocketConnecting: ["SocketReady", "Unavailable", "Idle"],
  SocketReady: ["RtcNegotiating", "Unavailable", "Idle"],
  RtcNegotiating: ["Hybrid", "SocketReady", "Unavailable", "Idle"],
  Hybrid: ["RtcQualified", "SocketReady", "FallingBack", "Unavailable", "Idle"],
  RtcQualified: ["RtcPrimary", "Hybrid", "FallingBack", "Unavailable", "Idle"],
  RtcPrimary: ["FallingBack", "Unavailable", "Idle"],
  FallingBack: ["SocketConnecting", "SocketReady", "Unavailable", "Idle"],
  Unavailable: ["SocketConnecting", "Idle"],
};

export function isOriginBound(requestOrigin: string | null, credentialOrigin: string): boolean {
  if (!requestOrigin) return false;
  try {
    const request = new URL(requestOrigin);
    const credential = new URL(credentialOrigin);
    if (!["http:", "https:"].includes(request.protocol)) return false;
    if (!["http:", "https:"].includes(credential.protocol)) return false;
    return request.origin === credential.origin;
  } catch {
    return false;
  }
}

export function isValidWorkspaceTicket(ticket: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(ticket);
}

export function validateTicketConsumption(
  ticket: WorkspaceTicketMetadata,
  context: TicketConsumptionContext,
): TicketConsumptionResult {
  if (ticket.consumedAt !== null) return { ok: false, error: "ticket_used" };
  if (context.now >= ticket.expiresAt) return { ok: false, error: "ticket_expired" };
  if (!isOriginBound(context.requestOrigin, ticket.origin)) {
    return { ok: false, error: "ticket_origin_mismatch" };
  }
  if (context.workspaceId !== ticket.workspaceId) {
    return { ok: false, error: "ticket_workspace_mismatch" };
  }
  return { ok: true, role: ticket.role };
}

export function parseWorkspaceSubprotocol(header: string | null): SubprotocolParseResult {
  if (!header || header.length > 512) return { ok: false, error: "protocol_header_invalid" };
  const values = header.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    return { ok: false, error: "protocol_header_invalid" };
  }
  if (!values.includes(WORKSPACE_REALTIME_PROTOCOL)) return { ok: false, error: "protocol_missing" };
  const ticketProtocols = values.filter((value) => value.startsWith(WORKSPACE_TICKET_PROTOCOL_PREFIX));
  if (ticketProtocols.length !== 1) return { ok: false, error: "ticket_missing" };
  if (values.length !== 2) return { ok: false, error: "protocol_header_invalid" };
  const ticket = ticketProtocols[0].slice(WORKSPACE_TICKET_PROTOCOL_PREFIX.length);
  if (!isValidWorkspaceTicket(ticket)) return { ok: false, error: "ticket_invalid" };
  return { ok: true, value: { protocol: WORKSPACE_REALTIME_PROTOCOL, ticket } };
}

export function canTransitionTransport(from: TransportState, to: TransportState): boolean {
  return TRANSPORT_TRANSITIONS[from].includes(to);
}

export function isRtcQualified(snapshot: RtcQualificationSnapshot): boolean {
  return snapshot.peerConnectionState === "connected"
    && snapshot.iceConnectionState !== "failed"
    && snapshot.iceConnectionState !== "disconnected"
    && snapshot.iceConnectionState !== "closed"
    && snapshot.controlChannelState === "open"
    && snapshot.bulkChannelState === "open"
    && snapshot.successfulPingPongs >= RTC_HEALTH.requiredPingPongs
    && snapshot.lostPingPongs === 0
    && snapshot.latestRttMs <= RTC_HEALTH.maximumRttMs
    && snapshot.maximumBufferedAmountBytes <= RTC_HEALTH.maximumBufferedAmountBytes
    && snapshot.stableForMs >= RTC_HEALTH.minimumStableMs
    && snapshot.localReadyEpoch !== null
    && snapshot.localReadyEpoch === snapshot.remoteReadyEpoch
    && snapshot.reliableQueueSettled;
}

export function shouldFallbackRtc(snapshot: RtcFallbackSnapshot): boolean {
  return snapshot.remoteFallbackRequested
    || snapshot.peerConnectionState === "failed"
    || snapshot.peerConnectionState === "closed"
    || snapshot.controlChannelState !== "open"
    || snapshot.bulkChannelState !== "open"
    || snapshot.disconnectedForMs >= RTC_HEALTH.disconnectedFallbackMs
    || snapshot.consecutivePingTimeouts >= RTC_HEALTH.pingTimeoutsBeforeFallback
    || (
      snapshot.latestRttMs > RTC_HEALTH.degradedMaximumRttMs
      && snapshot.excessiveRttForMs >= RTC_HEALTH.degradedMetricWindowMs
    )
    || (
      snapshot.maximumBufferedAmountBytes > RTC_HEALTH.degradedMaximumBufferedAmountBytes
      && snapshot.excessiveBufferForMs >= RTC_HEALTH.degradedMetricWindowMs
    )
    || snapshot.consecutiveSendFailures >= RTC_HEALTH.sendFailuresBeforeFallback;
}
