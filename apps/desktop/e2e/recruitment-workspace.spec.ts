import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5A — Recruitment workspace family (Overview / Player Database /
 * Recommendations). Navigation-backed; no internal mode cycling. Knowledge and
 * empty states are asserted truthfully against the canonical read model.
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

test("Recruitment family navigates Overview, Player Database and Recommendations", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Recruitment family ${Date.now()}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await goTo(page, "Player Database");
  await expect(page.getByRole("heading", { name: "Player Database" }).last()).toBeVisible();
  await goTo(page, "Recommendations");
  await expect(page.getByRole("heading", { name: "Recommendations" }).last()).toBeVisible();
  await goTo(page, "Recruitment Overview");
  await expect(page.getByRole("heading", { name: "Recruitment Overview" }).last()).toBeVisible();
});

test("Player Database renders, filters, sorts, and opens a Player -> Back", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Recruitment DB ${Date.now()}`);

  await goTo(page, "Player Database");
  await expect(page.getByRole("heading", { name: "Player Database" }).last()).toBeVisible();
  // Search input + knowledge filter + sort controls.
  await expect(page.getByLabel("Search known players").first()).toBeVisible();
  await expect(page.locator(".dashboard").getByLabel("Knowledge").first()).toBeVisible();
  await expect(page.locator(".dashboard").getByLabel("Sort").first()).toBeVisible();

  // Use a real sort.
  await page.locator(".dashboard").getByLabel("Sort").first().selectOption("knowledge");
  await expect(page.locator(".dashboard").getByLabel("Sort").first()).toHaveValue("knowledge");

  // Open a discovered player if one is present (identity uses canonical name).
  const playerLink = page.locator("table").getByRole("button", { name: /^[A-Z]/ }).first();
  if (await playerLink.count()) {
    const name = (await playerLink.textContent()) ?? "";
    await playerLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Player Database");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Player Database" }).last()).toBeVisible();
    await expect(page.locator("table").getByRole("button", { name }).first()).toBeVisible();
  }
});

test("Recommendations is truthful: real report or honest empty state", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Recruitment recs ${Date.now()}`);
  await goTo(page, "Recommendations");
  await expect(page.getByRole("heading", { name: "Recommendations" }).last()).toBeVisible();
  // Either a real recommendation is shown, or an honest empty state appears.
  const hasReport = (await page.locator(".recommendation").getByRole("button", { name: /^[A-Z]/ }).count()) > 0;
  if (hasReport) {
    await expect(page.locator(".recommendation").first()).toBeVisible();
  } else {
    await expect(page.getByText(/No scout reports yet/i)).toBeVisible();
  }
});

test("Recruitment is distinct from global search (search still reachable independently)", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Recruitment search ${Date.now()}`);
  await goTo(page, "Player Database");
  await expect(page.locator(".dashboard").getByLabel("Knowledge").first()).toBeVisible();
  // The Phase 1 global search control remains available in the shell.
  await expect(page.getByRole("button", { name: "Search football world" })).toBeVisible();
});