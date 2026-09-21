import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4D — Tactics closure.
 *
 * Navigation-backed, one meaningful state transition per test — deliberately
 * avoids same-page mode-radio cycling (known environment flake). All edits use
 * the canonical updateTactics path; assertions are direct `toBeChecked` /
 * `toHaveValue` and `Player role` (never the ambiguous topbar career role).
 */

const LONG = 120_000;

const createCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: LONG });
};

const goTo = (page: Page, screen: string) =>
  page.locator("nav").getByRole("button", { name: screen, exact: true }).click();

const openTactics = async (page: Page): Promise<void> => {
  await goTo(page, "Tactics");
  await expect(page.locator(".pitch")).toBeVisible();
};

const setMode = async (page: Page, label: string): Promise<void> => {
  await page.getByRole("radio", { name: label, exact: true }).click();
};

test("Tactics readiness, familiarity and validation surface are visible and truthful", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Closure readiness ${Date.now()}`);
  await openTactics(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await expect(page.getByRole("heading", { name: "Match readiness", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Familiarity" })).toBeVisible();
  await expect(page.locator(".readiness-list").getByText(/Starting XI:/)).toBeVisible();
  await expect(page.locator(".readiness-list").getByText(/Tactical familiarity — formation \d+%/)).toBeVisible();
  await expect(page.locator(".readiness-list").getByText(/Set pieces: \d+ takers assigned/)).toBeVisible();
});

test("full persistence: role change survives navigation", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Closure persist role ${Date.now()}`);
  await openTactics(page);

  await page.locator(".pitch .slot").first().click();
  const roleSelect = page.getByLabel("Player role");
  const roleValues = await roleSelect
    .locator("option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  const currentRole = await roleSelect.inputValue();
  const chosenRole = roleValues.find((value) => value !== "" && value !== currentRole);
  await roleSelect.selectOption(chosenRole!);
  await expect(roleSelect).toHaveValue(chosenRole!);

  await goTo(page, "Home / Inbox");
  await openTactics(page);
  await page.locator(".pitch .slot").first().click();
  await expect(page.getByLabel("Player role")).toHaveValue(chosenRole!);
});

test("full persistence: set-piece assignment survives navigation", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Closure persist setpiece ${Date.now()}`);
  await openTactics(page);

  setMode(page, "Set Pieces");
  const taker = page.getByLabel("Penalty taker");
  // Wait for the squad/roleFits to populate the taker list before reading it.
  await expect
    .poll(
      async () =>
        await taker
          .locator("option")
          .evaluateAll((els) => els.filter((el) => (el as HTMLOptionElement).value !== "").length),
    )
    .toBeGreaterThan(0);
  const takerValues = await taker
    .locator("option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  const chosenTaker = takerValues.find((value) => value !== "");
  await taker.selectOption(chosenTaker!);
  await expect(taker).toHaveValue(chosenTaker!);

  await goTo(page, "Home / Inbox");
  await openTactics(page);
  setMode(page, "Set Pieces");
  await expect(taker).toHaveValue(chosenTaker!);
});

test("player profile round-trip preserves role and mode context", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Closure profile ${Date.now()}`);
  await openTactics(page);

  await page.locator(".pitch .slot").first().click();
  const roleSelect = page.getByLabel("Player role");
  const roleBefore = await roleSelect.inputValue();
  const profileLink = page.getByRole("button", { name: /Open .*'s profile/ }).first();
  if (await profileLink.count()) {
    await profileLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Tactics");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.locator(".pitch")).toBeVisible();
    await page.locator(".pitch .slot").first().click();
    await expect(page.getByLabel("Player role")).toHaveValue(roleBefore);
  }
});

test("match readiness routes to Match Day (Quick Sim / Key Events / Text Live only)", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Closure matchday ${Date.now()}`);
  await openTactics(page);
  await expect(page.getByRole("heading", { name: "Match readiness", level: 3 })).toBeVisible();

  const matchdayCta = page.getByRole("button", { name: /Matchday/ });
  const advance = page.locator(".topbar").getByRole("button", { name: "Continue", exact: true });
  for (let attempt = 0; attempt < 12 && !(await matchdayCta.count()); attempt += 1) {
    await advance.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  await expect(matchdayCta).toBeVisible({ timeout: LONG });
  await matchdayCta.click();
  await expect(page.getByRole("heading", { name: "Match preparation" })).toBeVisible({ timeout: LONG });
  await expect(page.getByRole("radio", { name: /Quick Sim/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Key Events/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Text Live/ })).toBeVisible();
});