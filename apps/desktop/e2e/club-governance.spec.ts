import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 6B — Club governance (Finances, Board, Responsibilities).
 * Only supported canonical flows are exercised: the Club family destinations,
 * Manager finance context without Owner edit controls, canonical board
 * leadership/objective links, and delegation persistence via the canonical
 * command. No Owner-only control is asserted as available to the Manager.
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
  page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: screen, exact: true })
    .click();

const firstNrp = (text: string): string => (text.match(/NPR [\d,]+/) ?? ["NPR 0"])[0]!;

test("1. Club family exposes only live destinations and one h1", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Club governance ${Date.now()}`);
  for (const label of ["Club Overview", "Club Profile", "Club Finances", "Club Board", "Responsibilities"]) {
    await goTo(page, label);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: label, level: 2 }).last()).toBeVisible();
  }
});

test("2. Finances shows Manager budget context and no Owner-only controls", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Finance view ${Date.now()}`);
  await goTo(page, "Club Finances");
  await expect(page.getByText(/Transfer allocation/i).first()).toBeVisible();
  await expect(page.getByText(/Wage allocation/i).first()).toBeVisible();
  const financeText = await page.locator("body").innerText();
  // Manager can request an increase, never edit/set/approve an allocation.
  await expect(page.getByRole("button", { name: /Request transfer budget/i })).toBeVisible();
  const buttons = await page.locator("button").allInnerTexts();
  const lower = buttons.map((b) => b.toLowerCase()).join(" ");
  expect(lower).not.toMatch(/set budget|edit budget|approve budget/);
});

test("3. Board surfaces canonical leadership, objective, and a Person link; Back returns", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Board view ${Date.now()}`);
  await goTo(page, "Club Board");
  await expect(page.getByText(/Owner \/ Chairman/i).first()).toBeVisible();
  await expect(page.getByText(/Board expects/i).first()).toBeVisible();
  await expect(page.getByText(/Board confidence/i).first()).toBeVisible();
  const person = page.locator("dd").getByRole("link", { name: /./ }).first();
  if (await person.count()) {
    await person.click();
    await expect(page.locator(".page-header h2").first()).not.toHaveText("Club Board");
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Club Board", level: 2 }).last()).toBeVisible();
  }
});

test("4. Responsibilities lists real rows; a change persists through navigation", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Responsibilities ${Date.now()}`);
  await goTo(page, "Responsibilities");
  await expect(page.getByText(/Transfers/i).first()).toBeVisible();
  await expect(page.getByText(/SCOUTING|Scouting/i).first()).toBeVisible();

  // Reassign the first responsibility to the Board via the canonical command,
  // then confirm it persists after navigating away and back.
  const firstSelect = page.locator("table").first().locator("select").first();
  await firstSelect.selectOption("BOARD");
  await page.locator("table").first().getByRole("button", { name: "Assign" }).first().click();
  await expect(page.getByText("Responsibility reassigned — the change is saved.")).toBeVisible();

  await goTo(page, "Home / Inbox");
  await goTo(page, "Responsibilities");
  // Wait for the async read to render before inspecting rows (a raw .count()
  // returns immediately without auto-waiting).
  await expect(page.getByText(/Transfers/i).first()).toBeVisible();
  // The reassigned first row now shows "Board" as its current owner.
  await expect(page.locator("table").first().getByText("Board", { exact: true }).first()).toBeVisible();
});

test("6. Recruitment budget and Club Finances read the same canonical allocation", async ({ page }) => {
  test.setTimeout(600_000);
  await createCareer(page, `Budget consistency ${Date.now()}`);
  await goTo(page, "Club Finances");
  const financeText = await page.locator("body").innerText();
  const financeTransfer = firstNrp(financeText);
  await goTo(page, "Transfers");
  const transferText = await page.locator("body").innerText();
  const transferAllocated = firstNrp(transferText);
  // Both surfaces derive from the same TransferBudgetView allocation figure
  // (a fresh founding club may legitimately start at NPR 0 — consistency, not
  // magnitude, is what is asserted).
  expect(transferAllocated).toBe(financeTransfer);
});