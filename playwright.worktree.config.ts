import { defineConfig, devices } from "@playwright/test";

/**
 * Worktree-only Playwright config: points at the isolated dev server this
 * session started itself on port 1421 (never the ambient main-checkout
 * server on 1420) and defines no webServer block, since that server is
 * managed manually — never auto-started/stopped by Playwright.
 */
export default defineConfig({
  testDir: "apps/desktop/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:1421",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
