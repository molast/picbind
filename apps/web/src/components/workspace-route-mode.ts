export function resolveGuestShareToken(
  shareToken: string | null,
  ownerShareToken: string | null | undefined,
  mode: string | null,
) {
  if (!shareToken) return undefined;
  if (mode === "collaborator") return shareToken;
  return shareToken === ownerShareToken ? undefined : shareToken;
}
