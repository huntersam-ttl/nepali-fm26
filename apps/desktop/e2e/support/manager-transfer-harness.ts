import { expect, type Page } from "@playwright/test";

/**
 * Creates a fresh Manager career and seeds the off-pitch decision-
 * presentation E2E fixture (a real, still-open incoming negotiation and a
 * real, completed MAJOR incoming transfer) via the canonical manager
 * transfer-offer engine code — see
 * DesktopApplicationService.seedE2EDecisionPresentationFixture. Returns the
 * two offer ids and the signing offer's real persisted status so specs
 * assert on what actually happened rather than assuming success.
 */
export const seedManagerDecisionPresentationFixture = async (
  page: Page,
): Promise<{ negotiationOfferId: string; signingOfferId: string; signingOfferStatus: string }> => {
  const saveName = `Browser Decision Presentation ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("tab", { name: "A Division" }).click();
  const club = page.getByRole("button", { name: /A Division/ }).first();
  await expect(club).toBeVisible();
  await club.click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: 120_000 });

  const fixture = await page.request.post("/runtime/command/seedE2EDecisionPresentationFixture", { data: {} });
  expect(fixture.ok()).toBeTruthy();
  const body = await fixture.json();
  expect(body.ok, JSON.stringify(body)).toBeTruthy();
  return body.data as { negotiationOfferId: string; signingOfferId: string; signingOfferStatus: string };
};
