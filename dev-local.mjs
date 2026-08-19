import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(rootDir, "apps", "web");
const desktopDir = join(rootDir, "apps", "desktop");
const isWindows = process.platform === "win32";
const packageManager = "pnpm";
const children = new Map();
let shuttingDown = false;

function ensurePnpm() {
  const result = spawnSync(packageManager, ["--version"], {
    cwd: rootDir,
    stdio: "ignore",
    shell: isWindows,
  });
  if (result.status === 0) return;

  console.error(
    "pnpm is required. Install it first or enable it with: corepack enable",
  );
  process.exit(1);
}

function start(name, cwd, args) {
  const child = spawn(packageManager, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: isWindows,
    detached: !isWindows,
  });
  const processRecord = { child, pid: child.pid };
  children.set(name, processRecord);

  child.once("error", (error) => {
    console.error(`${name} failed to start:`, error.message);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`${name} stopped unexpectedly (${reason}).`);
    void shutdown(code && code > 0 ? code : 1);
  });
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function waitForProcessGroup(pid, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      if (!processGroupExists(pid) || Date.now() - startedAt >= timeoutMs) {
        resolve(!processGroupExists(pid));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

async function stopChild({ child, pid }) {
  if (!pid) {
    return Promise.resolve();
  }

  if (isWindows) {
    return new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  }

  if (!processGroupExists(pid)) return;

  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  if (await waitForProcessGroup(pid, 3000)) return;

  try {
    process.kill(-pid, "SIGKILL");
  } catch {}
  await waitForProcessGroup(pid, 1000);
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...children.values()].map(stopChild));
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.once("SIGHUP", () => void shutdown(129));

ensurePnpm();
const mode = process.argv[2] || "desktop";
if (mode === "desktop") {
  start("Web app", webDir, ["run", "dev"]);
  start("Desktop app", desktopDir, ["run", "dev:tauri"]);
} else if (mode === "web") {
  start("Web app", webDir, ["run", "dev"]);
} else {
  console.error(`Unknown local development mode: ${mode}`);
  process.exit(2);
}
