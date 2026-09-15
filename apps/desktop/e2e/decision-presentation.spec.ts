import { expect, test, type Page } from "@playwright/test";
import { seedManagerDecisionPresentationFixture } from "./support/manager-transfer-harness.js";

/**
 * Deterministic real-browser proof for the transfer-negotiation and
 * completed-signing presentation, built on seedE2EDecisionPresentationFixture
 * rather than relying on AI negotiation timing or a shared ambient save —
 * see Phase 6D of the off-pitch decision-presentation work. Isolates
 * whether the 3D canvas genuinely mounts for these contexts (a manual check
 * against a shared, ambient dev server previously left this unresolved).
 *
 * Rows are matched by their STATUS cell specifically (anchored exact text),
 * not by row order or whole-row text: both offers' collapsed history
 * sections mention "Submitted" (every offer, including the completed one,
 * was submitted at some point), which makes whole-row or order-based
 * matching unreliable.
 */
const openOffersTab = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Transfers", exact: true }).click();
  await page.getByRole("button", { name: "offers", exact: true }).click();
};

// Scoped to the STAGE cell specifically (negotiationStage's real,
// case-preserved label, not the lower-cased STATUS badge next to it, and
// not anchored since the STAGE cell also carries a trailing "Response
// expected in N days" line). Both rows' collapsed history sections mention
// "Submitted" as a past round label, and the STATUS cell text is
// lower-cased ("submitted"/"completed"), so neither makes a reliable
// case-sensitive anchor; the capitalised STAGE label is unique per row.
const negotiationRow = (page: Page) =>
  page
    .getByRole("table")
    .first()
    .locator("tbody tr")
    .filter({ has: page.locator("td", { hasText: /Awaiting club response/ }) });
const signingRow = (page: Page) =>
  page
    .getByRole("table")
    .first()
    .locator("tbody tr")
    .filter({ has: page.locator("td", { hasText: /^Completed/ }) });

test.describe("Transfer negotiation and signing presentation", () => {
  test("negotiation scene renders with real state, camera presets move it, the canonical withdraw action works, zero console errors", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await seedManagerDecisionPresentationFixture(page);
    await openOffersTab(page);
    await negotiationRow(page).getByRole("button", { name: "Open negotiation" }).click();

    const region = page.getByRole("region", { name: /negotiation$/i });
    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
    const firstFrame = await canvas.screenshot();
    expect(firstFrame.byteLength).toBeGreaterThan(2_000);

    // Real state, not placeholder text.
    await expect(page.getByText(/Fee NPR/)).toBeVisible();
    await expect(page.getByText(/Transfer budget remaining/)).toBeVisible();

    // Camera presets: real buttons, aria-pressed, actually move the camera.
    const cameras = region.getByRole("group", { name: "Camera view" });
    const room = cameras.getByRole("button", { name: "Room" });
    const table = cameras.getByRole("button", { name: "Table" });
    await expect(room).toHaveAttribute("aria-pressed", "true");
    await table.click();
    await expect(table).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(300);
    const secondFrame = await canvas.screenshot();
    expect(Buffer.compare(firstFrame, secondFrame)).not.toBe(0);

    // The canonical, real manager action — not a scene-driven action.
    await page.getByRole("button", { name: "Withdraw offer" }).click();
    // Several badges legitimately show "Withdrawn" at once (the table row,
    // the deal summary, the outcome history) — any one proves the real
    // canonical action took effect.
    await expect(page.getByText("Withdrawn").first()).toBeVisible();

    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("a qualifying completed transfer shows a read-only signing scene, visibly distinct from the negotiation room, with no negotiation controls", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    const fixture = await seedManagerDecisionPresentationFixture(page);
    expect(fixture.signingOfferStatus, "seeded signing offer must actually complete").toBe("COMPLETED");

    await openOffersTab(page);
    await signingRow(page).getByRole("button", { name: "Open negotiation" }).click();

    const region = page.getByRole("region", { name: /signing$/i });
    const canvas = region.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    const signingFrame = await canvas.screenshot();
    expect(signingFrame.byteLength).toBeGreaterThan(2_000);

    // Real completed state, not a negotiation in progress.
    await expect(page.getByText(/The transfer is complete\./)).toBeVisible();
    // Read-only: no negotiation actions remain on a COMPLETED offer.
    await expect(page.getByRole("button", { name: "Withdraw offer" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Counter/ })).toHaveCount(0);

    // Visibly distinct from the plain negotiation room, not a relabel.
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await openOffersTab(page);
    await negotiationRow(page).getByRole("button", { name: "Open negotiation" }).click();
    const negotiationRegion = page.getByRole("region", { name: /negotiation$/i });
    const negotiationCanvas = negotiationRegion.locator("canvas");
    await expect(negotiationCanvas).toBeVisible({ timeout: 15_000 });
    const negotiationFrame = await negotiationCanvas.screenshot();
    expect(Buffer.compare(signingFrame, negotiationFrame)).not.toBe(0);

    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("3D OFF: negotiation and signing both remain fully usable with no canvas mounted", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "nepal.presentation.preferences.v1",
        JSON.stringify({ enabled3d: false, quality: "MEDIUM", motion: "FULL" }),
      );
    });
    const fixture = await seedManagerDecisionPresentationFixture(page);
    expect(fixture.signingOfferStatus).toBe("COMPLETED");

    await openOffersTab(page);
    await negotiationRow(page).getByRole("button", { name: "Open negotiation" }).click();
    await expect(page.getByRole("region", { name: /negotiation$/i })).toHaveCount(0);
    await expect(page.getByText(/Fee NPR/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw offer" })).toBeVisible();

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await openOffersTab(page);
    await signingRow(page).getByRole("button", { name: "Open negotiation" }).click();
    await expect(page.getByRole("region", { name: /signing$/i })).toHaveCount(0);
    await expect(page.getByText(/The transfer is complete\./)).toBeVisible();
  });
});
