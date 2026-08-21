import type { WorkspaceIdentity, WorkspaceRuntimeState } from "../types";

export type WorkspacePageStatusProps = {
  workspace: WorkspaceIdentity | null;
  runtime: WorkspaceRuntimeState;
  notice: string | null;
  imageCount: number;
  onDismissNotice(): void;
};
