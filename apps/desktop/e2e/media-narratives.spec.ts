import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 7C — persistent narratives + journalist relationship context.
 * Only supported canonical flows: thread presentation (or honest one-off),
 * journalist prior-interaction context (never a trust number), and no invented
 * reputation meter.
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

test("1. Newsroom shows story threads (or an honest one-off state)", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Threads ${Date.now()}`);
  await goTo(page, "Newsroom");
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  // Wait for the media feed to resolve: either a populated Newsroom (with the
  // Story threads panel) or the honest empty-feed state.
  await expect(page.locator("main").getByText(/story threads|no published stories/i).first()).toBeVisible();
  const threadsHeading = page.getByRole("heading", { name: "Story threads", level: 2 });
  if (await threadsHeading.count()) {
    const track = page.getByText(/no ongoing story threads/i).first();
    if (await track.count()) {
      await expect(track).toBeVisible();
    } else {
      // A real thread is present: show status, report count and at least one entity.
      const body = await page.locator("main").innerText();
      expect(body).toMatch(/reports?/i);
      expect(body).toMatch(/active|waiting|resolved/i);
    }
  }
});

test("2. Journalists show prior-interaction context and never a trust number", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Journalists ${Date.now()}`);
  await goTo(page, "Journalists");
  await expect(page.getByRole("heading", { name: "Journalists", level: 2 }).last()).toBeVisible();
  // Wait for the directory to resolve: either a populated table (with the
  // "Prior interactions" column) or the honest empty state.
  await expect(page.locator("main").getByText(/(prior interactions|no journalists are on record)/i).first()).toBeVisible();
  if (await page.getByText(/prior interactions/i).count()) {
    const columns = await page.locator("thead th").allInnerTexts();
    expect(columns.join(" ")).toMatch(/prior interactions/i);
  } else {
    await expect(page.getByText(/no journalists are on record/i).first()).toBeVisible();
  }
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/trust|temperament|hostility|agenda/i);
});

test("3. no invented reputation meter appears on Media surfaces", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Reputation ${Date.now()}`);
  await goTo(page, "Newsroom");
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  const newsroom = await page.locator("main").innerText();
  expect(newsroom).not.toMatch(/reputation score|media reputation\/100|fame/i);
  await goTo(page, "Journalists");
  await expect(page.getByRole("heading", { name: "Journalists", level: 2 }).last()).toBeVisible();
  const journalists = await page.locator("main").innerText();
  expect(journalists).not.toMatch(/reputation score|media reputation\/100|fame/i);
});

test("4. a thread's referenced entity navigates canonically; Back returns", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Thread link ${Date.now()}`);
  await goTo(page, "Newsroom");
  const entityLink = page.locator("main").locator("button.link").first();
  if (await entityLink.count()) {
    await entityLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Newsroom");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  }
});