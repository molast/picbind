import assert from "node:assert/strict";
import { test } from "node:test";
import {
  updateCollaboratorPacketLoss,
  updateCollaboratorTransport,
} from "./collaborator-network";
import type { Collaborator } from "./types";

test("Collaborator network updates only the matching peer and clears RTC loss on fallback", () => {
  const collaborators: Collaborator[] = [
    { clientId: "owner-1", displayName: "Owner", online: true, transport: "socket" },
    { clientId: "guest-2", displayName: "Guest", online: true, transport: "socket" },
  ];
  const promoted = updateCollaboratorTransport(collaborators, "owner-1", "rtc");
  const measured = updateCollaboratorPacketLoss(promoted, "owner-1", 7.25);

  assert.deepEqual(measured.map(({ clientId, transport, packetLossRate }) => ({
    clientId,
    transport,
    packetLossRate,
  })), [
    { clientId: "owner-1", transport: "rtc", packetLossRate: 7.25 },
    { clientId: "guest-2", transport: "socket", packetLossRate: undefined },
  ]);
  assert.equal(updateCollaboratorTransport(measured, "owner-1", "socket")[0].packetLossRate, undefined);
});
