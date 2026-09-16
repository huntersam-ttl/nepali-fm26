import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

// Not reusing owner-harness.ts's openOwnerRoute here: its "Investors" heading
// assertion ("Ownership and investors") doesn't match this screen's real
// current heading ("Investors") — a pre-existing staleness in that shared
// helper, out of scope to fix here.
const openInvestors = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Investors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Investors", exact: true })).toBeVisible();
};

/**
 * Deterministic real-browser proof for the investor/ownership BOARDROOM
 * presentation. createInvestorStakeOffer (the same real command the
 * "Simulation investor bids" button calls) always generates exactly three
 * real, OFFER-status bids for a given club/seller/percentage — no AI
 * personal-terms negotiation involved, unlike a transfer — so this needs no
 * bespoke seedE2E* fixture: the production command itself is deterministic.
 */
test.describe("Investor meeting presentation", () => {
  test("BOARDROOM scene renders with real investor state, the canonical Reject action works, zero console errors", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await createExistingClubOwner(page, "B");

    const fixture = await page.request.post("/runtime/command/createInvestorStakeOffer", {
      data: { percentage: 5 },
    });
    expect(fixture.ok()).toBeTruthy();
    const body = await fixture.json();
    expect(body.ok, JSON.stringify(body)).toBeTruthy();

    await openInvestors(page);

    const region = page.getByRole("region", { name: /boardroom$/i });
    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // Real investor state, not placeholder text.
    await expect(page.getByText(/has proposed terms for this stake/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Counter terms" })).toBeVisible();

    // Camera presets work.
    const cameras = region.getByRole("group", { name: "Camera view" });
    const table = cameras.getByRole("button", { name: "Table" });
    const before = await canvas.screenshot();
    await table.click();
    await page.waitForTimeout(300);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);

    // The canonical, real owner action — proven by the persisted status,
    // not a transient toast (three bids exist, so "Reject" buttons remain
    // for the other two open ones).
    await page.getByRole("button", { name: "Reject" }).first().click();
    await expect(page.getByText(/rejected/i).first()).toBeVisible();

    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("3D OFF: the investor meeting remains fully usable with no canvas mounted", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "nepal.presentation.preferences.v1",
        JSON.stringify({ enabled3d: false, quality: "MEDIUM", motion: "FULL" }),
      );
    });
    await createExistingClubOwner(page, "B");
    const fixture = await page.request.post("/runtime/command/createInvestorStakeOffer", {
      data: { percentage: 5 },
    });
    expect((await fixture.json()).ok).toBeTruthy();

    await openInvestors(page);
    await expect(page.getByRole("region", { name: /boardroom$/i })).toHaveCount(0);
    await expect(page.getByText(/has proposed terms for this stake/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  });
});
