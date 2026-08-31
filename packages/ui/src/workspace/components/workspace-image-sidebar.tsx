import React from "react";
import { FiClock, FiCrop, FiDownload, FiEye, FiHardDrive, FiImage, FiLink, FiRefreshCw, FiRotateCcw, FiSave, FiShield, FiShare2, FiSliders, FiTrash2 } from "react-icons/fi";
import type { Collaborator, WorkspaceActivity, WorkspaceCommit, WorkspaceIdentity, WorkspaceImage, WorkspaceProposal } from "../types";
import { getLang, getWorkspaceLabels } from "../../locales";
import { BlobImageMedia, WorkspaceImageMedia } from "./workspace-image-media";
import { WorkspaceAction } from "./workspace-action";
import { WorkspaceActivityList } from "./workspace-activity-list";
import { workspacePersonName } from "../utils/workspace-person-display";
import { WorkspaceSaveRequiredDialog } from "../dialogs/workspace-save-required-dialog";
import { WorkspaceRestoreConfirmDialog } from "../dialogs/workspace-restore-confirm-dialog";
import type { CollaborationSaveChoice } from "../hooks/use-workspace-save-collaboration";
import { hasPendingWorkspaceImageChanges } from "../image-flow";

const text = (key: string) => getWorkspaceLabels(getLang())[key] || key;

function WorkspaceShareIdDisplay({ value, copied, onCopy }: { value: string; copied: boolean; onCopy(): void }) {
  return <div className="mt-3 min-w-0 rounded-md bg-slate-50 px-3 py-2.5">
    <span className="text-[10px] font-bold uppercase text-slate-500">{text("shareId")}</span>
    <button
      type="button"
      onClick={onCopy}
      className="mt-1 block w-full truncate rounded text-left font-mono text-[13px] font-medium text-slate-700 transition hover:text-[#2f65cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f65cf]/30"
      title={copied ? text("workspaceIdCopied") : text("copyWorkspaceId")}
      aria-label={copied ? text("workspaceIdCopied") : text("copyWorkspaceId")}
    >
      {value}
    </button>
  </div>;
}

function WorkspaceSharePanel({ role, shareId, copied, onCopy, onCreate, onRotate }: {
  role: WorkspaceIdentity["role"];
  shareId: string;
  copied: boolean;
  onCopy(): void;
  onCreate(): void;
  onRotate(): void;
}) {
  const hasShareId = Boolean(shareId);
  return <section className="p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#26344c]">
        <FiShare2 className="shrink-0" />
        <span>{text("workspaceShare")}</span>
      </div>
      {role === "owner" && hasShareId ? <button
        type="button"
        onClick={onRotate}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <FiRefreshCw />
        {text("createNewLink")}
      </button> : null}
    </div>
    <p className="mt-2 max-w-[34rem] text-[11px] leading-[18px] text-slate-500">
      {role === "owner" ? text("createPermanentLink") : text("joinedPermanentLink")}
    </p>
    {hasShareId ? <WorkspaceShareIdDisplay value={shareId} copied={copied} onCopy={onCopy} /> : null}
    {role === "owner" && !hasShareId ? <button
      type="button"
      onClick={onCreate}
      className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white"
    >
      <FiLink />
      {text("createShareLink")}
    </button> : null}
  </section>;
}

