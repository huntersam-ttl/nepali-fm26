import { expect, test, type Page } from "@playwright/test";

// The founder wizard's identity write needs NEPAL_E2E_ROLE_FIXTURE=1 for
// armE2ENextIdentitySaveFailure to be reachable at all (same gate every
// other E2E fixture command uses) — the shared ambient dev server other
// specs' reuseExistingServer may be pointed at is not guaranteed to have
// that flag. Point only this file at an isolated instance, same pattern
// as nav-responsive.spec.ts / portrait-continuity.spec.ts.
if (process.env.NEPAL_FOUNDER_FAILURE_E2E_BASE_URL) {
  test.use({ baseURL: process.env.NEPAL_FOUNDER_FAILURE_E2E_BASE_URL });
}

/**
 * The Create-a-Club wizard's identity write is a real, non-atomic
 * follow-up call after createCareer succeeds (see main.tsx's
 * saveFounderIdentity/pendingCareer state, Phase 1I). This was
 * previously only code-reviewed, never exercised end-to-end. Uses a
 * test-only fault injection (armE2ENextIdentitySaveFailure, gated behind
 * NEPAL_E2E_ROLE_FIXTURE, never reachable in production) to make the
 * very next setClubVisualIdentity call fail deterministically, then
 * verifies the failure banner, Retry (which must persist the exact
 * designed identity and never re-found the club), and Continue without
 * saving (which must leave exactly one club with the deterministic
 * fallback identity).
 */

const armIdentityFailure = async (page: Page): Promise<void> => {
  const res = await page.request.post("/runtime/command/armE2ENextIdentitySaveFailure", { data: {} });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).ok).toBeTruthy();
};

const foundClubThroughReview = async (
  page: Page,
  saveName: string,
): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByLabel("Full name").fill(`${saveName} Owner`);
  await page.getByLabel("Display name").fill(`${saveName} Owner`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Career mode").selectOption("OWNER");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Club name").fill(`${saveName} FC`);
  await page.getByLabel("Province / district").selectOption({ index: 1 });
  // A distinctive custom colour so we can later confirm exactly this
  // (not the deterministic default) persisted after Retry.
  await page.getByLabel("Primary colour").fill("#ff00aa");
  await page.getByRole("button", { name: "Continue" }).click();
};

test("identity persistence failure shows a visible banner with Retry and Continue without saving, never a false success", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await armIdentityFailure(page);
  const saveName = `Founder Failure ${Date.now()}`;
  await foundClubThroughReview(page, saveName);
  await page.getByRole("button", { name: "Create Save" }).click();

  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible({ timeout: 120_000 });
  await expect(banner).toContainText("could not be saved");
  await expect(page.getByRole("button", { name: "Retry saving identity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue without saving branding" })).toBeVisible();
  // Must never claim success while the banner is showing a failure.
  await expect(page.getByText("Club identity saved.")).toHaveCount(0);

  expect(errors, `uncaught page errors: ${errors.join("; ")}`).toHaveLength(0);
});

test("Retry persists the exact designed identity exactly once, without re-founding the club", async ({ page }) => {
  test.setTimeout(180_000);
  await armIdentityFailure(page);
  const saveName = `Founder Retry ${Date.now()}`;
  await foundClubThroughReview(page, saveName);
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Retry saving identity" })).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: "Retry saving identity" }).click();
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();

  // Exactly one club: the wizard's own review/dashboard both name the
  // same club, and there is exactly one "Continue career" / save entry.
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(`${saveName} FC`);

  await page.getByRole("button", { name: "Club Identity" }).click();
  await expect(page.locator('input[aria-label="Primary colour"]')).toHaveValue("#ff00aa");

  // Save/reload: the retried identity must still be exact, not reverted
  // to the deterministic fallback.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await page.getByRole("button", { name: new RegExp(saveName) }).click();
  await expect(page.getByLabel("Active career role")).toHaveValue("CHAIRMAN_OWNER");
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  const clubIdentityLink = page.getByRole("button", { name: "Club Identity" });
  await expect(clubIdentityLink).toBeVisible();
  await clubIdentityLink.click();
  await expect(page.locator('input[aria-label="Primary colour"]')).toHaveValue("#ff00aa");

  // Only one save exists for this founding — no duplicate career/club
  // was created by the retry.
  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.getByRole("button", { name: /Load Career/i }).click();
  const matchingSaves = page.getByRole("button", { name: new RegExp(saveName) });
  await expect(matchingSaves).toHaveCount(1);
});

test("Continue without saving leaves exactly one club with the deterministic fallback identity", async ({ page }) => {
  test.setTimeout(180_000);
  await armIdentityFailure(page);
  const saveName = `Founder Continue ${Date.now()}`;
  await foundClubThroughReview(page, saveName);
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Continue without saving branding" })).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole("button", { name: "Continue without saving branding" }).click();
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chairman / Owner" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(`${saveName} FC`);

  // The club exists and resolves the real deterministic fallback (never
  // the custom #ff00aa the player designed but that failed to save).
  await page.getByRole("button", { name: "Club Identity" }).click();
  await expect(page.getByText(/generated SIMULATION_ONLY default identity/i)).toBeVisible();
  await expect(page.locator('input[aria-label="Primary colour"]')).not.toHaveValue("#ff00aa");

  await page.getByRole("button", { name: "Main Menu" }).click();
  await page.getByRole("button", { name: /Load Career/i }).click();
  await expect(page.getByRole("button", { name: new RegExp(saveName) })).toHaveCount(1);
});
