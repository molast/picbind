import React from "react";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { ImageParameterDocument } from "../image-protocol";
import type { Collaborator, WorkspaceActivity, WorkspaceCommit, WorkspaceImage, WorkspaceProposal } from "../types";

export function useWorkspaceDialogs() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = React.useState(false);
  const [leavingWorkspace, setLeavingWorkspace] = React.useState(false);
  const [removingCollaborator, setRemovingCollaborator] = React.useState<Collaborator | null>(null);
  const [operationLogOpen, setOperationLogOpen] = React.useState(false);
  const [proposalPreview, setProposalPreview] = React.useState<{ proposalId: string; imageId: string; original: Blob; resultUrl: string } | null>(null);
  const [sourceRequestDialog, setSourceRequestDialog] = React.useState<Record<string, unknown> | null>(null);
  const [sourceRejectReason, setSourceRejectReason] = React.useState("");
  const [sourceRejectedNotice, setSourceRejectedNotice] = React.useState<{ reason: string; imageId?: string } | null>(null);
  const [rejectingProposal, setRejectingProposal] = React.useState<WorkspaceProposal | null>(null);
  const [proposalRejectReason, setProposalRejectReason] = React.useState("");
  const [activityPreview, setActivityPreview] = React.useState<{ activity: WorkspaceActivity; parameterDocument: ImageParameterDocument; previewUrl: string; commitId?: string } | null>(null);
  const [previewRendering, setPreviewRendering] = React.useState(false);
  const [deletingImage, setDeletingImage] = React.useState<WorkspaceImage | null>(null);
  const [deleteChoice, setDeleteChoice] = React.useState<"library" | "permanent">("permanent");
  const [rollbackTarget, setRollbackTarget] = React.useState<WorkspaceCommit | null>(null);
  const [rollbackPreview, setRollbackPreview] = React.useState<string | null>(null);
  const [collaborationSaving, setCollaborationSaving] = React.useState(false);
  const [stopCollaborationImage, setStopCollaborationImage] = React.useState<WorkspaceImage | null>(null);
  const [stoppingCollaboration, setStoppingCollaboration] = React.useState(false);
  const [pendingProcessedResult, setPendingProcessedResult] = React.useState<{ source: WorkspaceImage; result: ProcessedImageResult } | null>(null);
  const [processedResultSaving, setProcessedResultSaving] = React.useState(false);
  return { settingsOpen, setSettingsOpen, leaveConfirmOpen, setLeaveConfirmOpen, leavingWorkspace, setLeavingWorkspace, removingCollaborator, setRemovingCollaborator, operationLogOpen, setOperationLogOpen, proposalPreview, setProposalPreview, sourceRequestDialog, setSourceRequestDialog, sourceRejectReason, setSourceRejectReason, sourceRejectedNotice, setSourceRejectedNotice, rejectingProposal, setRejectingProposal, proposalRejectReason, setProposalRejectReason, activityPreview, setActivityPreview, previewRendering, setPreviewRendering, deletingImage, setDeletingImage, deleteChoice, setDeleteChoice, rollbackTarget, setRollbackTarget, rollbackPreview, setRollbackPreview, collaborationSaving, setCollaborationSaving, stopCollaborationImage, setStopCollaborationImage, stoppingCollaboration, setStoppingCollaboration, pendingProcessedResult, setPendingProcessedResult, processedResultSaving, setProcessedResultSaving };
}
