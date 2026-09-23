import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 8A — Career workspace (Overview + History).
 * Only supported canonical flows: the Career family, the human player's current
 * role/base-career vs temporary-office semantics, and persistent history.
 */
const LONG = 180_000;

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
  page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: screen, exact: true })
    .click();

test("1. Career family exposes Overview | History with one h1 and current role", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Career ${Date.now()}`);
  await goTo(page, "Career Overview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Career Overview", level: 2 }).last()).toBeVisible();
  // Current role is surfaced for the human player.
  const body = await page.locator("main").innerText();
  expect(body).toMatch(/current role/i);
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Career History", level: 2 }).last()).toBeVisible();
});

test("2. Career Overview shows the current club and tenure for a Manager", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Overview ${Date.now()}`);
  await goTo(page, "Career Overview");
  await expect(page.getByRole("heading", { name: "Career Overview", level: 2 }).last()).toBeVisible();
  await expect(page.getByText(/Manager/i).first()).toBeVisible();
  await expect(page.getByText(/Tenure start/i).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/bonus|release clause|severance|salary/i);
});

test("3. Career History lists appointments and honours (or honest empties)", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `History ${Date.now()}`);
  await goTo(page, "Career History");
  await expect(page.getByRole("heading", { name: "Career History", level: 2 }).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Appointments|Honours/i, level: 2 }).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(/no prior roles are on record/i.test(body) || /current/i.test(body)).toBe(true);
});

test("4. Back returns from Career History to Career Overview", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Career nav ${Date.now()}`);
  await goTo(page, "Career Overview");
  await goTo(page, "Career History");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("heading", { name: "Career Overview", level: 2 }).last()).toBeVisible();
});