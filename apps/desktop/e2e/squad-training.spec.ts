import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 3B — Training + Development (additive to the Squad family).
 *
 * Pins: Training is a Squad-family destination reached via the contextual nav
 * with a weekly-planner view; Squad Overview links to Training; and no
 * fabricated U16/U18/U21 youth structure appears (youth is deferred truthfully:
 * no canonical youth-squad read model is exposed).
 *
 * Declares no per-spec base URL, so NEPAL_E2E_BASE_URL selects the server.
 */

const captureErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

const squadNav = (page: Page) => page.locator('nav[aria-label="Workspace sections"]');
const squadItem = (page: Page, name: string) => squadNav(page).getByRole("button", { name, exact: true });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Train ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill("Maya Adhikari");
  await page.getByLabel("Display name").fill("Maya");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const clubPicker = page.getByLabel("Starting club");
  await expect(clubPicker).toBeVisible();
  const clubName = ((await clubPicker.locator("button.club-row strong").first().textContent()) ?? "").trim();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 240_000 });
  return clubName;
};

test("Squad -> Training: contextual nav, weekly planner, no giant form", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await squadItem(page, "Training").click();
  await expect(page.locator(".page-header h2")).toHaveText("Training");
  await expect(squadItem(page, "Training")).toHaveAttribute("aria-current", "true");

  // Weekly planner present (real sessions grid + readiness).
  await expect(page.locator(".training-week")).toBeVisible();
  await expect(page.getByLabel("Overall intensity")).toBeVisible();

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Squad Overview links to Training, and Back preserves the family", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await squadItem(page, "Overview").click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad Overview");
  await page.locator(".squad-overview button").filter({ hasText: "Training" }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Training");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page.locator(".page-header h2")).toHaveText("Squad Overview");

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("No fabricated youth structure: no U16/U18/U21 destination", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Squad", exact: true }).click();
  await expect(squadNav(page)).toBeVisible();
  expect(await squadNav(page).getByRole("button").count()).toBe(3); // Overview | First Team | Training
  await expect(squadNav(page).getByRole("button", { name: /Youth|U16|U18|U21|Academy|Reserve/i })).toHaveCount(0);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});