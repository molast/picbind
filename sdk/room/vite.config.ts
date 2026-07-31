import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sdkRoot = decodeURIComponent(new URL("..", import.meta.url).pathname);

export default defineConfig(({ mode }) => {
  return {
    base: "./",
    plugins: [react()],
    server: {
      fs: {
        allow: [sdkRoot],
      },
      proxy: {
        "/api": {
          target: "https://api.picbind.com",
          changeOrigin: true,
          ws: true,
          headers: {
            origin: "https://picbind.com",
          },
        },
      },
    },
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
  };
});
