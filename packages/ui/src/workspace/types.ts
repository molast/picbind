export type WorkspaceRole = "owner" | "collaborator";
export type WorkspaceRuntimeState =
  | "local" | "connecting" | "connected" | "syncing" | "available"
  | "ownerOffline" | "unavailable";
export type ImageCollaborationState =
  | "private" | "shared" | "working" | "reviewing" | "committed";
export type WorkspaceImageLocation = "library" | "working";
export type ProposalState =
  | "draft" | "submitted" | "pending" | "approved" | "rejected"
  | "later" | "failed" | "conflict";

export type WorkspaceStyle = {
  version: 1;
  revision: number;
  header: {
    background:
      | { type: "solid"; color: string }
      | { type: "gradient"; from: string; to: string; direction: "right" | "down" | "downRight" };
    text: {
      content: string;
      color: string;
      fontFamily: "Inter" | "System" | "Serif" | "Monospace";
      fontSize: number;
      fontWeight: 400 | 500 | 600 | 700;
    };
  };
};

export const defaultWorkspaceStyle = (): WorkspaceStyle => ({
  version: 1,
  revision: 0,
  header: {
    background: { type: "solid", color: "#ffffff" },
    text: { content: "My Workspace", color: "#273247", fontFamily: "Inter", fontSize: 18, fontWeight: 600 },
  },
});

export type WorkspaceIdentity = {
  workspaceId: string;
  name: string;
  role: WorkspaceRole;
  shareToken: string | null;
  ownerCapability: string | null;
  createdAt: number;
  updatedAt: number;
  style: WorkspaceStyle;
};

export type WorkspaceImage = {
  imageId: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  workspaceLocation: WorkspaceImageLocation;
  state: ImageCollaborationState;
  shared: boolean;
  currentCommitId: string | null;
  previewRevision: number;
  parameterDocument?: import("./image-protocol").ImageParameterDocument;
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
  sourceCached?: boolean;
  previewCached?: boolean;
  // Blob values are transient and must only exist while an image is being processed.
  source?: Blob;
  preview?: Blob;
  placeholder?: { width: number; height: number; dominantColor: string; blurHash: string };
};

export type Collaborator = {
  clientId: string;
  displayName: string;
  role?: WorkspaceRole;
  online: boolean;
  currentAction?: string;
  currentImageId?: string;
  transport?: "socket" | "rtc";
  packetLossRate?: number;
};

export type WorkspaceActivity = {
  eventId: string;
  sequence: number;
  actorId: string;
  kind: string;
  imageId?: string;
  detail?: unknown;
  createdAt: number;
  scope: "workspaceLog" | "collaborationActivity";
};

export type WorkspaceOperation = {
  operationId: string;
  imageId: string;
  authorId: string;
  baseCommitId: string;
  type: "crop" | "resize" | "rotate" | "brightness" | "contrast" | "saturation" | "compression" | "other";
  parameters: Record<string, unknown>;
  createdAt: number;
};

export type WorkspaceProposal = {
  proposalId: string;
  workspaceId: string;
  imageId: string;
  authorId: string;
  baseCommitId: string;
  operations: WorkspaceOperation[];
  commit?: WorkspaceCommit;
  state: ProposalState;
  rejectReason?: string;
  createdAt: number;
};

export type WorkspaceCommit = {
  commitId: string;
  imageId: string;
  authorId: string;
  parentCommitId: string | null;
  mergeParentCommitIds: string[];
  operations: WorkspaceOperation[];
  snapshotCached?: boolean;
  snapshot?: Blob;
  snapshotName?: string;
  snapshotMimeType?: string;
  snapshotWidth?: number;
  snapshotHeight?: number;
  createdAt: number;
};

export type WorkspaceEvent = {
  eventId: string;
  sequence: number;
  timestamp: number;
  dataClass: "presence" | "collaborationEvent" | "preview" | "sourceOrCommit";
  type: string;
  reliability?: "ephemeral" | "reliable" | "bulk";
  streamId?: string;
  [key: string]: unknown;
};

export function isValidStyle(style: WorkspaceStyle) {
  const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
  const background = style.header.background;
  return style.version === 1
    && style.header.text.content.trim().length > 0
    && style.header.text.content.length <= 80
    && color(style.header.text.color)
    && style.header.text.fontSize >= 12
    && style.header.text.fontSize <= 32
    && ([400, 500, 600, 700] as number[]).includes(style.header.text.fontWeight)
    && (background.type === "solid" ? color(background.color) : color(background.from) && color(background.to));
}
