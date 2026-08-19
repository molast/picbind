export type RuntimeLogEnv = {
  DEV_MODE?: string;
};

export function isDevMode(env: RuntimeLogEnv) {
  return env.DEV_MODE?.trim() === "1";
}

export function devError(env: RuntimeLogEnv, ...args: unknown[]) {
  if (isDevMode(env)) {
    console.error(...args);
  }
}
