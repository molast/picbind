import type {
  WorkspaceImage,
  WorkspaceOperation,
  WorkspaceProposal,
  WorkspaceRole,
} from "./types";

const OWNER_EVENTS = new Set([
  "stateSnapshot",
  "placeholderUpsert",
  "previewUpsert",
  "previewRemove",
  "sourceStart",
  "sourceChunk",
  "sourceComplete",
  "sourceRejected",
  "proposalDecision",
  "commitCreated",
  "historyRolledBack",
  "styleUpdated",
]);
const COLLABORATOR_EVENTS = new Set(["stateRequest", "sourceRequest", "proposalSubmit"]);

export function isInboundEventAllowed(
  localRole: WorkspaceRole,
  type: string,
  senderRole: unknown,
) {
  if (OWNER_EVENTS.has(type)) return localRole === "collaborator" && senderRole === "owner";
  if (COLLABORATOR_EVENTS.has(type)) return localRole === "owner" && senderRole === "collaborator";
  return true;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateOperation(operation: WorkspaceOperation) {
  if (!operation.operationId
    || !operation.imageId
    || !operation.authorId
    || !operation.baseCommitId
    || !operation.parameters
    || typeof operation.parameters !== "object"
    || Array.isArray(operation.parameters)) return false;
  try {
    if (JSON.stringify(operation.parameters).length > 32_768) return false;
  } catch {
    return false;
  }
  const parameters = operation.parameters;
  if (operation.type === "crop") {
    const { x, y, width, height } = parameters;
    return [x, y, width, height].every(finiteNumber)
      && Number(x) >= 0
      && Number(y) >= 0
      && Number(width) > 0
      && Number(height) > 0
      && Number(x) + Number(width) <= 1
      && Number(y) + Number(height) <= 1;
  }
  if (operation.type === "resize") {
    const { width, height } = parameters;
    return Number.isSafeInteger(width)
      && Number.isSafeInteger(height)
      && Number(width) >= 1
      && Number(height) >= 1
      && Number(width) <= 16_384
      && Number(height) <= 16_384;
  }
  if (operation.type === "rotate") return [90, 180, 270].includes(Number(parameters.degrees));
  if (operation.type === "compression") {
    return parameters.format === undefined
      || ["auto", "jpeg", "png", "webp", "avif"].includes(String(parameters.format));
  }
  return Object.values(parameters).every((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    return true;
  });
}

export function validateProposal(
  proposal: WorkspaceProposal,
  workspaceId: string,
  image: WorkspaceImage | undefined,
) {
  return Boolean(image
    && image.shared
    && proposal.proposalId
    && proposal.workspaceId === workspaceId
    && proposal.imageId === image.imageId
    && proposal.baseCommitId
    && proposal.operations.length > 0
    && proposal.operations.length <= 100
    && proposal.operations.every((operation) => operation.imageId === proposal.imageId
      && operation.baseCommitId === proposal.baseCommitId
      && validateOperation(operation)));
}

export function proposalHasCurrentBase(proposal: WorkspaceProposal, image: WorkspaceImage) {
  return proposal.baseCommitId === image.currentCommitId;
}
