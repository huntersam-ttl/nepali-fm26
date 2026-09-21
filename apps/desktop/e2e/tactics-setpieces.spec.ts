import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4C — Set Pieces preparation in the Tactics workspace.
 *
 * Set Pieces is the only genuinely canonical system in Phase 4C scope:
 * SetPieceAssignments has real read + commands (updateTactics.setPieces). It is
 * a STRUCTURED editor (named takers/targets/routines — no invented spatial
 * coordinates), so there is no drag feature to test and none is required.
 *
 * Opposition Instructions are NOT modelled by the engine (see report): there is
 * no canonical per-opponent scouting/instruction schema, so no Opposition mode
 * is added and nothing is fabricated.
 *
 * Declares no per-spec base URL; NEPAL_E2E_BASE_URL selects the server.
 */

const LONG = 120_000;

const createCareer = async (page: Page, saveName: string): Promise<void> => {
  await page.goto("/");
  await page.getByRole("button", { name: /New Career/i }).click();
  await page.getByLabel("Save name").fill(saveName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Starting club")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Save" }).click();
  await expect(page.getByRole("button", { name: "Home / Inbox" })).toBeVisible({ timeout: LONG });
};

const goTo = (page: Page, screen: string) =>
  page.locator("nav").getByRole("button", { name: screen, exact: true }).click();

const openTactics = async (page: Page): Promise<void> => {
  await goTo(page, "Tactics");
  await expect(page.locator(".pitch")).toBeVisible();
};

const setMode = async (page: Page, label: string): Promise<void> => {
  await page.getByRole("radio", { name: label, exact: true }).click();
};

test("Set Pieces shows canonical routines and an assignment edit persists", async ({ page }) => {
  test.setTimeout(300_000);
  await createCareer(page, `Phase4C setpieces ${Date.now()}`);
  await openTactics(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  setMode(page, "Set Pieces");
  await expect(page.getByRole("heading", { name: "Set pieces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Penalties" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Corners — attacking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Corners — defensive" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Free kicks/ })).toBeVisible();
  // No throw-in routine is surfaced.
  await expect(page.getByRole("heading", { name: /throw-in/i })).toHaveCount(0);

  // Change one real assignment (left corner taker) — a canonical update.
  const leftCorner = page.getByLabel("Left corner taker");
  const values = await leftCorner
    .locator("option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  expect(values.length).toBeGreaterThan(1);
  const chosen = values.find((value) => value !== "");
  await leftCorner.selectOption(chosen!);
  await expect(leftCorner).toHaveValue(chosen!);

  // Away and back: set-piece state persists through the canonical tactic.
  await goTo(page, "Home / Inbox");
  await openTactics(page);
  setMode(page, "Set Pieces");
  await expect(page.getByLabel("Left corner taker")).toHaveValue(chosen!);
});

test("accessible set-piece edit (no drag is ever required)", async ({ page }) => {
  test.setTimeout(300_000);
  await createCareer(page, `Phase4C accessible ${Date.now()}`);
  await openTactics(page);
  setMode(page, "Set Pieces");

  // Every set-piece control is a native labelled `<select>` (no drag), so it is
  // fully keyboard operable. Prove keyboard focus, then edit via the select.
  const penalty = page.getByLabel("Penalty taker");
  await penalty.focus();
  await expect(penalty).toBeFocused();
  const options = await penalty
    .locator("option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  const chosen = options.find((value) => value !== "");
  await penalty.selectOption(chosen!);
  await expect(penalty).toHaveValue(chosen!);
});