import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E drives the real runtime, so it needs a real but disposable save directory.
 * Never point this at the repository or the player's application data.
 */
/**
 * Every spec used to reach the default server only, so specs that needed a
 * different checkout each grew their own NEPAL_*_E2E_BASE_URL override and the
 * rest could only ever target 127.0.0.1:1420. One global override lets a
 * worktree run the whole suite against its own server; the default is
 * unchanged, so nothing moves for anyone who does not set it.
 */
const e2eBaseUrl = process.env.NEPAL_E2E_BASE_URL ?? "http://127.0.0.1:1420";

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
    baseURL: e2eBaseUrl,
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
    /* Must track baseURL: pointing the suite at another server while still
       waiting on 1420 would either hang or silently reuse a foreign one. */
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEPAL_SAVES_DIR: savesDirectory, NEPAL_E2E_ROLE_FIXTURE: "1" },
  },
});
