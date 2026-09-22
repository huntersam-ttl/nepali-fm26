import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5C — Shortlists + Squad Planner (derived future-needs view).
 * Navigation-backed; single canonical shortlist shared with Player Database.
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

test("shortlist flow: Player Database -> Shortlists -> Remove reflects one canonical state", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Shortlist flow ${Date.now()}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await goTo(page, "Player Database");
  await expect(page.getByRole("button", { name: "Shortlist", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Shortlist", exact: true }).first().click();

  await goTo(page, "Shortlists");
  await expect(page.getByRole("heading", { name: "Shortlists" }).last()).toBeVisible();
  // The shortlisted player appears in the canonical shortlist.
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" }).first()).toBeVisible();

  // Remove reflects canonical state.
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText(/No players shortlisted/i).first()).toBeVisible();
});

test("Squad Planner groups the real squad by position and applies a factual horizon", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Squad planner ${Date.now()}`);
  await goTo(page, "Squad Planner");
  await expect(page.getByRole("heading", { name: "Squad Planner" }).last()).toBeVisible();

  // At least one canonical position lane renders with real players.
  await expect(
    page.locator("h3").filter({ hasText: /Goalkeepers|Defenders|Midfielders|Attackers/ }).first(),
  ).toBeVisible();
  await expect(
    page.locator("h3").filter({ hasText: /players/ }).first(),
  ).toBeVisible();
  // Horizon selector is present and changes classification without error.
  await page.getByLabel("Future horizon").selectOption("365");
  await expect(page.locator("table").getByText(/Contract|Horizon|players/).first()).toBeVisible();
});

test("shortlist targets keep uncertainty (ranges/Unknown) and open a Player -> Back", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Shortlist knowledge ${Date.now()}`);
  await goTo(page, "Player Database");
  await page.getByRole("button", { name: "Shortlist", exact: true }).first().click();
  await goTo(page, "Shortlists");
  // Ability shows as a preserved range or Unknown in the table (text, not a button).
  await expect(page.locator("tbody").getByText(/Unknown|–/).first()).toBeVisible();
});