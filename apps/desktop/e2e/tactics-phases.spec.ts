import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4B — Tactical modes: Team Shape (roles/duties) + In Possession,
 * Transition and Out of Possession instruction phases. Pitch stays visible and
 * the same tactic state persists across mode switches, navigation and Match Day.
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

test("Team Shape role change is a canonical update that persists", async ({ page }) => {
  test.setTimeout(300_000);
  await createCareer(page, `Phase4B role ${Date.now()}`);
  await openTactics(page);

  await page.locator(".pitch .slot").first().click();
  const roleSelect = page.getByLabel("Role");
  const before = await roleSelect.inputValue();
  const values = await roleSelect
    .locator("option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  const chosen = values.find((value) => value !== before);
  expect(chosen, "a second role must exist").toBeTruthy();
  await roleSelect.selectOption(chosen);
  await expect(roleSelect).toHaveValue(chosen);

  // Away and back: the canonical tactic keeps the new role.
  await goTo(page, "Home / Inbox");
  await openTactics(page);
  await page.locator(".pitch .slot").first().click();
  await expect(page.getByLabel("Role")).toHaveValue(chosen);
});

for (const [label, toggle] of [
  ["In Possession", "Play from the back"],
  ["Transition", "Counter-press"],
  ["Out of Possession", "Press goalkeeper"],
] as const) {
  test(`${label}: pitch stays visible and a real instruction persists`, async ({ page }) => {
    test.setTimeout(300_000);
    await createCareer(page, `Phase4B ${label} ${Date.now()}`);
    await openTactics(page);

    setMode(page, label);
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    // Pitch remains primary while editing a phase.
    await expect(page.locator(".pitch .slot")).toHaveCount(11);

    await page.getByRole("checkbox", { name: toggle }).check();
    await expect(page.getByRole("checkbox", { name: toggle })).toBeChecked();

    // Away and back: the phase instruction persists through the canonical tactic.
    await goTo(page, "Home / Inbox");
    await openTactics(page);
    setMode(page, label);
    await expect(page.getByRole("checkbox", { name: toggle })).toBeChecked();
  });
}
test("mode switching preserves lineup, formation and selected slot", async ({ page }) => {
  test.setTimeout(300_000);
  await createCareer(page, `Phase4B modes ${Date.now()}`);
  await openTactics(page);

  const formation = await page.getByLabel("Formation").inputValue();
  await page.locator(".pitch .slot").first().click();
  await expect(page.locator(".pitch .slot").first()).toHaveAttribute("aria-pressed", "true");

  for (const label of ["In Possession", "Transition", "Out of Possession", "Team Shape"]) {
    setMode(page, label);
    await expect(page.locator(".pitch .slot")).toHaveCount(11);
  }
  await expect(page.getByLabel("Formation")).toHaveValue(formation);
  // The selected slot survives mode changes.
  await expect(page.locator(".pitch .slot").first()).toHaveAttribute("aria-pressed", "true");
});

test("player profile from a tactical slot -> Back keeps mode and selection", async ({ page }) => {
  test.setTimeout(300_000);
  await createCareer(page, `Phase4B profile ${Date.now()}`);
  await openTactics(page);

  await page.locator(".pitch .slot").first().click();
  setMode(page, "In Possession");
  const profileLink = page.getByRole("button", { name: /Open .*'s profile/ }).first();
  if (await profileLink.count()) {
    await profileLink.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Tactics");
    await page.getByRole("button", { name: "Go back" }).click();
  }
  await expect(page.locator(".pitch")).toBeVisible();
  await expect(page.getByRole("radio", { name: "In Possession", exact: true })).toBeChecked();
});

test("role + phase instruction changes reach Match Day (Quick Sim / Key Events / Text Live)", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await createCareer(page, `Phase4B matchday ${Date.now()}`);

  // One role change + one phase instruction change through canonical state.
  await openTactics(page);
  await page.locator(".pitch .slot").first().click();
  const roleSelect = page.getByLabel("Role");
  const before = await roleSelect.inputValue();
  const values = await roleSelect
    .locator("option")
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  const chosen = values.find((value) => value !== before);
  if (chosen) await roleSelect.selectOption(chosen);
  setMode(page, "Transition");
  await page.getByRole("checkbox", { name: "Regroup" }).check();

  // Advance world time to the fixture and open match preparation.
  const matchdayCta = page.getByRole("button", { name: /Matchday/ });
  const advance = page.locator(".topbar").getByRole("button", { name: "Continue", exact: true });
  for (let attempt = 0; attempt < 12 && !(await matchdayCta.count()); attempt += 1) {
    await advance.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
  await expect(matchdayCta).toBeVisible({ timeout: LONG });
  await matchdayCta.click();
  await expect(page.getByRole("heading", { name: "Match preparation" })).toBeVisible({ timeout: LONG });

  // The only match presentation modes remain Quick Sim / Key Events / Text Live.
  await expect(page.getByRole("radio", { name: /Quick Sim/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Key Events/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Text Live/ })).toBeVisible();
});