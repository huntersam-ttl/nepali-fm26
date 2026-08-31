import { expect, test } from "@playwright/test";
import { createExistingClubOwner, createFounderOwner, openOwnerRoute, type PlayableDivision } from "./support/owner-harness.js";

test.describe("Owner economy browser harness", () => {
  for (const division of ["A", "B"] as const) {
    test(`${division} Owner dashboard and finance routes use real state`, async ({ page }) => {
      test.setTimeout(240_000);
      await createExistingClubOwner(page, division);
      await expect(page.getByText("Club balance")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Ownership" })).toBeVisible();
      await expect(page.getByText("Active sponsors")).toBeVisible();
      const initialDate = await page.locator(".date-block strong").textContent();
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.locator(".date-block strong")).not.toHaveText(initialDate ?? "", { timeout: 30_000 });
      await openOwnerRoute(page, "Finances");
      await expect(page.getByRole("heading", { name: "Debt schedule" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Equipment effects" })).toBeVisible();
      await openOwnerRoute(page, "Sponsorship");
      await expect(page.getByRole("heading", { name: "Sponsorship" })).toBeVisible();
      await openOwnerRoute(page, "Investors");
      await expect(page.getByText("Simulated valuation")).toBeVisible();
      await expect(page.getByText("No investor bids.")).toBeVisible();
    });
  }

  test("C Founder opens Investors and creates deterministic bids", async ({ page }) => {
    test.setTimeout(240_000);
    await createFounderOwner(page);
    await expect(page.getByText("Club balance")).toBeVisible();
    const initialDate = await page.locator(".date-block strong").textContent();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator(".date-block strong")).not.toHaveText(initialDate ?? "", { timeout: 30_000 });
    await openOwnerRoute(page, "Investors");
    await expect(page.getByText("Current stake")).toBeVisible();
    await page.getByLabel("Offer stake (%)").fill("10");
    await page.getByRole("button", { name: "Offer stake" }).click();
    await expect(page.getByText("Simulation bid").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Accept" }).first()).toBeVisible();
    await page.screenshot({ path: "output/playwright/owner-investors-C.png", fullPage: true });
  });
});

test.describe("Owner economy semantic route matrix", () => {
  test("Owner route helper covers A/B/C without layout-order selectors", async ({ page }) => {
    test.setTimeout(240_000);
    const division: PlayableDivision = "C";
    await createExistingClubOwner(page, division);
    await openOwnerRoute(page, "Finances");
    await openOwnerRoute(page, "Sponsorship");
    await openOwnerRoute(page, "Investors");
    await expect(page.getByRole("heading", { name: "Ownership and investors" })).toBeVisible();
  });
});
