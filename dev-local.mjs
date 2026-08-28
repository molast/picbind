import { spawn, spawnSync } from "node:child_process";
import { get } from "node:http";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(rootDir, "apps", "web");
const desktopDir = join(rootDir, "apps", "desktop");
const isWindows = process.platform === "win32";
const packageManager = "pnpm";
const webPort = 3000;
const desktopDevUrl = `http://localhost:${webPort}/tauri-dev.html`;
const webStartupTimeoutMs = 180_000;
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

function canConnect(host) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: webPort });
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function isWebPortInUse() {
  const results = await Promise.all([
    canConnect("127.0.0.1"),
    canConnect("::1"),
  ]);
  return results.some(Boolean);
}

function probeDesktopDevUrl() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = get(
      desktopDevUrl,
      { headers: { accept: "text/html", "cache-control": "no-cache" } },
      (response) => {
        response.resume();
        const statusCode = response.statusCode ?? 0;
        finish({
          reachable: true,
          ready: statusCode >= 200 && statusCode < 400,
          statusCode,
        });
      },
    );
    request.setTimeout(1_000, () => request.destroy());
    request.once("error", () =>
      finish({ reachable: false, ready: false, statusCode: 0 }),
    );
  });
}

async function waitForDesktopDevUrl() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < webStartupTimeoutMs) {
    const probe = await probeDesktopDevUrl();
    if (probe.ready) return;
    if (probe.reachable && probe.statusCode >= 400 && probe.statusCode < 500) {
      throw new Error(
        `The service on port ${webPort} returned HTTP ${probe.statusCode} for ${desktopDevUrl}. ` +
          "Make sure the existing service is this repository's Web app.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Web app did not become ready at ${desktopDevUrl} within ${webStartupTimeoutMs / 1_000} seconds.`,
  );
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

async function main() {
  ensurePnpm();
  const mode = process.argv[2] || "desktop";
  if (mode !== "desktop" && mode !== "desktop-only" && mode !== "web") {
    console.error(`Unknown local development mode: ${mode}`);
    process.exit(2);
  }

  const reuseWebApp = await isWebPortInUse();
  if (reuseWebApp) {
    console.log(`Reusing Web app at http://localhost:${webPort}.`);
  } else if (mode === "desktop-only") {
    console.error(
      `Desktop-only mode requires the Web app at http://localhost:${webPort}. ` +
        "Start the Web service first.",
    );
    process.exit(1);
  } else {
    start("Web app", webDir, ["run", "dev"]);
  }

  if (mode === "web") return;

  try {
    await waitForDesktopDevUrl();
  } catch (error) {
    console.error(error.message);
    await shutdown(1);
    return;
  }

  start("Desktop app", desktopDir, ["run", "dev:tauri"]);
}

await main();
