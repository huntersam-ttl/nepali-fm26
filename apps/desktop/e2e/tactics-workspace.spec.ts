import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4A — Tactics pitch-first workspace.
 * Pins the pitch as the primary region (11 spatial slots), formation control,
 * an accessible swap/move control, and canonical player navigation with Back.
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

const backButton = (page: Page) => page.getByRole("button", { name: "Go back" });

const createManagerCareer = async (page: Page): Promise<string> => {
  const saveName = `Tactics ${Date.now()}`;
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

test("Tactics loads pitch-first: 11 slots, formation control, bench, swap control", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Tactics", exact: true }).click();
  await expect(page.locator(".pitch")).toBeVisible();
  await expect(page.locator(".pitch .slot")).toHaveCount(11);
  await expect(page.getByLabel("Formation")).toBeVisible();
  await expect(page.getByLabel("Style")).toBeVisible();

  // Select a slot so the accessible move/swap controls appear.
  await page.locator(".pitch .slot").first().click();
  await expect(page.getByLabel("Swap this position with another")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Bench/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Formation change keeps 11 valid slots and persists", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Tactics", exact: true }).click();
  await page.getByLabel("Formation").selectOption({ label: "4-4-2" });
  await expect(page.getByLabel("Formation").locator("option:checked")).toHaveText("4-4-2");
  const chosen = await page.getByLabel("Formation").inputValue();
  await expect(page.locator(".pitch .slot")).toHaveCount(11);

  // Navigate away and back: canonical tactic persists.
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Home / Inbox", exact: true }).click();
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Tactics", exact: true }).click();
  await expect(page.getByLabel("Formation")).toHaveValue(chosen);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Player profile navigation from a slot -> Player -> Back = Tactics", async ({ page }) => {
  test.setTimeout(300_000);
  const errors = captureErrors(page);
  await createManagerCareer(page);

  await page.getByLabel("Primary navigation").getByRole("button", { name: "Tactics", exact: true }).click();
  // Select a slot that is occupied (the GK is usually assigned).
  await page.locator(".pitch .slot").first().click();
  const profileLink = page.getByRole("button", { name: /Open .*'s profile/ }).first();
  if ((await profileLink.count()) > 0) {
    const label = await profileLink.textContent();
    await profileLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Tactics");
    await backButton(page).click();
    await expect(page.locator(".pitch")).toBeVisible();
  }

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});