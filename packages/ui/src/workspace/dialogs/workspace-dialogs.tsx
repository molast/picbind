import React from "react";
import CompressionSuggestionDialog from "../../components/share/workspace/compression-suggestion-dialog";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { ShareRoomLabels } from "../../components/share/share-room-labels";
import WorkspaceOperationLogDialog from "../workspace-operation-log-dialog";
import type {
  WorkspaceActivity,
  Collaborator,
  WorkspaceCommit,
  WorkspaceIdentity,
  WorkspaceImage,
  WorkspaceProposal,
  WorkspaceRuntimeState,
  WorkspaceStyle,
} from "../types";
import { WorkspaceActivityPreviewDialog, WorkspaceRollbackDialog } from "./workspace-activity-preview-dialog";
import { WorkspaceDeleteDialog } from "./workspace-delete-dialog";
import { WorkspaceLeaveDialog, WorkspaceRemovedDialog } from "./workspace-leave-dialog";
import { WorkspaceProposalRejectDialog, WorkspaceProposalPreviewDialog } from "./workspace-proposal-dialog";
import { WorkspaceRemoveCollaboratorDialog } from "./workspace-remove-collaborator-dialog";
import { WorkspaceProcessedResultDialog } from "./workspace-result-dialog";
import { WorkspaceSaveDialog } from "./workspace-save-dialog";
import { WorkspaceSettingsDialog } from "./workspace-settings-dialog";
import { WorkspaceSourceRejectedDialog, WorkspaceSourceRequestDialog } from "./workspace-source-request-dialog";

type WorkspaceDialogsProps = {
  workspace: WorkspaceIdentity;
  runtime: WorkspaceRuntimeState;
  leaveOpen: boolean;
  removed: boolean;
  removingCollaborator: Collaborator | null;
  deleteImage: WorkspaceImage | null;
  deleteChoice: "library" | "permanent";
  proposalPreview: { proposalId: string; imageId: string; original: Blob; result: Blob } | null;
  activityPreview: { activity: WorkspaceActivity; parameterDocument: { operations: unknown[] }; preview: Blob } | null;
  activityPreviewIsCurrent: boolean;
  rollbackTarget: WorkspaceCommit | null;
  rollbackPreview?: Blob | null;
  saveCollaborationOpen: boolean;
  collaborationSaving: boolean;
  sourceRequest: Record<string, unknown> | null;
  sourceRequestImageName?: string;
  sourceRejectReason: string;
  sourceRejectedNotice?: { reason: string; imageId?: string } | null;
  rejectingProposal: WorkspaceProposal | null;
  proposalRejectReason: string;
  operationLogOpen: boolean;
  operationLogs: WorkspaceActivity[];
  pendingResult: ProcessedImageResult | null;
  resultSaving: boolean;
  settingsOpen: boolean;
  styleDraft: WorkspaceStyle;
  compressionSuggestionOpen: boolean;
  compressionSuggestionWeakNetwork: boolean;
  compressionLabels: ShareRoomLabels;
  onCompressionContinue(): void;
  onCompression(): void | Promise<void>;
  onCompressionCancel(): void;
  onRemovedReturnHome(): void;
  onCloseLeave(): void;
  onConfirmLeave(): void;
  onCloseRemoveCollaborator(): void;
  onConfirmRemoveCollaborator(): void;
  onCloseDelete(): void;
  onDeleteChoice(choice: "library" | "permanent"): void;
  onConfirmDelete(): void;
  onCloseProposalPreview(): void;
  onRejectProposalPreview(): void;
  onApproveProposalPreview(): void;
  onCloseActivityPreview(): void;
  onRollbackActivity(): void;
  onCloseRollback(): void;
  onConfirmRollback(): void;
  onCloseSaveCollaboration(): void;
  onSaveCollaboration(choice: "replace" | "copy"): void;
  onSourceReasonChange(reason: string): void;
  onRejectSource(): void;
  onAcceptSource(): void;
  onCloseSourceRejected?: () => void;
  onCloseRejectProposal(): void;
  onProposalReasonChange(reason: string): void;
  onRejectProposal(): void;
  onCloseOperationLog(): void;
  onClearOperationLog(): Promise<void>;
  onCancelResult(): void;
  onSaveResult(destination: "library" | "working"): void;
  onCloseSettings(): void;
  onStyleChange: React.Dispatch<React.SetStateAction<WorkspaceStyle>>;
  onSaveStyle(): void;
};