export function WorkspaceImageSidebar({ selected, selectedIsLibrary, shareId, role, runtime, imagesCount, workingCount, collaborators, commits, activities, proposals, selectedOriginalCommit, requestingSource, previewBlob, collaborationSaving, onPublish, onDelete, onRequestSource, onOperation, onSave, onRestore, onActivity, onOriginal, onRollback, onCreateShare, onRotateShare, onCopySuccess, hasShareToken }: { selected?: WorkspaceImage | null; selectedIsLibrary: boolean; shareId: string | null; role: WorkspaceIdentity["role"]; runtime: string; imagesCount: number; workingCount: number; collaborators: Collaborator[]; commits: WorkspaceCommit[]; activities: WorkspaceActivity[]; proposals: WorkspaceProposal[]; selectedOriginalCommit?: WorkspaceCommit; requestingSource: boolean; previewBlob?: Blob; collaborationSaving: boolean; onPublish(image: WorkspaceImage): void; onDelete(image: WorkspaceImage): void; onRequestSource(image: WorkspaceImage): void; onOperation(image: WorkspaceImage, operation: "crop" | "adjust" | "review"): void; onRollback(commit: WorkspaceCommit): void; onCreateShare(): void; onRotateShare(): void; onCopySuccess(): void; onSave(choice: CollaborationSaveChoice): Promise<boolean>; onRestore(image: WorkspaceImage): Promise<void>; onActivity(activity: WorkspaceActivity): void; onOriginal(): void; hasShareToken: boolean }) {
  const workspaceId = shareId || "";
  const [workspaceIdCopied, setWorkspaceIdCopied] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  React.useEffect(() => {
    setSaveOpen(false);
    setRestoreConfirmOpen(false);
    setRestoring(false);
  }, [selected?.imageId]);
  const copyWorkspaceId = async () => {
    try {
      if (!workspaceId) return;
      await navigator.clipboard.writeText(workspaceId);
      setWorkspaceIdCopied(true);
      onCopySuccess();
      window.setTimeout(() => setWorkspaceIdCopied(false), 1500);
    } catch {
      setWorkspaceIdCopied(false);
    }
  };
  const uniqueCommits = Array.from(new Map(commits.map((commit) => [commit.commitId, commit])).values());
  const imageCommits = uniqueCommits.filter((commit) => commit.imageId === selected?.imageId);
  const selectedHasPendingChanges = selected ? hasPendingWorkspaceImageChanges(selected) : false;
  const saveSelectedImage = (choice: CollaborationSaveChoice) => {
    void onSave(choice).then((saved) => {
      if (saved) setSaveOpen(false);
    });
  };
  const restoreSelectedImage = async () => {
    if (!selected || restoring) return;
    setRestoring(true);
    try {
      await onRestore(selected);
      setSaveOpen(false);
      setRestoreConfirmOpen(false);
    } finally {
      setRestoring(false);
    }
  };
  collaborators = collaborators.map((person) => ({ ...person, displayName: workspacePersonName(person.displayName) }));
  return <>
    <section className="border-b border-[#e4e7eb] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#26344c]"><FiImage /><span>{text("imageInformation")}</span></div>
      {selected ? <>
        <div className="mt-3 grid grid-cols-[56px_minmax(0,1fr)] items-center gap-3">
          <div className="h-14 w-14 overflow-hidden rounded-md border bg-slate-100">{selected.shared && previewBlob ? <BlobImageMedia blob={previewBlob} alt={selected.name} fit="contain" /> : <WorkspaceImageMedia image={selected} role={role} preferOriginal={role === "owner" && selected.workspaceLocation === "working"} />}</div>
          <div className="min-w-0"><strong className="block truncate text-[13px]">{selected.name}</strong><span className="block text-[11px] text-slate-500">{selected.width} × {selected.height} · {selected.mimeType.replace("image/", "").toUpperCase()}</span><span className="block text-[11px] text-slate-500">{selected.size} B</span></div>
        </div>
        <dl className="mt-3 grid gap-2 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{text("created")}</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{text("source")}</dt><dd>{selected.workspaceLocation === "library" ? text("library") : text("working")}</dd></div>
          {selectedHasPendingChanges ? <div className="flex justify-between gap-3"><dt className="text-slate-500">{text("status")}</dt><dd className="inline-flex items-center gap-1.5 font-semibold text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />{text("unsavedChanges")}</dd></div> : null}
          {selected.shared ? <div className="flex justify-between gap-3"><dt className="text-slate-500">{text("currentCommit")}</dt><dd className="max-w-[160px] truncate">{selected.currentCommitId || text("initial")}</dd></div> : null}
        </dl>
        {!selectedIsLibrary && !selected.shared && role === "owner" ? <div className="mt-3 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <button type="button" onClick={() => selectedHasPendingChanges ? setSaveOpen((value) => !value) : onPublish(selected)} disabled={collaborationSaving} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white disabled:opacity-60">
              {selectedHasPendingChanges ? <FiSave /> : <FiShield />}
              {text(selectedHasPendingChanges ? "saveImage" : "startCollaboration")}
            </button>
            {selectedHasPendingChanges ? <WorkspaceSaveRequiredDialog image={saveOpen ? selected : null} action="save" saving={collaborationSaving} onClose={() => setSaveOpen(false)} onSave={saveSelectedImage} /> : null}
          </div>
          {selectedHasPendingChanges ? <><button type="button" onClick={() => setRestoreConfirmOpen(true)} disabled={restoring || collaborationSaving} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-[#2f65cf] disabled:opacity-60" title={text("restoreOriginal")} aria-label={text("restoreOriginal")}><FiRotateCcw /></button><WorkspaceRestoreConfirmDialog image={restoreConfirmOpen ? selected : null} restoring={restoring} onClose={() => setRestoreConfirmOpen(false)} onConfirm={() => void restoreSelectedImage()} /></> : null}
          <button type="button" onClick={() => onDelete(selected)} className="flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-600" title={text("deleteImage")}><FiTrash2 /></button>
        </div> : null}
        {selected.shared && role === "owner" ? <button type="button" onClick={() => onPublish(selected)} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border text-xs font-bold text-slate-600"><FiShield />{text("stopCollaboration")}</button> : null}
        {selected.shared && !selected.sourceCached && role === "collaborator" ? <button type="button" onClick={() => onRequestSource(selected)} disabled={runtime !== "available" || requestingSource} className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#2f65cf] text-xs font-bold text-white disabled:opacity-60">{requestingSource ? <><FiRefreshCw className="animate-spin" />{text("requestingSource")}</> : <><FiDownload />{text("requestSource")}</>}</button> : null}
      </> : <div className="mt-4 flex flex-col items-center gap-2 py-5 text-center text-xs text-slate-400"><FiImage className="h-6 w-6" /><p>{text("noSelection")}</p></div>}
    </section>
    {selected?.shared ? <><section className="border-b border-[#e4e7eb] p-4"><div className="text-[11px] font-bold uppercase text-[#778294]">{text("imageProcessing")}</div><div className="mt-2 grid grid-cols-2 gap-2"><WorkspaceAction icon={<FiCrop />} label={text("crop")} disabled={!selected.sourceCached} onClick={() => onOperation(selected, "crop")} /><WorkspaceAction icon={<FiSliders />} label={text("color")} disabled={!selected.sourceCached} onClick={() => onOperation(selected, "adjust")} /><WorkspaceAction icon={<FiEye />} label={text("doodle")} disabled={!selected.sourceCached} onClick={() => onOperation(selected, "review")} /><div className="relative min-w-0"><WorkspaceAction icon={<FiDownload />} label={text("saveImage")} disabled={role !== "owner" || !selected.sourceCached || collaborationSaving} onClick={() => setSaveOpen((value) => !value)} /><WorkspaceSaveRequiredDialog image={saveOpen ? selected : null} action="save" saving={collaborationSaving} onClose={() => setSaveOpen(false)} onSave={(choice) => { void onSave(choice).then((saved) => { if (saved) setSaveOpen(false); }); }} /></div></div></section><section className="border-b border-[#e4e7eb] p-4"><div className="text-[11px] font-bold uppercase text-[#778294]">{text("activity")}</div><div className="mt-2"><WorkspaceActivityList activities={activities} proposals={proposals} role={role} originalCommit={selectedOriginalCommit} currentCommitId={selected.currentCommitId} canRollback={role === "owner" && selectedOriginalCommit?.commitId !== selected.currentCommitId} onActivity={onActivity} onOriginal={onOriginal} /></div></section><section className="border-b border-[#e4e7eb] p-4"><div className="text-[11px] font-bold uppercase text-[#778294]">{text("collaborators")}</div>{collaborators.filter((person) => person.online).length ? collaborators.filter((person) => person.online).map((person) => <div key={person.clientId} className="mt-2 flex items-center gap-2 text-xs"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold">{person.displayName.slice(0, 2).toUpperCase()}</span><span className="truncate">{person.displayName}</span></div>) : <p className="mt-2 text-xs text-slate-400">{text("noCollaborators")}</p>}</section>{imageCommits.length ? <section className="p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiClock /><span>{text("history")}</span></div><div className="mt-3 grid gap-2">{imageCommits.slice().reverse().map((commit) => <div key={commit.commitId} className="flex items-center justify-between rounded-md border p-2 text-[11px]"><div className="min-w-0"><strong className="block truncate">{commit.commitId === selected.currentCommitId ? text("currentVersion") : commit.commitId.startsWith("initial_") ? text("initialVersion") : commit.operations.map((operation) => operation.type).join(", ") || text("version")}</strong><span className="text-slate-400">{new Date(commit.createdAt).toLocaleString()}</span></div>{role === "owner" && commit.commitId !== selected.currentCommitId ? <button type="button" onClick={() => onRollback(commit)} className="ml-2 rounded border px-2 py-1">{text("rollback")}</button> : null}</div>)}</div></section> : null}</> : null}
    {!selected?.shared ? <>
      <section className="border-b border-[#e4e7eb] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#26344c]"><FiHardDrive /><span>{text("workspaceOverview")}</span></div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{imagesCount}</strong><span className="text-[10px] text-slate-500">{text("imagesTotal")}</span></div><div className="rounded-md bg-slate-50 p-3"><strong className="block text-xl text-slate-800">{workingCount}</strong><span className="text-[10px] text-slate-500">{text("inWorking")}</span></div></div><div className="mt-3 flex gap-2 rounded-md bg-emerald-50 p-3 text-emerald-800"><FiShield className="mt-0.5 shrink-0" /><p className="text-[11px] leading-4">{text("imagesStayLocal")}</p></div></section>
      <WorkspaceSharePanel
        role={role}
        shareId={hasShareToken ? workspaceId : ""}
        copied={workspaceIdCopied}
        onCopy={() => void copyWorkspaceId()}
        onCreate={onCreateShare}
        onRotate={onRotateShare}
      />
    </> : null}
  </>;
}
