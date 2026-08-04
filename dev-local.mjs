import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const workerDir = join(rootDir, "cloudflare-worker");
const webDir = join(rootDir, "web");
const messagingDir = join(rootDir, "messaging-service");
const isWindows = process.platform === "win32";
const packageManager = "pnpm";
const children = new Map();
let shuttingDown = false;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: isWindows,
    ...options,
  });
}

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

function ensureWorkerDependencies() {
  const binDir = join(workerDir, "node_modules", ".bin");
  const crossEnvBin = join(binDir, isWindows ? "cross-env.CMD" : "cross-env");
  const wranglerBin = join(binDir, isWindows ? "wrangler.CMD" : "wrangler");
  const dependenciesReady = () =>
    existsSync(crossEnvBin) && existsSync(wranglerBin);
  if (dependenciesReady()) return;

  console.log("Installing local Worker dependencies...");
  const result = run(packageManager, ["install", "--frozen-lockfile"], {
    cwd: workerDir,
    env: { ...process.env, CI: process.env.CI ?? "true" },
  });
  if (result.status !== 0) {
    console.error("Failed to install local Worker dependencies.");
    process.exit(result.status ?? 1);
  }
  if (!dependenciesReady()) {
    console.error(
      "Worker dependencies were installed, but their command links are missing.",
    );
    process.exit(1);
  }
}

function ensureLocalWorkerVariables() {
  const target = join(workerDir, ".dev.vars");
  if (existsSync(target)) return;

  const example = join(workerDir, ".dev.vars.example");
  if (!existsSync(example)) {
    console.error(`Missing local Worker variable template: ${example}`);
    process.exit(1);
  }
  copyFileSync(example, target);
}

function ensureMessagingGateway() {
  const binDir = join(messagingDir, "node_modules", ".bin");
  const tscBin = join(binDir, isWindows ? "tsc.CMD" : "tsc");
  if (!existsSync(tscBin)) {
    console.log("Installing workspace dependencies for Messaging Gateway...");
    const install = run(packageManager, ["install", "--frozen-lockfile"], {
      cwd: webDir,
      env: { ...process.env, CI: process.env.CI ?? "true" },
    });
    if (install.status !== 0 || !existsSync(tscBin)) {
      console.error("Failed to install Messaging Gateway dependencies.");
      process.exit(install.status ?? 1);
    }
  }

  console.log("Building Messaging Gateway...");
  const build = run(tscBin, ["-p", "tsconfig.gateway.json"], {
    cwd: messagingDir,
  });
  if (build.status !== 0) {
    console.error("Failed to build Messaging Gateway.");
    process.exit(build.status ?? 1);
  }
}

function start(name, cwd, command = packageManager, args = ["run", "dev"]) {
  const child = spawn(command, args, {
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
ensureWorkerDependencies();
ensureLocalWorkerVariables();
ensureMessagingGateway();
start("Local Worker", workerDir);
start("Web app", webDir);
start("Messaging Gateway", messagingDir, process.execPath, [
  "--enable-source-maps",
  join(messagingDir, "gateway-dist", "server.js"),
]);
