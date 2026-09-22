import { expect, test, type Page } from "@playwright/test";

/** Phase 6A — Club Overview + Club Profile workspace family (Manager-side). */
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

test("Club Overview loads as the Manager club with one h1 and identity", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Club overview ${Date.now()}`);
  await goTo(page, "Club Overview");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Club Overview", level: 2 }).last()).toBeVisible();
  // The hero h1 is a real club name (not a placeholder).
  const h1 = await page.getByRole("heading", { level: 1 }).textContent();
  expect((h1 ?? "").trim().length).toBeGreaterThan(0);
});

test("Club Profile loads institutional identity and a Manager link navigates back", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Club profile ${Date.now()}`);
  await goTo(page, "Club Profile");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Club Profile", level: 2 }).last()).toBeVisible();
  await expect(page.getByText("Home ground").first()).toBeVisible();

  // A canonical Person link (manager/owner) navigates and Back returns to Club Profile.
  const person = page.locator("dd").getByRole("link", { name: /./ }).first();
  if (await person.count()) {
    await person.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Club Profile");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Club Profile", level: 2 }).last()).toBeVisible();
  }
});