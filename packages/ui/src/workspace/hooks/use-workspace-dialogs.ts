import React from "react";
import type { ProcessedImageResult } from "../../components/share/workspace/image-result-dialog";
import type { ImageParameterDocument } from "../image-protocol";
import type { WorkspaceActivity, WorkspaceCommit, WorkspaceImage, WorkspaceProposal } from "../types";

export function useWorkspaceDialogs() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = React.useState(false);
  const [operationLogOpen, setOperationLogOpen] = React.useState(false);
  const [proposalPreview, setProposalPreview] = React.useState<{ proposalId: string; imageId: string; original: Blob; result: Blob } | null>(null);
  const [sourceRequestDialog, setSourceRequestDialog] = React.useState<Record<string, unknown> | null>(null);
  const [sourceRejectReason, setSourceRejectReason] = React.useState("");
  const [rejectingProposal, setRejectingProposal] = React.useState<WorkspaceProposal | null>(null);
  const [proposalRejectReason, setProposalRejectReason] = React.useState("");
  const [activityPreview, setActivityPreview] = React.useState<{ activity: WorkspaceActivity; parameterDocument: ImageParameterDocument; preview: Blob; commitId?: string } | null>(null);
  const [deletingImage, setDeletingImage] = React.useState<WorkspaceImage | null>(null);
  const [deleteChoice, setDeleteChoice] = React.useState<"library" | "permanent">("library");
  const [rollbackTarget, setRollbackTarget] = React.useState<WorkspaceCommit | null>(null);
  const [rollbackPreview, setRollbackPreview] = React.useState<Blob | null>(null);
  const [saveCollaborationOpen, setSaveCollaborationOpen] = React.useState(false);
  const [collaborationSaveChoice, setCollaborationSaveChoice] = React.useState<"replace" | "copy">("copy");
  const [collaborationSaving, setCollaborationSaving] = React.useState(false);
  const [pendingProcessedResult, setPendingProcessedResult] = React.useState<{ source: WorkspaceImage; result: ProcessedImageResult } | null>(null);
  const [processedResultSaving, setProcessedResultSaving] = React.useState(false);
  return { settingsOpen, setSettingsOpen, leaveConfirmOpen, setLeaveConfirmOpen, operationLogOpen, setOperationLogOpen, proposalPreview, setProposalPreview, sourceRequestDialog, setSourceRequestDialog, sourceRejectReason, setSourceRejectReason, rejectingProposal, setRejectingProposal, proposalRejectReason, setProposalRejectReason, activityPreview, setActivityPreview, deletingImage, setDeletingImage, deleteChoice, setDeleteChoice, rollbackTarget, setRollbackTarget, rollbackPreview, setRollbackPreview, saveCollaborationOpen, setSaveCollaborationOpen, collaborationSaveChoice, setCollaborationSaveChoice, collaborationSaving, setCollaborationSaving, pendingProcessedResult, setPendingProcessedResult, processedResultSaving, setProcessedResultSaving };
}
