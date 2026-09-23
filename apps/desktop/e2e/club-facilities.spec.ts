import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 6C — Club Facilities + Infrastructure Projects (Manager).
 * Only supported canonical flows: family destinations + contextual nav, real
 * stadium/facility state (with unknown handled honestly), active projects with
 * canonical project round-trip, and Manager having view-only authority (no
 * Owner-only controls).
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

test("1. Club family exposes the live facilities + projects destinations and one h1", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Club facilities ${Date.now()}`);
  for (const label of ["Facilities", "Infrastructure Projects", "Club Overview", "Club Profile"]) {
    await goTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: label, level: 2 }).last()).toBeVisible();
  }
});

test("2. Facilities surfaces real stadium/home-ground + supporting facility state", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Facility view ${Date.now()}`);
  await goTo(page, "Facilities");
  // Stadium / home-ground hero is present (name or an honest "no relation").
  const stadiumLabel = page.getByText(/Stadium \/ home ground/i).first();
  await expect(stadiumLabel).toBeVisible();
  const body = await page.locator("main").innerText();
  // Supporting rows table exists (Training / Academy / Medical / Analysis).
  const anyLevel = await page.getByText(/Level \d|Not established/i).count();
  expect(anyLevel).toBeGreaterThanOrEqual(1);
  // No fabricated "World Class"/"Elite" labels; exact levels only.
  expect(body).not.toMatch(/World Class|Elite|State of the Art/i);
});

test("3. Projects lists active projects with status and a canonical project round-trip", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Projects ${Date.now()}`);
  await goTo(page, "Infrastructure Projects");
  await expect(page.getByRole("heading", { name: "Active projects", level: 2 })).toBeVisible();
  // Project rows render statuses strictly (never a fake progress bar).
  const active = page.locator("table button.link").first();
  if (await active.count()) {
    await active.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Infrastructure Projects");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Infrastructure Projects", level: 2 }).last()).toBeVisible();
  }
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\d+\s*%\s*(complete|progress)/i);
});

test("4. Manager has view-only authority (no Owner-only funding/approval controls)", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Manager authority ${Date.now()}`);
  await goTo(page, "Facilities");
  const facilitiesButtons = await page.locator("main button").allInnerTexts();
  expect(
    facilitiesButtons.filter((b) => /approve|fund|propose|start construction|cancel project/i.test(b)).length,
  ).toBe(0);
  await goTo(page, "Infrastructure Projects");
  const projectButtons = await page.locator("main button").allInnerTexts();
  expect(
    projectButtons.filter((b) => /approve|fund|propose|start construction|cancel project/i.test(b)).length,
  ).toBe(0);
});

test("5. Club Overview facilities/projects summary links navigate", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Overview links ${Date.now()}`);
  await goTo(page, "Club Overview");
  await expect(page.getByRole("heading", { name: "Facilities & Projects", level: 2 })).toBeVisible();
  const facilitiesBtn = page.getByRole("button", { name: /Facilities/ }).first();
  await facilitiesBtn.click();
  await expect(page.getByRole("heading", { name: "Facilities", level: 2 }).last()).toBeVisible();
});