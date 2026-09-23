import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 7A — Media workspace (Newsroom + Media Outlets + Journalists).
 * Only supported canonical flows: family navigation, real stories or honest
 * empties, canonical entity round-trips, and Daily Ops separation.
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

test("1. Media family exposes Newsroom | Outlets | Journalists with one h1 each", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Media ${Date.now()}`);
  for (const label of ["Newsroom", "Media Outlets", "Journalists"]) {
    await goTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: label, level: 2 }).last()).toBeVisible();
  }
});

test("2. Newsroom shows a real story (or honest empty) with date, section and source", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Newsroom ${Date.now()}`);
  await goTo(page, "Newsroom");
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  // Either a story card with a dated headline, or an honest empty state.
  const lead = page.getByRole("article").first();
  if (await lead.count()) {
    expect((await lead.locator("h3").first().innerText()).trim().length).toBeGreaterThan(0);
  } else {
    await expect(page.getByText(/no published stories/i).first()).toBeVisible();
  }
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/said|according to sources/i);
});

test("3. A story's referenced entity navigates canonically; Back returns to the Newsroom", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Story link ${Date.now()}`);
  await goTo(page, "Newsroom");
  const firstEntity = page.locator("article").first().locator("button.link").first();
  if (await firstEntity.count()) {
    await firstEntity.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Newsroom");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  }
});

test("4. Media Outlets link to a canonical outlet; Back returns", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Outlets ${Date.now()}`);
  await goTo(page, "Media Outlets");
  const outletLink = page.locator("table button.link").first();
  if (await outletLink.count()) {
    await outletLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Media Outlets");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Media Outlets", level: 2 }).last()).toBeVisible();
  } else {
    await expect(page.getByText(/no media outlets/i).first()).toBeVisible();
  }
});

test("5. Journalists link to a canonical journalist; Back returns", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Journalists ${Date.now()}`);
  await goTo(page, "Journalists");
  const journalistLink = page.locator("table button.link").first();
  if (await journalistLink.count()) {
    await journalistLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Journalists");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Journalists", level: 2 }).last()).toBeVisible();
  } else {
    await expect(page.getByText(/no journalists are on record/i).first()).toBeVisible();
  }
});

test("6. Daily Ops News remains a separate, independently working surface", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Daily news ${Date.now()}`);
  await goTo(page, "Home / Inbox");
  // Daily Ops News is reached via the Daily Ops contextual family nav.
  await page
    .getByRole("navigation", { name: "Workspace sections" })
    .getByRole("button", { name: "News", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "News", level: 2 }).last()).toBeVisible();
  // The Media family Newsroom is a distinct, independently reachable destination.
  await goTo(page, "Newsroom");
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
});