import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database tests boot an in-process Postgres (PGlite) and apply every migration.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
