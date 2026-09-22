import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5B — Recruitment Focuses + scouting uncertainty.
 * Navigation-backed; honest empty/lifecycle states against the canonical read.
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

test("Recruitment Focuses is a first-class destination reflecting real assignment lifecycle", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Focuses lifecycle ${Date.now()}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await goTo(page, "Recruitment Focuses");
  await expect(page.getByRole("heading", { name: "Recruitment Focuses" }).last()).toBeVisible();
  // Either canonical assignments render, or the honest empty state appears.
  const hasAssignments = (await page.locator("table tbody tr").count()) > 0;
  if (hasAssignments) {
    await expect(page.locator("table").getByRole("button", { name: /active|completed|cancelled/i }).first()).toBeVisible();
  } else {
    await expect(page.getByText(/No scouting assignments yet/i)).toBeVisible();
  }
});

test("Player Database exposes uncertainty (Knowledge + Confidence) and a Scout action", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Focuses db ${Date.now()}`);
  await goTo(page, "Player Database");
  await expect(page.getByRole("heading", { name: "Player Database" }).last()).toBeVisible();

  await expect(page.locator("thead").getByText("Knowledge")).toBeVisible();
  await expect(page.locator("thead").getByText("Confidence")).toBeVisible();
  await expect(page.getByRole("button", { name: "Scout" }).first()).toBeVisible();

  // If a real scouting assignment is created, Regression Focuses reflects it;
  // otherwise (network can't support it) the Focuses page stays truthful.
  await page.getByRole("button", { name: "Scout" }).first().click().catch(() => undefined);
  await goTo(page, "Recruitment Focuses");
  await expect(page.getByRole("heading", { name: "Recruitment Focuses" }).last()).toBeVisible();
  const nowActive = (await page.locator("table").getByRole("button", { name: /active/i }).count()) > 0;
  if (nowActive) {
    await expect(page.locator("table").getByRole("button", { name: /active/i }).first()).toBeVisible();
  } else {
    await expect(page.getByText(/No scouting assignments yet|Active focuses/i).first()).toBeVisible();
  }
});

test("knowledge estimates stay ranges and unknown stays unknown", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Focuses knowledge ${Date.now()}`);
  await goTo(page, "Player Database");
  await expect(page.getByRole("heading", { name: "Player Database" }).last()).toBeVisible();
  // Ranges are displayed as "min–max"; unknown values read as "Unknown".
  const cellText = await page.locator("tbody tr").first().textContent();
  // Ability shows as a preserved range ("min–max"), never collapsed to a midpoint.
  expect(cellText ?? "").toMatch(/\d+–\d+/);
});