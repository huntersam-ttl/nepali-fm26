import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 5D — Transfers / Budgets / Contracts / Transfer Window closure.
 * Exercises the existing canonical Transfers/Contracts/Staff screens plus the
 * new Recruitment integration (Overview transfer context + Shortlist→Transfers).
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

test("Transfer Activity shows real budget and transfer-window context", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Transfer activity ${Date.now()}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  await goTo(page, "Transfers");
  await expect(page.locator(".workspace")).toContainText("Transfer budget");
  // Window state is canonical text (open with a close date, or closed notice).
  const body = (await page.locator(".workspace").textContent()) ?? "";
  expect(body).toMatch(/Open until|window is closed|Closed/i);
});

test("Recruitment Overview surfaces transfer context; Shortlist links to Transfers", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Overview transfers ${Date.now()}`);
  await goTo(page, "Recruitment Overview");
  await expect(page.getByRole("heading", { name: "Recruitment Overview" }).last()).toBeVisible();
  await expect(page.getByText("Transfer context").first()).toBeVisible();

  await goTo(page, "Shortlists");
  await expect(page.getByRole("heading", { name: "Shortlists" }).last()).toBeVisible();
  await page.getByRole("button", { name: "Open transfer context" }).click();
  await expect(page.locator(".workspace")).toContainText("Transfer budget");
});

test("Contracts and Staff (recruitment hiring) remain reachable in the Recruitment flow", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Contracts staff ${Date.now()}`);
  await goTo(page, "Contracts");
  await expect(page.locator(".workspace")).toContainText("Squad wage bill");
  await goTo(page, "Staff");
  await expect(page.getByRole("heading", { name: "Vacancies" })).toBeVisible();
});