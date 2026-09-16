import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

// createExistingClubOwner needs NEPAL_E2E_ROLE_FIXTURE=1, which the shared
// ambient dev server other specs' reuseExistingServer may already be
// pointed at is not guaranteed to have. Point only this file at an
// isolated instance the runner starts separately with that flag, same
// pattern as nav-responsive.spec.ts.
if (process.env.NEPAL_PORTRAIT_E2E_BASE_URL) {
  test.use({ baseURL: process.env.NEPAL_PORTRAIT_E2E_BASE_URL });
}

/**
 * Automates what every visual-identity phase up to now has verified
 * manually: (1) a player's portrait is deterministic — stable across
 * navigation and a real save/reload, distinct between two different
 * players — and (2) the same human career person keeps the exact same
 * face across Manager -> Chairman/Owner -> Federation President ->
 * Manager, even though attire/context changes per role.
 *
 * Compares `data-face-signature` (PersonPortrait.tsx — a hash of
 * personId, never the raw id itself) rather than screenshots, so
 * legitimate attire/context differences across roles don't produce a
 * false failure the way a full-portrait pixel diff would.
 */

const faceSignature = async (page: Page, selector: string): Promise<string> => {
  const svg = page.locator(selector).first();
  await expect(svg).toBeVisible();
  const signature = await svg.getAttribute("data-face-signature");
  expect(signature, `${selector} should carry a data-face-signature`).not.toBeNull();
  return signature!;
};

test("Player A and B portraits are deterministic, distinct, and survive a reload", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const saveName = await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("MANAGER");
  await page.getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(2);
  const nameA = (await rows.nth(0).locator("td").first().innerText()).trim();
  const nameB = (await rows.nth(1).locator("td").first().innerText()).trim();
  expect(nameA).not.toBe(nameB);

  // Squad row's own (decorative) portrait vs. Player Profile's (named)
  // portrait must be the exact same face for the same player.
  const squadSignatureA = await faceSignature(page, "table tbody tr:nth-child(1) svg.person-portrait");

  await rows.nth(0).click();
  await expect(page.getByRole("heading", { name: nameA })).toBeVisible();
  const profileSignatureA = await faceSignature(page, ".player-card-avatar svg.person-portrait");
  expect(profileSignatureA).toBe(squadSignatureA);

  await page.getByRole("button", { name: "Back to squad" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await rows.nth(1).click();
  await expect(page.getByRole("heading", { name: nameB })).toBeVisible();
  const profileSignatureB = await faceSignature(page, ".player-card-avatar svg.person-portrait");
  expect(profileSignatureB, "two different players must not share a face").not.toBe(profileSignatureA);

  // Reload the whole app and the save — Player A's face must be
  // byte-identical to what it was before, not re-rolled.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await page.getByRole("button", { name: "Squad", exact: true }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.locator("table tbody tr").nth(0).click();
  await expect(page.getByRole("heading", { name: nameA })).toBeVisible();
  const reloadedSignatureA = await faceSignature(page, ".player-card-avatar svg.person-portrait");
  expect(reloadedSignatureA).toBe(profileSignatureA);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("the same human career person keeps the same portrait face across Manager -> Owner -> President -> Manager", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await createExistingClubOwner(page, "A");
  // createExistingClubOwner already lands on CHAIRMAN_OWNER with the
  // E2E role fixture applied (grants CHAIRMAN_OWNER + FEDERATION_PRESIDENT
  // on the same career person).
  const topbarPortrait = ".identity svg.person-portrait";

  const asOwner = await faceSignature(page, topbarPortrait);

  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  const asPresident = await faceSignature(page, topbarPortrait);
  expect(asPresident, "Owner -> President must keep the same face").toBe(asOwner);

  await page.getByLabel("Active career role").selectOption("MANAGER");
  const asManager = await faceSignature(page, topbarPortrait);
  expect(asManager, "President -> Manager must keep the same face").toBe(asOwner);

  await page.getByLabel("Active career role").selectOption("CHAIRMAN_OWNER");
  const backToOwner = await faceSignature(page, topbarPortrait);
  expect(backToOwner, "Manager -> Owner must keep the same face").toBe(asOwner);

  expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
});
