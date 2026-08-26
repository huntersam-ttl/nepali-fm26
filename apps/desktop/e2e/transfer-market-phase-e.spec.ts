import { expect, test, type Page } from "@playwright/test";

const openCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/ }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Starting club").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Transfers", exact: true })).toBeVisible({
    timeout: 120_000,
  });
};

test("runs a realistic transfer enquiry through offer construction and persisted history", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openCareer(page, `Phase E transfer ${Date.now()}`);
  await page.getByRole("button", { name: "Scouting", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recruitment search" })).toBeVisible();
  await page.getByRole("button", { name: "Shortlist" }).first().click();
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await expect(page.getByText("Transfer budget")).toBeVisible();
  await page.getByRole("button", { name: "targets", exact: true }).click();
  await expect(page.getByRole("button", { name: "Make offer" }).first()).toBeVisible();
  await page.getByLabel("Cash").fill("100000");
  await page.getByLabel("Installments").fill("50000");
  await page.getByLabel("Add-ons").fill("25000");
  await page.getByLabel("Sell-on %").fill("10");
  await page.getByLabel("Appearance trigger").fill("10");
  await page.getByLabel("Trigger amount").fill("15000");
  await page.getByRole("button", { name: "Make offer" }).first().click();
  await expect(page.locator(".workspace")).toContainText(
    /offer|negotiat|rejected|accepted|completed/i,
  );
  await page.getByRole("button", { name: "offers", exact: true }).click();
  await expect(page.locator(".workspace")).toContainText(
    /History|direct player contact|Agent contact/,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Career saved.");
});
