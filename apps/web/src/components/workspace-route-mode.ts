export function resolveGuestShareToken(
  shareToken: string | null,
  ownerShareToken: string | null | undefined,
  mode: string | null,
) {
  if (!shareToken) return undefined;
  if (mode === "collaborator") return shareToken;
  return shareToken === ownerShareToken ? undefined : shareToken;
}

/**
 * Separates the mounted page state for the owner cache and each shared target.
 * The cache itself is addressed by the resolved Workspace ID after joining.
 */
export function workspaceEntryKey(
  shareToken: string | null,
  ownerShareToken: string | null | undefined,
  mode: string | null,
  ownerWorkspaceId: string | null | undefined,
) {
  const guestShareToken = resolveGuestShareToken(shareToken, ownerShareToken, mode);
  return guestShareToken
    ? `collaborator:${guestShareToken}`
    : `owner:${ownerWorkspaceId || "local"}`;
}

export function selectOwnerWorkspace<T extends { shareId: string }>(
  workspaces: T[],
  shareToken: string | null,
) {
  return (shareToken ? workspaces.find((workspace) => workspace.shareId === shareToken) : undefined)
    || workspaces[0];
}