export function WorkspaceDialogs({
  workspace, runtime, leaveOpen, removed, removingCollaborator, deleteImage, deleteChoice, proposalPreview,
  activityPreview, activityPreviewIsCurrent, rollbackTarget, rollbackPreview,
  saveCollaborationOpen, collaborationSaving, sourceRequest, sourceRequestImageName,
  sourceRejectReason, sourceRejectedNotice = null, rejectingProposal, proposalRejectReason,
  operationLogOpen, operationLogs, pendingResult, resultSaving, settingsOpen, styleDraft,
  compressionSuggestionOpen, compressionSuggestionWeakNetwork, compressionLabels,
  onCompressionContinue, onCompression, onCompressionCancel, onRemovedReturnHome,
  onCloseLeave, onConfirmLeave, onCloseRemoveCollaborator, onConfirmRemoveCollaborator,
  onCloseDelete,
  onDeleteChoice, onConfirmDelete, onCloseProposalPreview, onRejectProposalPreview,
  onApproveProposalPreview, onCloseActivityPreview, onRollbackActivity, onCloseRollback,
  onConfirmRollback, onCloseSaveCollaboration, onSaveCollaboration, onSourceReasonChange,
  onRejectSource, onAcceptSource, onCloseSourceRejected = () => undefined,
  onCloseRejectProposal, onProposalReasonChange, onRejectProposal, onCloseOperationLog,
  onClearOperationLog, onCancelResult, onSaveResult, onCloseSettings, onStyleChange, onSaveStyle,
}: WorkspaceDialogsProps) {
  return <>
    <CompressionSuggestionDialog open={compressionSuggestionOpen} weakNetwork={compressionSuggestionWeakNetwork} labels={compressionLabels} onContinue={onCompressionContinue} onCompress={onCompression} onCancel={onCompressionCancel} />
    <WorkspaceProcessedResultDialog result={pendingResult} saving={resultSaving} bytes={(size) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`} onCancel={onCancelResult} onSave={onSaveResult} />
    <WorkspaceLeaveDialog open={leaveOpen} onClose={onCloseLeave} onLeave={onConfirmLeave} />
    <WorkspaceRemovedDialog open={removed} onReturnHome={onRemovedReturnHome} />
    <WorkspaceRemoveCollaboratorDialog collaborator={removingCollaborator} onClose={onCloseRemoveCollaborator} onConfirm={onConfirmRemoveCollaborator} />
    {!activityPreview ? <WorkspaceProposalPreviewDialog proposal={proposalPreview} role={workspace.role} onClose={onCloseProposalPreview} onReject={onRejectProposalPreview} onApprove={onApproveProposalPreview} /> : null}
    <WorkspaceActivityPreviewDialog preview={activityPreview} role={workspace.role} isCurrent={activityPreviewIsCurrent} onClose={onCloseActivityPreview} onRollback={onRollbackActivity} onApprove={() => { onCloseActivityPreview(); onApproveProposalPreview(); }} onReject={() => { onCloseActivityPreview(); onRejectProposalPreview(); }} />
    <WorkspaceRollbackDialog target={rollbackTarget} preview={rollbackPreview || undefined} role={workspace.role} onClose={onCloseRollback} onRollback={onConfirmRollback} />
    <WorkspaceSaveDialog open={saveCollaborationOpen} saving={collaborationSaving} onClose={onCloseSaveCollaboration} onSave={onSaveCollaboration} />
    <WorkspaceDeleteDialog image={deleteImage} choice={deleteChoice} onChoiceChange={onDeleteChoice} onClose={onCloseDelete} onConfirm={onConfirmDelete} />
    <WorkspaceSourceRequestDialog request={sourceRequest} imageName={sourceRequestImageName} reason={sourceRejectReason} onReasonChange={onSourceReasonChange} onReject={onRejectSource} onAccept={onAcceptSource} />
    <WorkspaceSourceRejectedDialog notice={sourceRejectedNotice} imageName={sourceRejectedNotice?.imageId ? sourceRequestImageName : undefined} onClose={onCloseSourceRejected} />
    <WorkspaceProposalRejectDialog proposal={rejectingProposal} reason={proposalRejectReason} onReasonChange={onProposalReasonChange} onClose={onCloseRejectProposal} onReject={onRejectProposal} />
    <WorkspaceOperationLogDialog open={operationLogOpen} logs={operationLogs} onClose={onCloseOperationLog} onClear={onClearOperationLog} />
    <WorkspaceSettingsDialog open={settingsOpen} workspace={workspace} runtime={runtime} styleDraft={styleDraft} onStyleChange={onStyleChange} onClose={onCloseSettings} onSave={onSaveStyle} />
  </>;
}
