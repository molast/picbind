import type { MessagingProviderSnapshot } from "../../../messaging";
import type { WorkspaceMemberPresence } from "../workspace-editor-types";

export type WorkspaceShareRecipient =
  | { kind: "workspace"; id: string; member: WorkspaceMemberPresence }
  | { kind: "messaging"; id: string; provider: MessagingProviderSnapshot };
