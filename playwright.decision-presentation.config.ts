import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Session-scoped E2E config for the off-pitch decision-presentation work
 * (Phases 6D-6E). Runs on its own port (1422) so it never touches the
 * ambient dev server on 1420 that another session may own, and uses an
 * isolated saves directory so it cannot collide with any shared/ambient
 * save. Not part of the committed config.
 */
const savesDirectory = join(tmpdir(), `nepal-football-decision-presentation-e2e-${Date.now()}`);
mkdirSync(savesDirectory, { recursive: true });

export default defineConfig({
  testDir: "apps/desktop/e2e",
  testMatch: /(decision-presentation|investor-presentation|press-presentation)\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:1422",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "pnpm --filter @nepal-football-sim/simulation build && pnpm --filter @nepal-football-sim/desktop exec vite --host 127.0.0.1 --port 1422",
    url: "http://127.0.0.1:1422",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NEPAL_SAVES_DIR: savesDirectory, NEPAL_E2E_ROLE_FIXTURE: "1" },
  },
});
