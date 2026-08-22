import { expect, test } from "@playwright/test";

test("creates, simulates, reloads and loads a persisted manager career", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole("button", { name: /New Career/ }).click();
  await page.getByLabel("Save name").fill("E2E Manager Save");
  await page.getByLabel("Full name").fill("Maya Adhikari");
  await page.getByLabel("Display name").fill("Maya");
  await page.getByLabel("Starting age").fill("33");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();

  await expect(page.getByText("Kathmandu Testing Club").first()).toBeVisible();
  await page.getByRole("button", { name: "Squad" }).click();
  await expect(page.getByRole("cell", { name: "Kiran Kathmandu" })).toBeVisible();

  await page.getByRole("button", { name: "Tactics" }).click();
  await page.getByLabel("Tactic name").fill("E2E Saved Tactic");
  await page.getByRole("button", { name: "Save Tactic" }).click();
  await expect(page.locator('input[value="E2E Saved Tactic"]')).toBeVisible();

  await page.getByRole("button", { name: "Fixtures" }).click();
  await expect(page.getByRole("cell", { name: "Lalitpur Test XI" })).toBeVisible();
  await page.getByRole("button", { name: "Quick Sim" }).click();
  await expect(page.getByText("Previous Result")).toBeVisible();
  await expect(page.getByText(/Match result/).first()).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /Load Career/ }).click();
  await page.getByRole("button", { name: /E2E Manager Save/ }).click();
  await expect(page.getByText("E2E Saved Tactic")).toBeVisible();
  await page.getByRole("button", { name: "Fixtures" }).click();
  await expect(page.getByText("played")).toBeVisible();

  await page.getByRole("button", { name: "Home / Inbox" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("2026-08-10").or(page.getByText("2026-08-03"))).toBeVisible();
});
