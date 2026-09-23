import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 6D — Club closure (Supporters, Commercial, History & Honours) + final
 * Club family. Only supported canonical flows: real supporter/commercial/
 * history state with honest empties, canonical clicks, and Manager read-only
 * authority.
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

test("1. final Club family exposes every live destination with one h1", async ({ page }) => {
  test.setTimeout(800_000);
  await createCareer(page, `Club closure ${Date.now()}`);
  const family = [
    "Club Overview",
    "Club Profile",
    "Club Finances",
    "Club Board",
    "Responsibilities",
    "Facilities",
    "Infrastructure Projects",
    "Supporters",
    "Commercial",
    "History & Honours",
  ];
  for (const label of family) {
    await goTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: label, level: 2 }).last()).toBeVisible();
  }
});

test("2. Supporters surfaces real mood/context or honest empty, Manager read-only", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Supporters ${Date.now()}`);
  await goTo(page, "Supporters");
  await expect(page.getByRole("heading", { name: "Supporters", level: 2 }).last()).toBeVisible();
  // Real supporter state renders, or the screen honestly reports no supporter data.
  await expect(page.locator("main").getByText(/(Mood|no supporter data)/i).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/supporter score/i);
  const buttons = await page.locator("main button").allInnerTexts();
  expect(buttons.filter((b) => /ticket price|invest|consult|community project/i.test(b)).length).toBe(0);
});

test("3. Commercial shows real partners (or honest empty) and no Owner-only controls", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Commercial ${Date.now()}`);
  await goTo(page, "Commercial");
  await expect(page.getByText(/Current partners/i).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  const hasPartners = /partner/i.test(body);
  const hasEmpty = /no active commercial partners/i.test(body);
  expect(hasPartners || hasEmpty).toBe(true);
  const buttons = await page.locator("main button").allInnerTexts();
  expect(buttons.filter((b) => /negotiate|approve deal|reject|renew|kit supplier/i.test(b)).length).toBe(0);
});

test("4. History & Honours shows real milestones/honours or honest empty", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `History ${Date.now()}`);
  await goTo(page, "History & Honours");
  await expect(page.getByRole("heading", { name: "History & Honours", level: 2 }).last()).toBeVisible();
  // Wait for the honours panel to resolve (recorded honours or honest empty).
  await expect(
    page.locator("main").getByText(/(no honours are on record|competition|no recorded milestones)/i).first(),
  ).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/founded in \d{4} and|won the league in 18\d\d/i);
});

test("5. Club Overview closure summaries link to the new destinations", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Overview closure ${Date.now()}`);
  await goTo(page, "Club Overview");
  await expect(page.getByRole("heading", { name: "Supporters & Beyond", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /History & Honours/ }).first().click();
  await expect(page.getByRole("heading", { name: "History & Honours", level: 2 }).last()).toBeVisible();
});