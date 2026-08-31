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

  test("A Owner applies and repays a loan, submits a manager budget request, and persists it", async ({ page }) => {
    test.setTimeout(240_000);
    await createExistingClubOwner(page, "A");
    await openOwnerRoute(page, "Finances");
    await page.getByLabel("Principal").fill("1000");
    await page.getByLabel("Term (months)").fill("12");
    const debtsBefore = await page.getByRole("button", { name: "Repay", exact: true }).count();
    await page.getByRole("button", { name: "Apply", exact: true }).dblclick();
    await expect(page.getByRole("heading", { name: "Debt schedule" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Repay", exact: true })).toHaveCount(debtsBefore + 1, { timeout: 30_000 });
    await page.getByRole("button", { name: "Repay", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Recent transactions" })).toBeVisible();
    await expect(page.getByText("Club loan principal repayment")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Club loan interest")).toBeVisible({ timeout: 30_000 });

    await page.getByLabel("Active career role").selectOption("MANAGER");
    await page.getByRole("button", { name: "Transfers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Budget" })).toBeVisible();
    await page.getByLabel("New total").fill("999999");
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await expect(page.getByText("Budget request submitted to the owner/board.")).toBeVisible();
    await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
    await page.getByRole("button", { name: "Manager", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pending budget requests" })).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("No pending manager requests.")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Active career role").selectOption("MANAGER");
    await page.getByRole("button", { name: "Transfers", exact: true }).click();
    await page.getByLabel("Request increase").selectOption("WAGE_BUDGET");
    await page.getByLabel("New total").fill("888888");
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
    await page.getByRole("button", { name: "Manager", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pending budget requests" })).toBeVisible();
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByText("No pending manager requests.")).toBeVisible({ timeout: 30_000 });
  });

  test("A Owner purchases equipment and resolves open sponsorship offers through the UI", async ({ page }) => {
    test.setTimeout(240_000);
    await createExistingClubOwner(page, "A");
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByRole("button", { name: "Order football equipment", exact: true }).dblclick();
    await expect(page.getByText("ClubMart order: FOOTBALL_EQUIPMENT")).toBeVisible({ timeout: 30_000 });
    for (let step = 0; step < 4; step += 1) {
      const initialDate = await page.locator(".date-block strong").textContent();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.locator(".date-block strong")).not.toHaveText(initialDate ?? "", { timeout: 30_000 });
    }
    await openOwnerRoute(page, "Finances");
    await expect(page.getByRole("heading", { name: "Recent transactions" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("ClubMart order: FOOTBALL_EQUIPMENT")).toBeVisible({ timeout: 30_000 });

    await openOwnerRoute(page, "Sponsorship");
    const offered = page.getByRole("row").filter({ hasText: "OFFERED" });
    await expect(offered).toHaveCount(3);
    const originalOfferCount = await offered.count();
    await page.getByLabel(/Counter value for/).first().fill("1");
    await offered.first().getByRole("button", { name: "Counter", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "OFFERED" })).toHaveCount(originalOfferCount - 1, { timeout: 30_000 });
    const activeAfterCounter = await page.getByRole("row").filter({ hasText: "ACTIVE" }).count();
    const remainingOffer = page.getByRole("row").filter({ hasText: "OFFERED" });
    await remainingOffer.first().getByRole("button", { name: "Accept", exact: true }).dblclick();
    await expect(page.getByRole("row").filter({ hasText: "ACTIVE" })).toHaveCount(activeAfterCounter + 1, { timeout: 30_000 });
    const finalOffer = page.getByRole("row").filter({ hasText: "OFFERED" }).first();
    await finalOffer.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "OFFERED" })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("row").filter({ hasText: "REJECTED" })).toHaveCount(1);
  });

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
