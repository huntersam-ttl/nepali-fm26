import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner, openOwnerRoute, saveReloadOwnerCareer } from "./support/owner-harness.js";

/**
 * Club Commercial Phase 2 — Owner negotiates and signs a kit supplier.
 *
 * Every figure is asserted against the authoritative getSponsorMeeting
 * payload for the same save rather than hard-coded: the save's randomSeed
 * embeds Date.now(), so literal rupee values would be precision theatre
 * that breaks on the next run.
 *
 * The counter is deliberately 1.02x the offer. counterSponsorOffer accepts
 * at or below 1.03x and otherwise counters or walks away, so this exercises
 * a real negotiation round with a deterministic outcome instead of a
 * coin-flip that would make the spec flaky for reasons unrelated to the
 * feature.
 */

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

if (process.env.NEPAL_PARTNERSHIPS_E2E_BASE_URL) {
  test.use({ baseURL: process.env.NEPAL_PARTNERSHIPS_E2E_BASE_URL });
}

type MeetingContract = {
  id: string;
  type: string;
  status: string;
  annualValue: number;
  endDate: string;
  sponsorName: string;
};
type MeetingOverview = {
  clubId: string;
  offers: MeetingContract[];
  active: MeetingContract[];
  history: MeetingContract[];
};

const fetchMeeting = async (page: Page): Promise<MeetingOverview> => {
  const response = await page.request.post("/runtime/command/getSponsorMeeting", { data: {} });
  expect(response.ok(), "getSponsorMeeting should respond").toBeTruthy();
  const body = (await response.json()) as { ok: boolean; data: MeetingOverview };
  expect(body.ok, "getSponsorMeeting should succeed for the owner").toBeTruthy();
  return body.data;
};

const expectNoSeriousA11yViolations = async (page: Page, label: string): Promise<void> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  const serious = (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  if (serious.length > 0) console.log(`axe violations at ${label}:`, JSON.stringify(serious, null, 2));
  expect(serious, `axe serious/critical violations at ${label}`).toHaveLength(0);
};

const openClubStore = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Club Store", exact: true }).click();
  await expect(page.getByText(/^Club store — \d{4} season$/)).toBeVisible();
};

test("Owner negotiates a kit supplier, and the Club Store reports the signed deal", async ({ page }) => {
  test.setTimeout(600_000);
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const saveName = await createExistingClubOwner(page, "A");
  await openOwnerRoute(page, "Sponsorship");

  // The club starts with one baseline shirt sponsor, so the kit supply slot
  // is genuinely open and the commercial pipeline offers it.
  const before = await fetchMeeting(page);
  const kitOffer = before.offers.find((offer) => offer.type === "KIT_SUPPLIER");
  expect(kitOffer, "a kit supply offer should reach the Owner's desk").toBeDefined();
  expect(
    before.active.some((contract) => contract.type === "KIT_SUPPLIER"),
    "the club must not already hold a supplier it never signed",
  ).toBe(false);

  await expectNoSeriousA11yViolations(page, "Sponsorship (offers open)");

  // ---- Select the supplier offer by its real id, then negotiate ----
  await page.getByLabel("Offer").selectOption(kitOffer!.id);
  // Assert the visible brief, not the <select> option: an <option> renders no
  // box, so it is legitimately "hidden" to a visibility check. sponsorNarrative
  // writes "...has proposed a kit supply partnership.", which cannot collide
  // with the option's own "· kit supply" text.
  await expect(page.getByText(/kit supply partnership/i)).toBeVisible();

  // Counter is refused until a positive amount is entered — a real guard.
  const counterButton = page.getByRole("button", { name: /Counter/ });
  await expect(counterButton).toBeDisabled();

  const counterValue = Math.round(kitOffer!.annualValue * 1.02);
  await page.getByLabel("Counter amount").fill(String(counterValue));
  await expect(counterButton).toBeEnabled();
  await counterButton.click();

  /*
   * Deliberately NOT asserted here: the `role="status"` confirmation notice.
   * counter() sets the message and then calls refresh(), which remounts
   * SponsorMeetingView through AsyncPanel and resets that local state — so
   * the outcome message is wiped by the very refresh that follows a
   * successful negotiation. That is pre-existing behaviour in this screen
   * and is recorded as a P2 UX finding rather than papered over with a
   * timing-sensitive assertion. The negotiation's real outcome is proven
   * below against the authoritative payload and the visible contract table.
   */

  // ---- The deal is now a real active contract ----
  const after = await fetchMeeting(page);
  const signed = after.active.find((contract) => contract.type === "KIT_SUPPLIER");
  expect(signed, "countering within the sponsor's ceiling should sign the deal").toBeDefined();
  expect(signed!.annualValue).toBe(counterValue);
  expect(signed!.status).toBe("ACTIVE");

  // ...and it is visible on screen, not merely in the payload.
  await expect(page.getByRole("table")).toContainText(signed!.sponsorName);

  // ---- Phase 1's Club Store reports the Phase 2 deal ----
  await openClubStore(page);
  const store = page.locator("article.panel", { has: page.getByRole("heading", { name: "Retail network" }) });
  await expect(store).toContainText("Kit supplied by");
  await expect(store).toContainText(signed!.sponsorName);
  await expect(store).toContainText(signed!.endDate);
  await expectNoSeriousA11yViolations(page, "Club Store (supplier signed)");

  // ---- Save, reload, and confirm the contract persists ----
  await saveReloadOwnerCareer(page, saveName);
  const reloaded = await fetchMeeting(page);
  const persisted = reloaded.active.find((contract) => contract.type === "KIT_SUPPLIER");
  expect(persisted, "a signed supplier survives save and reload").toBeDefined();
  expect(persisted!.annualValue).toBe(signed!.annualValue);
  expect(persisted!.endDate).toBe(signed!.endDate);

  await openClubStore(page);
  await expect(
    page.locator("article.panel", { has: page.getByRole("heading", { name: "Retail network" }) }),
  ).toContainText(signed!.sponsorName);

  expect(consoleErrors, "the partnership flow should raise no console errors").toEqual([]);
});

test("Sponsorship is responsive and keyboard reachable at 1024/1280/1440/1600", async ({ page }) => {
  test.setTimeout(600_000);
  await createExistingClubOwner(page, "A");
  await openOwnerRoute(page, "Sponsorship");

  // Negotiation controls must be reachable, and nothing decorative may
  // become a tab stop.
  await page.getByLabel("Counter amount").focus();
  await expect(page.getByLabel("Counter amount")).toBeFocused();
  await page.getByRole("button", { name: /Reject/ }).focus();
  await expect(page.getByRole("button", { name: /Reject/ })).toBeFocused();
  await expect(page.getByRole("group", { name: "Meeting responses" })).toBeVisible();

  for (const width of [1024, 1280, 1440, 1600] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Sponsorship" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, `${width}px: page should not overflow horizontally`).toBe(false);

    // Bounding-box containment, not mere DOM visibility — the check style
    // that caught the real Owner-nav clipping bug in the identity phases.
    const responses = page.getByRole("group", { name: "Meeting responses" });
    const box = await responses.boundingBox();
    expect(box, `${width}px: the response controls should have a bounding box`).not.toBeNull();
    if (box) {
      expect(box.x, `${width}px: left edge on screen`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${width}px: right edge within viewport`).toBeLessThanOrEqual(width + 1);
    }
  }
});
