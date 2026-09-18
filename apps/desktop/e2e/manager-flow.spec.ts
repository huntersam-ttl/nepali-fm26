import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Runs against the real Vite dev shell, which spawns the same Node runtime the
 * Tauri sidecar uses. Every assertion below is therefore backed by a real
 * SQLite save file, not browser storage.
 */
const savesDirectory = process.env.NEPAL_SAVES_DIR!;

const saveFiles = (): string[] =>
  readdirSync(savesDirectory).filter((file) => file.endsWith(".sqlite"));

test("creates, advances, reopens and deletes a real SQLite manager career", async ({ page }) => {
  const saveName = `E2E Career ${Date.now()}`;
  const before = saveFiles().length;

  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();

  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill("Maya Adhikari");
  await page.getByLabel("Display name").fill("Maya");
  await page.getByLabel("Starting age").fill("33");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Real Nepal clubs come from the imported world, not a hardcoded list.
  // The picker is a role="group" of club buttons, not a <select>, so the club's
  // own name is the button's <strong> rather than an <option>'s text.
  const clubPicker = page.getByLabel("Starting club");
  await expect(clubPicker).toBeVisible();
  const clubName = ((await clubPicker.locator("button.club-row strong").first().textContent()) ?? "").trim();
  expect(clubName).not.toMatch(/Testing|Sample|Demo/);
  expect(clubName.length, "a real club name should be offered").toBeGreaterThan(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();

  // Wait for the career shell, not for the club name: the Confirmation step
  // already reads "Join <club> as manager…", so getByText(clubName) matches
  // while the save is still being written and the file count below runs early.
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({
    timeout: 240_000,
  });
  await expect(page.getByText(clubName).first()).toBeVisible();
  expect(saveFiles().length).toBe(before + 1);

  await page.getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();

  // Tactics persist on change in the Step 3 UI; the style is the cheapest
  // durable edit to make here. Full tactical coverage lives in
  // manager-gameplay.spec.ts.
  await page.getByRole("button", { name: "Tactics" }).click();
  await page.getByLabel("Style").selectOption("HIGH_PRESS");
  await expect(page.getByLabel("Style")).toHaveValue("HIGH_PRESS");

  await page.getByRole("button", { name: "Home / Inbox" }).click();
  const startDate = await page.locator(".topbar strong").nth(1).textContent();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".topbar strong").nth(1)).not.toHaveText(startDate ?? "", {
    timeout: 30_000,
  });
  const advancedDate = await page.locator(".topbar strong").nth(1).textContent();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();

  // Full reload: nothing survives in the page, only in the save file.
  await page.reload();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();

  await expect(page.locator(".topbar strong").nth(1)).toHaveText(advancedDate ?? "", {
    timeout: 30_000,
  });
  await expect(page.getByText(clubName).first()).toBeVisible();
  await page.getByRole("button", { name: "Tactics" }).click();
  await expect(page.getByLabel("Style")).toHaveValue("HIGH_PRESS");

  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page
    .locator(".club-row-group", { hasText: saveName })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("button", { name: new RegExp(saveName) })).toHaveCount(0);
  expect(saveFiles().length).toBe(before);
});
