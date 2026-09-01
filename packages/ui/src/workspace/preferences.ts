export type WorkspaceLeaveAction = "suspend" | "exit";

const WORKSPACE_LEAVE_ACTION_KEY = "picbind.workspace.leave-action.v1";

export function readWorkspaceLeaveAction(): WorkspaceLeaveAction | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(WORKSPACE_LEAVE_ACTION_KEY);
    return value === "suspend" || value === "exit" ? value : null;
  } catch (_error) {
    return null;
  }
}

export function writeWorkspaceLeaveAction(action: WorkspaceLeaveAction | null): void {
  if (typeof window === "undefined") return;
  try {
    if (action) window.localStorage.setItem(WORKSPACE_LEAVE_ACTION_KEY, action);
    else window.localStorage.removeItem(WORKSPACE_LEAVE_ACTION_KEY);
  } catch (_error) {
    // Some embedded WebViews can disable storage; the setting remains session-only then.
  }
}
