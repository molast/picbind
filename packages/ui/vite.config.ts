import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const sdkRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  return {
    base: "./",
    plugins: [react()],
    worker: {
      format: "es",
    },
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      fs: {
        allow: [sdkRoot],
      },
    },
    build:
      mode === "library"
        ? {
            lib: {
              entry: "src/library.ts",
              formats: ["es"],
              fileName: () => "index.js",
              cssFileName: "picbind-workspace",
            },
            rollupOptions: {
              external: ["react", "react-dom", "react/jsx-runtime"],
              output: {
                banner: '"use client";',
              },
            },
            emptyOutDir: true,
          }
        : undefined,
  };
});
