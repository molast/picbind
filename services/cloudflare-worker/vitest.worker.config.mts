import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          ALLOWED_ORIGINS: "http://127.0.0.1:4174,http://localhost:4174,tauri://localhost,http://tauri.localhost",
          LOCAL_RUNTIME: "1",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.worker.test.ts"],
  },
});
