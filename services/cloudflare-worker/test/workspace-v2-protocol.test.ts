import { describe, expect, it } from "vitest";
import {
  RTC_HEALTH,
  WORKSPACE_REALTIME_PROTOCOL,
  canTransitionTransport,
  isOriginBound,
  isRtcQualified,
  isValidWorkspaceTicket,
  parseWorkspaceHandshake,
  parseWorkspaceSubprotocol,
  shouldFallbackRtc,
  validateTicketConsumption,
  type RtcFallbackSnapshot,
  type RtcQualificationSnapshot,
  type WorkspaceTicketMetadata,
} from "../src/realtime/workspace-v2-protocol";

const VALID_TICKET = "a".repeat(43);

function qualifiedSnapshot(): RtcQualificationSnapshot {
  return {
    peerConnectionState: "connected",
    iceConnectionState: "connected",
    controlChannelState: "open",
    bulkChannelState: "open",
    successfulPingPongs: RTC_HEALTH.requiredPingPongs,
    lostPingPongs: 0,
    latestRttMs: RTC_HEALTH.maximumRttMs,
    maximumBufferedAmountBytes: RTC_HEALTH.maximumBufferedAmountBytes,
    stableForMs: RTC_HEALTH.minimumStableMs,
    localReadyEpoch: 7,
    remoteReadyEpoch: 7,
    reliableQueueSettled: true,
  };
}

function healthyPrimarySnapshot(): RtcFallbackSnapshot {
  return {
    peerConnectionState: "connected",
    controlChannelState: "open",
    bulkChannelState: "open",
    disconnectedForMs: 0,
    consecutivePingTimeouts: 0,
    latestRttMs: 40,
    excessiveRttForMs: 0,
    maximumBufferedAmountBytes: 0,
    excessiveBufferForMs: 0,
    consecutiveSendFailures: 0,
    remoteFallbackRequested: false,
  };
}

describe("Workspace V2 subprotocol", () => {
  it("accepts a query Ticket without browser subprotocol negotiation", () => {
    expect(parseWorkspaceHandshake(null, VALID_TICKET)).toEqual({
      ok: true,
      value: { protocol: WORKSPACE_REALTIME_PROTOCOL, ticket: VALID_TICKET },
    });
  });

  it("rejects an invalid query Ticket or additional browser subprotocols", () => {
    expect(parseWorkspaceHandshake(WORKSPACE_REALTIME_PROTOCOL, "short").ok).toBe(false);
    expect(parseWorkspaceHandshake(
      `${WORKSPACE_REALTIME_PROTOCOL}, another.protocol`,
      VALID_TICKET,
    ).ok).toBe(false);
  });

  it("extracts one valid ticket without changing the selected public protocol", () => {
    expect(parseWorkspaceSubprotocol(
      `${WORKSPACE_REALTIME_PROTOCOL}, picbind.ticket.${VALID_TICKET}`,
    )).toEqual({
      ok: true,
      value: { protocol: WORKSPACE_REALTIME_PROTOCOL, ticket: VALID_TICKET },
    });
  });

  it.each([
    null,
    "",
    WORKSPACE_REALTIME_PROTOCOL,
    `picbind.ticket.${VALID_TICKET}`,
    `${WORKSPACE_REALTIME_PROTOCOL}, ${WORKSPACE_REALTIME_PROTOCOL}, picbind.ticket.${VALID_TICKET}`,
    `${WORKSPACE_REALTIME_PROTOCOL}, picbind.ticket.${VALID_TICKET}, picbind.ticket.${"b".repeat(43)}`,
    `${WORKSPACE_REALTIME_PROTOCOL}, picbind.ticket.${VALID_TICKET}, unknown.protocol`,
    `${WORKSPACE_REALTIME_PROTOCOL}, picbind.ticket.short`,
    "x".repeat(513),
  ])("rejects incomplete, repeated or oversized header %s", (header) => {
    expect(parseWorkspaceSubprotocol(header).ok).toBe(false);
  });

  it("requires a base64url ticket carrying at least 256 bits", () => {
    expect(isValidWorkspaceTicket(VALID_TICKET)).toBe(true);
    expect(isValidWorkspaceTicket("a".repeat(42))).toBe(false);
    expect(isValidWorkspaceTicket(`${"a".repeat(42)}+`)).toBe(false);
  });
});

describe("credential origin binding", () => {
  it("accepts only the same normalized HTTP origin", () => {
    expect(isOriginBound("http://127.0.0.1:4174", "http://127.0.0.1:4174/")).toBe(true);
    expect(isOriginBound("https://picbind.com", "https://picbind.com/path")).toBe(true);
  });

  it.each([
    [null, "https://picbind.com"],
    ["https://picbind.com", "https://www.picbind.com"],
    ["http://127.0.0.1:4174", "http://localhost:4174"],
    ["http://127.0.0.1:4174", "http://127.0.0.1:3000"],
    ["wss://api.picbind.com", "wss://api.picbind.com"],
  ])("rejects missing or mismatched origins", (requestOrigin, credentialOrigin) => {
    expect(isOriginBound(requestOrigin, credentialOrigin)).toBe(false);
  });
});

