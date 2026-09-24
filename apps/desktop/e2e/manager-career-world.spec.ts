import { expect, test, type Page } from "@playwright/test";

/**
 * Unemployed -> hired -> managing -> resigning -> unemployed -> hired again,
 * driven through the live Career workspace against a real SQLite save. The
 * Job Centre and Resign button that used to live on the retired Home screen
 * are now Career Jobs; this spec protects the same lifecycle there. Sacking for
 * poor performance is covered at the simulation-package level
 * (manager-career-world.test.ts): reaching it legitimately needs many
 * simulated matches, which is too slow and too flaky for E2E. Transition
 * detail (persistence, employed moves, role boundaries) lives in career-jobs.
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

const goTo = (page: Page, screen: string) =>
  page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: screen, exact: true })
    .click();

test("resigns, applies for a new job, and manages again", async ({ page }) => {
  test.setTimeout(240_000);
  const saveName = `E2E Career World ${Date.now()}`;
  await openCareer(page, saveName);

  // --- Employed: resign from the Career workspace ---------------------------
  await goTo(page, "Career Jobs");
  await expect(page.getByText(/You are currently employed/i)).toBeVisible();
  await page.getByRole("button", { name: /^Resign from / }).click();
  await page.getByRole("button", { name: "Confirm resignation" }).click();

  // --- Unemployed: Home says so and Career Jobs offers the market -----------
  await expect(page.getByText(/You are currently unemployed/i)).toBeVisible();
  await goTo(page, "Home / Inbox");
  await expect(page.getByText(/currently unemployed/i)).toBeVisible();
  await goTo(page, "Career Jobs");
  await expect(page.getByRole("heading", { name: "Open vacancies", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);

  // Apply for the first eligible vacancy, retrying with a day of world time
  // between attempts so a rejected interview rolls again on a new date.
  let offered = false;
  for (let attempt = 0; attempt < 6 && !offered; attempt += 1) {
    const applyButton = page.getByRole("button", { name: /^Apply to / }).and(page.locator(":enabled")).first();
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    const acceptButton = page.getByRole("button", { name: /^Accept offer from / });
    await expect(page.getByRole("table", { name: "My job applications" })).toBeVisible();
    await page.waitForTimeout(300);
    if (await acceptButton.count()) {
      offered = true;
      break;
    }
    await page.request.post("/runtime/command/continueCareer", { data: {} });
    await goTo(page, "Career Overview");
    await goTo(page, "Career Jobs");
    await expect(page.getByText("Loading…")).toHaveCount(0);
  }
  expect(offered).toBe(true);

  // --- Accept the offer: employed again ------------------------------------
  await page.getByRole("button", { name: /^Accept offer from / }).first().click();
  await expect(page.getByText(/You are currently employed/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Resign from / })).toBeVisible();

  // --- Career history records both spells ---------------------------------
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { name: "Appointments", level: 2 })).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  // Career history renders outcomes as lowercase text and marks the live
  // appointment "current".
  await expect(page.locator("main")).toContainText(/resigned/i);
  await expect(page.locator("main").getByText("current", { exact: true })).toHaveCount(1);

  // Leave the shared saves directory as this test found it.
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page
    .locator(".club-row-group", { hasText: saveName })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("button", { name: new RegExp(saveName) })).toHaveCount(0);
});
