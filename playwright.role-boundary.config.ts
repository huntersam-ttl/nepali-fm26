import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Session-scoped E2E config for the player-role-boundary cleanup work.
 * Runs on its own port (1421) so it never touches the ambient dev server
 * on 1420 that another session owns. Not part of the committed config.
 */
const savesDirectory = join(tmpdir(), `nepal-football-role-boundary-e2e-${Date.now()}`);
mkdirSync(savesDirectory, { recursive: true });

export default defineConfig({
  testDir: "apps/desktop/e2e",
  testMatch: /role-boundary\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "pnpm --filter @nepal-football-sim/simulation build && pnpm --filter @nepal-football-sim/desktop dev -- --port 1421",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NEPAL_SAVES_DIR: savesDirectory, NEPAL_E2E_ROLE_FIXTURE: "1" },
  },
});