describe("ticket consumption boundary", () => {
  const ticket: WorkspaceTicketMetadata = {
    ticketHash: "hash",
    nonce: "nonce",
    userId: "user-1",
    workspaceId: "workspace-1",
    role: "collaborator",
    displayName: "Tester",
    origin: "http://127.0.0.1:4174",
    issuedAt: 1_000,
    expiresAt: 46_000,
    consumedAt: null,
  };
  const context = {
    now: 45_999,
    requestOrigin: "http://127.0.0.1:4174",
    workspaceId: "workspace-1",
  };

  it("accepts a live, unused ticket", () => {
    expect(validateTicketConsumption(ticket, context)).toEqual({
      ok: true,
      role: "collaborator",
    });
  });

  it("rejects expiration at the exact expiry boundary", () => {
    expect(validateTicketConsumption(ticket, { ...context, now: ticket.expiresAt })).toEqual({
      ok: false,
      error: "ticket_expired",
    });
  });

  it("rejects a previously consumed ticket", () => {
    expect(validateTicketConsumption({ ...ticket, consumedAt: 2_000 }, context)).toEqual({
      ok: false,
      error: "ticket_used",
    });
  });

  it("rejects cross-origin and cross-workspace use", () => {
    expect(validateTicketConsumption(ticket, {
      ...context,
      requestOrigin: "http://localhost:4174",
    })).toEqual({ ok: false, error: "ticket_origin_mismatch" });
    expect(validateTicketConsumption(ticket, {
      ...context,
      workspaceId: "workspace-2",
    })).toEqual({ ok: false, error: "ticket_workspace_mismatch" });
  });

});

describe("transport state and RTC qualification", () => {
  it("allows WebSocket bootstrap before RTC promotion", () => {
    expect(canTransitionTransport("Idle", "SocketConnecting")).toBe(true);
    expect(canTransitionTransport("SocketConnecting", "SocketReady")).toBe(true);
    expect(canTransitionTransport("SocketReady", "RtcNegotiating")).toBe(true);
    expect(canTransitionTransport("RtcNegotiating", "Hybrid")).toBe(true);
    expect(canTransitionTransport("Hybrid", "RtcQualified")).toBe(true);
    expect(canTransitionTransport("RtcQualified", "RtcPrimary")).toBe(true);
  });

  it("forbids skipping WebSocket bootstrap or readiness confirmation", () => {
    expect(canTransitionTransport("Idle", "RtcNegotiating")).toBe(false);
    expect(canTransitionTransport("SocketReady", "RtcPrimary")).toBe(false);
    expect(canTransitionTransport("Hybrid", "RtcPrimary")).toBe(false);
  });

  it("returns from RTC Primary through WebSocket-first fallback", () => {
    expect(canTransitionTransport("RtcPrimary", "FallingBack")).toBe(true);
    expect(canTransitionTransport("FallingBack", "SocketConnecting")).toBe(true);
    expect(canTransitionTransport("SocketConnecting", "SocketReady")).toBe(true);
    expect(canTransitionTransport("FallingBack", "RtcNegotiating")).toBe(false);
  });

  it("qualifies only when all health and epoch requirements pass", () => {
    expect(isRtcQualified(qualifiedSnapshot())).toBe(true);
    expect(isRtcQualified({ ...qualifiedSnapshot(), successfulPingPongs: 2 })).toBe(false);
    expect(isRtcQualified({ ...qualifiedSnapshot(), lostPingPongs: 1 })).toBe(false);
    expect(isRtcQualified({ ...qualifiedSnapshot(), latestRttMs: 501 })).toBe(false);
    expect(isRtcQualified({ ...qualifiedSnapshot(), remoteReadyEpoch: 8 })).toBe(false);
    expect(isRtcQualified({ ...qualifiedSnapshot(), reliableQueueSettled: false })).toBe(false);
  });

  it("does not fall back for a short metric spike", () => {
    expect(shouldFallbackRtc({
      ...healthyPrimarySnapshot(),
      latestRttMs: RTC_HEALTH.degradedMaximumRttMs + 1,
      excessiveRttForMs: RTC_HEALTH.degradedMetricWindowMs - 1,
      maximumBufferedAmountBytes: RTC_HEALTH.degradedMaximumBufferedAmountBytes + 1,
      excessiveBufferForMs: RTC_HEALTH.degradedMetricWindowMs - 1,
    })).toBe(false);
  });

  it("falls back after sustained degradation or a terminal signal", () => {
    expect(shouldFallbackRtc({
      ...healthyPrimarySnapshot(),
      excessiveRttForMs: RTC_HEALTH.degradedMetricWindowMs,
      latestRttMs: RTC_HEALTH.degradedMaximumRttMs + 1,
    })).toBe(true);
    expect(shouldFallbackRtc({ ...healthyPrimarySnapshot(), controlChannelState: "closed" })).toBe(true);
    expect(shouldFallbackRtc({ ...healthyPrimarySnapshot(), remoteFallbackRequested: true })).toBe(true);
  });

  it("falls back at the exact disconnect and ping timeout thresholds", () => {
    expect(shouldFallbackRtc({
      ...healthyPrimarySnapshot(),
      disconnectedForMs: RTC_HEALTH.disconnectedFallbackMs - 1,
    })).toBe(false);
    expect(shouldFallbackRtc({
      ...healthyPrimarySnapshot(),
      disconnectedForMs: RTC_HEALTH.disconnectedFallbackMs,
    })).toBe(true);
    expect(shouldFallbackRtc({
      ...healthyPrimarySnapshot(),
      consecutivePingTimeouts: RTC_HEALTH.pingTimeoutsBeforeFallback,
    })).toBe(true);
  });
});
