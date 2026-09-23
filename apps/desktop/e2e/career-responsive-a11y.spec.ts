import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";

/** Phase 8A — direct per-screen responsive + accessibility for the Career family. */
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const seriousViolations = async (page: Page): Promise<unknown[]> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Document, options: unknown) => Promise<unknown> } }).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  return (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
};

const createCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 240_000 });
};

const goTo = (page: Page, screen: string) =>
  page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: screen, exact: true })
    .click();

const SCREENS = ["Career Overview", "Career History"];

test("Career screens have no page overflow at every required width, one h1", async ({ page }) => {
  test.setTimeout(900_000);
  await createCareer(page, `Career responsive ${Date.now()}`);
  const widths = [721, 1024, 1280, 1440, 1600];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const screen of SCREENS) {
      await goTo(page, screen);
      await expect(page.getByRole("heading", { name: screen, level: 2 }).last()).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(noOverflow, `${screen} at width ${width} must not overflow the page`).toBe(true);
    }
  }
});

test("Career screens are axe-clean (0 serious/critical)", async ({ page }) => {
  test.setTimeout(900_000);
  await createCareer(page, `Career a11y ${Date.now()}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const screen of SCREENS) {
    await goTo(page, screen);
    await expect(page.getByRole("heading", { name: screen, level: 2 }).last()).toBeVisible();
    const violations = await seriousViolations(page);
    if (violations.length > 0) console.log(`axe serious/critical on ${screen}:`, JSON.stringify(violations, null, 2));
    expect(violations, `serious/critical axe on ${screen}`).toHaveLength(0);
  }
});