import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  build:
    mode === "library"
      ? {
          lib: {
            entry: "src/library.ts",
            formats: ["es"],
            fileName: () => "index.js",
          },
          rollupOptions: {
            external: ["react", "react-dom", "react/jsx-runtime"],
            output: {
              banner: '"use client";',
            },
          },
          cssFileName: "picbind-room",
          emptyOutDir: true,
        }
      : undefined,
}));
