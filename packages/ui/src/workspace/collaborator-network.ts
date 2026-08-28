import type { Collaborator } from "./types";

export function updateCollaboratorTransport(
  collaborators: Collaborator[],
  userId: string,
  transport: "socket" | "rtc",
) {
  return collaborators.map((collaborator) => collaborator.clientId === userId
    ? {
      ...collaborator,
      transport,
      packetLossRate: transport === "rtc" ? collaborator.packetLossRate : undefined,
    }
    : collaborator);
}

export function updateCollaboratorPacketLoss(
  collaborators: Collaborator[],
  userId: string,
  packetLossRate: number,
) {
  if (!Number.isFinite(packetLossRate)) return collaborators;
  const normalized = Math.min(100, Math.max(0, packetLossRate));
  return collaborators.map((collaborator) => collaborator.clientId === userId
    && collaborator.transport === "rtc"
    ? { ...collaborator, packetLossRate: normalized }
    : collaborator);
}
