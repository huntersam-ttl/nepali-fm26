import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E drives the real runtime, so it needs a real but disposable save directory.
 * Never point this at the repository or the player's application data.
 */
const savesDirectory = process.env.NEPAL_SAVES_DIR ?? join(tmpdir(), "nepal-football-e2e-saves");
mkdirSync(savesDirectory, { recursive: true });
process.env.NEPAL_SAVES_DIR = savesDirectory;

export default defineConfig({
  testDir: "apps/desktop/e2e",
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "pnpm --filter @nepal-football-sim/simulation build && pnpm --filter @nepal-football-sim/desktop dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEPAL_SAVES_DIR: savesDirectory },
  },
});
