import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // React component tests (.test.tsx) are transformed by esbuild's automatic
  // JSX runtime — no @vitejs/plugin-react, which double-transformed the JSX
  // under Vitest and broke element identity. Components still `import React`
  // for their type annotations; the unused-value import is harmless.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
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
    // .test.ts files run in the default node environment (pure presentation
    // logic, simulation, DB). .test.tsx files are React component tests — each
    // opts into a DOM via a `// @vitest-environment happy-dom` docblock and is
    // the minimal accessibility harness for the relationship UI.
    include: ["packages/**/*.test.ts", "apps/desktop/src/**/*.test.{ts,tsx}"],
    pool: "forks",
  },
});
