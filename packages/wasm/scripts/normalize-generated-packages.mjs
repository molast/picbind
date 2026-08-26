import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  {
    directory: "image-wasm",
    name: "@picbind/image-wasm",
    entry: "image_wasm.js",
    types: "image_wasm.d.ts",
  },
  {
    directory: "perceptual-wasm",
    name: "@picbind/perceptual-wasm",
    entry: "perceptual_wasm.js",
    types: "perceptual_wasm.d.ts",
  },
];

for (const generatedPackage of packages) {
  const manifestPath = resolve(root, generatedPackage.directory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const {
    name: _name,
    type: _type,
    exports: _exports,
    main: _main,
    module: _module,
    version,
    files,
    types,
    sideEffects,
    ...remainingFields
  } = manifest;
  const normalizedManifest = {
    name: generatedPackage.name,
    version,
    type: "module",
    exports: {
      ".": {
        types: `./${generatedPackage.types}`,
        import: `./${generatedPackage.entry}`,
      },
    },
    files,
    module: generatedPackage.entry,
    types,
    sideEffects,
    ...remainingFields,
  };

  await writeFile(manifestPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`);

  const gitignorePath = resolve(root, generatedPackage.directory, ".gitignore");
  const trackedFiles = [
    "*",
    "!.gitignore",
    "!package.json",
    `!${generatedPackage.entry}`,
    `!${generatedPackage.types}`,
    `!${generatedPackage.entry.replace(/\.js$/, "_bg.wasm")}`,
    `!${generatedPackage.entry.replace(/\.js$/, "_bg.wasm.d.ts")}`,
  ];
  await writeFile(gitignorePath, `${trackedFiles.join("\n")}\n`);
}
