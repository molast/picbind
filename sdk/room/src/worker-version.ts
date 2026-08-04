export const EXPECTED_WORKER_VERSION = "3.0.0";
export const WORKER_VERSION_HEADER = "x-picbind-worker-version";

export type WorkerVersionMismatch = {
  expected: string;
  actual: string | null;
};

type MismatchListener = (mismatch: WorkerVersionMismatch) => void;

const SESSION_KEY_PREFIX = "picbind:worker-version-warning:";
const listeners = new Set<MismatchListener>();
let currentMismatch: WorkerVersionMismatch | null = null;

function sessionKey(mismatch: WorkerVersionMismatch) {
  return `${SESSION_KEY_PREFIX}${mismatch.expected}`;
}

function wasAlreadyReported(mismatch: WorkerVersionMismatch) {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(sessionKey(mismatch)) === "1";
  } catch {
    return false;
  }
}

function markReported(mismatch: WorkerVersionMismatch) {
  try {
    window.sessionStorage.setItem(sessionKey(mismatch), "1");
  } catch {
    // The in-memory value still prevents duplicate dialogs when storage is unavailable.
  }
}

export function checkWorkerVersion(response: Response) {
  if (typeof window === "undefined") return;

  const actual = response.headers.get(WORKER_VERSION_HEADER)?.trim() || null;
  if (actual === EXPECTED_WORKER_VERSION) return;

  const mismatch = { expected: EXPECTED_WORKER_VERSION, actual };
  if (
    (currentMismatch?.expected === mismatch.expected &&
      currentMismatch.actual === mismatch.actual) ||
    wasAlreadyReported(mismatch)
  ) {
    return;
  }

  currentMismatch = mismatch;
  markReported(mismatch);
  listeners.forEach((listener) => listener(mismatch));
}

export function subscribeWorkerVersionMismatch(listener: MismatchListener) {
  listeners.add(listener);
  if (currentMismatch) listener(currentMismatch);
  return () => listeners.delete(listener);
}
