import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 7D — Media closure + public reaction. Only supported canonical flows:
 * the final Media family, per-story canonical public reaction (or honest one-off),
 * no fake social vanity metrics, and the Club Supporters boundary.
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

const FINAL_MEDIA = ["Newsroom", "Media Outlets", "Journalists", "Press Requests"];

test("1. final Media family exposes only the supported destinations, one h1 each", async ({ page }) => {
  test.setTimeout(800_000);
  await createCareer(page, `Media closure ${Date.now()}`);
  for (const label of FINAL_MEDIA) {
    await goTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: label, level: 2 }).last()).toBeVisible();
  }
});

test("2. Newsroom reflects canonical per-story public reaction (no fake social)", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Reaction ${Date.now()}`);
  await goTo(page, "Newsroom");
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  // Wait for the feed to resolve: either story cards (with reaction) or the empty feed.
  await expect(page.locator("main").getByText(/simulated reaction|no published stories/i).first()).toBeVisible();
  const body = await page.locator("main").innerText();
  // Reaction is a structured summary, never a fake social network concept.
  expect(body).not.toMatch(/likes?|shares?|followers?|reposts?|trending|hashtag|verified|avatar/i);
});

test("3. no fake social vanity metrics on any final Media screen", async ({ page }) => {
  test.setTimeout(800_000);
  await createCareer(page, `No social ${Date.now()}`);
  for (const label of FINAL_MEDIA) {
    await goTo(page, label);
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/likes?|shares?|reposts?|followers?|trending|hashtag|verified/i);
  }
});

test("4. Media reaction stays distinct from the Club Supporters workspace", async ({ page }) => {
  test.setTimeout(700_000);
  await createCareer(page, `Boundary ${Date.now()}`);
  await goTo(page, "Newsroom");
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
  await expect(page.locator("main").getByText(/no published stories|story threads|simulated reaction/i).first()).toBeVisible();
  // Navigate to the institutional Club Supporters surface (a different screen).
  await goTo(page, "Supporters");
  await expect(page.getByRole("heading", { name: "Supporters", level: 2 }).last()).toBeVisible();
  // The Newsroom stays reachable and Back returns to it.
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("heading", { name: "Newsroom", level: 2 }).last()).toBeVisible();
});