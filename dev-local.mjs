import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(rootDir, "web");
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

function start(name, cwd) {
  const child = spawn(packageManager, ["run", "dev"], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: isWindows,
    detached: !isWindows,
  });
  children.set(name, child);

  child.once("error", (error) => {
    console.error(`${name} failed to start:`, error.message);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`${name} stopped unexpectedly (${reason}).`);
    void shutdown(code && code > 0 ? code : 1);
  });
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  if (isWindows) {
    return new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      resolve();
    }, 3000);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...children.values()].map(stopChild));
  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));

ensurePnpm();
start("Web app", webDir);
