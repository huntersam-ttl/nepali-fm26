import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    external: ["node:sqlite"],
  },
  resolve: {
    alias: {
      "@nepal-football-sim/data-import": fileURLToPath(
        new URL("./packages/data-import/src/index.ts", import.meta.url),
      ),
      "@nepal-football-sim/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url),
      ),
      "@nepal-football-sim/rules": fileURLToPath(
        new URL("./packages/rules/src/index.ts", import.meta.url),
      ),
      "@nepal-football-sim/shared-types": fileURLToPath(
        new URL("./packages/shared-types/src/index.ts", import.meta.url),
      ),
      "@nepal-football-sim/simulation": fileURLToPath(
        new URL("./packages/simulation/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    // apps/desktop's negotiationPresentation.test.ts covers pure
    // (non-React, non-DOM) presentation logic — the app has no
    // React/jsdom test harness, so only type-erased-import-safe,
    // DOM-free modules belong here.
    include: ["packages/**/*.test.ts", "apps/desktop/src/**/*.test.ts"],
    pool: "forks",
  },
});
