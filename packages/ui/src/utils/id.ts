const UUID_SUFFIX = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;

export function createUuid() {
  return crypto.randomUUID();
}

export function compactUuid(uuid: string) {
  return uuid.replaceAll("-", "");
}

export function createCompactId() {
  return compactUuid(createUuid());
}

export function createPrefixedId(prefix: string) {
  return `${prefix}_${createUuid()}`;
}

export function createWorkspaceCommitId() {
  return createCompactId();
}

export function initialWorkspaceCommitId(imageId: string) {
  const match = imageId.match(UUID_SUFFIX);
  return `initial_${match ? match.slice(1).join("") : imageId}`;
}

export function isInitialWorkspaceCommitId(commitId: string, imageId: string) {
  return commitId === initialWorkspaceCommitId(imageId) || commitId === `initial_${imageId}`;
}
