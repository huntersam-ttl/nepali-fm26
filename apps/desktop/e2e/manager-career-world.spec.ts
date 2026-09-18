import { expect, test, type Page } from "@playwright/test";

/**
 * Unemployed -> hired -> managing -> resigning -> unemployed -> hired again,
 * driven through the real UI against a real SQLite save. Sacking for poor
 * performance is covered at the simulation-package level
 * (manager-career-world.test.ts) rather than here: reaching it legitimately
 * needs many simulated matches, which is too slow and too flaky for E2E.
 */
const CAREER_TIMEOUT = 120_000;

const openCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const clubPicker = page.getByLabel("Starting club");
  await expect(clubPicker).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: CAREER_TIMEOUT,
  });
};

test("resigns, applies for a new job, and manages again", async ({ page }) => {
  test.setTimeout(240_000);
  const saveName = `E2E Career World ${Date.now()}`;
  await openCareer(page, saveName);

  // --- Employed: resign --------------------------------------------------
  await expect(page.getByRole("heading", { name: "Club", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resign" }).click();

  // --- Unemployed: job centre appears -------------------------------------
  await expect(page.getByRole("heading", { name: "Job Centre" })).toBeVisible();
  await expect(page.locator(".topbar")).toContainText("Unemployed");

  // Apply for the first eligible vacancy, retrying with a day of world time
  // between attempts so a rejected interview rolls again on a new date.
  let offered = false;
  for (let attempt = 0; attempt < 6 && !offered; attempt += 1) {
    const applyButton = page.getByRole("button", { name: "Apply" }).first();
    await expect(applyButton).toBeVisible();
    await applyButton.click();
    await page.waitForTimeout(300);

    const acceptButton = page.getByRole("button", { name: "Accept" });
    if (await acceptButton.count()) {
      offered = true;
      break;
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(300);
  }
  expect(offered).toBe(true);

  // --- Accept the offer: employed again ------------------------------------
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("button", { name: "Resign" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".topbar")).not.toContainText("Unemployed");

  // --- Career history records both spells ---------------------------------
  await expect(page.getByRole("heading", { name: "Career history" })).toBeVisible();
  // Career history renders outcomes through humanizeEnum, so the page shows
  // "Resigned"/"Active" rather than the stored RESIGNED/ACTIVE tokens.
  await expect(page.locator(".workspace")).toContainText("Resigned");
  await expect(page.locator(".workspace")).toContainText("Active");

  // Leave the shared saves directory as this test found it.
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page
    .locator(".club-row-group", { hasText: saveName })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("button", { name: new RegExp(saveName) })).toHaveCount(0);
});
