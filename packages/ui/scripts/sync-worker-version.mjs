import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workerPackageUrl = new URL(
  "../../../services/cloudflare-worker/package.json",
  import.meta.url,
);
const outputUrl = new URL("../src/generated-worker-version.ts", import.meta.url);
const workerPackage = JSON.parse(await readFile(workerPackageUrl, "utf8"));
const version = String(workerPackage.version || "").trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("services/cloudflare-worker/package.json has an invalid version");
}

const output = [
  "// Generated from services/cloudflare-worker/package.json. Do not edit manually.",
  `export const GENERATED_WORKER_VERSION = ${JSON.stringify(version)};`,
  "",
].join("\n");

let current = "";
try {
  current = await readFile(outputUrl, "utf8");
} catch {
  // The generated file is created on the first development or build command.
}
if (current !== output) await writeFile(outputUrl, output, "utf8");
