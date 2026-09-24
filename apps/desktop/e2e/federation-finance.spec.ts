import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 9B — Federation finance, season budgets and grants for the active
 * President. The role fixture initialises the federation's accounts and budgets
 * and gives one person Manager, Owner and President.
 */
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const seriousViolations = async (page: Page): Promise<unknown[]> => {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (root: Document, options: unknown) => Promise<unknown> } }).axe;
    return axe.run(document, { resultTypes: ["violations"] });
  });
  return (results.violations as Array<{ id: string; impact: string; nodes: unknown[] }>).filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
};

const becomePresident = async (page: Page): Promise<void> => {
  await createExistingClubOwner(page, "A");
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  await expect(page.getByText("Federation balance")).toBeVisible();
};

const nav = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: label, exact: true });

const sectionTitle = (page: Page) => page.locator(".page-header h2");

type Envelope = { ok: boolean; data?: any; error?: { code: string; message: string } };
const runtime = async (page: Page, name: string, data: object = {}): Promise<Envelope> => {
  const response = await page.request.post(`/runtime/command/${name}`, { data });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Envelope;
};

const budgets = async (page: Page): Promise<Array<{ category: string; amount: number; usedAmount: number; seasonLabel: string; status: string }>> =>
  (await runtime(page, "getFederationPresidentDashboard")).data.finances.budgets;

test("1. Finance shows real funds, budgets and grants with no hidden state", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Finance").click();
  await expect(sectionTitle(page)).toHaveText("Federation finance");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  for (const panel of ["Funds and commitments", "Grants and external funding", "Where funding shows up"]) {
    await expect(page.getByRole("heading", { name: panel, level: 2 })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: /^Season budgets/, level: 2 })).toBeVisible();
  const main = page.locator("main");
  await expect(main).toContainText("Cash balance");
  await expect(main).toContainText("Restricted funds");
  await expect(main).toContainText("Not restricted");
  await expect(main).toContainText("Financial standing");
  await expect(page.getByRole("table", { name: "Federation season budgets by category" })).toBeVisible();
  const text = await main.innerText();
  expect(text).not.toMatch(/health score|sustainab|forecast|probabilit|approval odds|risk weight/i);
});

test("2. A President budget change persists, moves no money, and the domain rejects bad input", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Finance").click();
  await expect(sectionTitle(page)).toHaveText("Federation finance");

  const before = (await budgets(page)).find((b) => b.category === "ADMINISTRATION" && b.status === "ACTIVE")!;
  const accountBefore = (await runtime(page, "getFederationPresidentDashboard")).data.finances.account;
  const target = before.amount + 1_000_000;

  await page.getByRole("button", { name: "Change Administration budget" }).click();
  await page.getByLabel("New budget for Administration").fill(String(target));
  await page.getByRole("button", { name: "Set Administration budget" }).click();
  await expect(page.getByRole("status")).toContainText(/Administration budget set to/i);

  // Leave and return: the change is persisted, not React state.
  await nav(page, "Federation Projects").click();
  await expect(sectionTitle(page)).toHaveText("Federation projects");
  await nav(page, "Finance").click();
  await expect(page.getByRole("table", { name: "Federation season budgets by category" })).toContainText(
    target.toLocaleString("en-US"),
  );
  const after = (await budgets(page)).find((b) => b.category === "ADMINISTRATION" && b.status === "ACTIVE")!;
  expect(after.amount).toBe(target);
  expect(after.usedAmount).toBe(before.usedAmount);
  const accountAfter = (await runtime(page, "getFederationPresidentDashboard")).data.finances.account;
  expect(accountAfter.cashBalance).toBe(accountBefore.cashBalance);
  expect(accountAfter.restrictedFunds).toBe(accountBefore.restrictedFunds);

  // Domain-level validation, independent of the form.
  for (const data of [
    { category: "ADMINISTRATION", amount: target },
    { category: "ADMINISTRATION", amount: -1 },
    { category: "ADMINISTRATION", amount: 1.5 },
    { category: "NOT_A_CATEGORY", amount: 100 },
  ]) {
    const result = await runtime(page, "setFederationBudget", data);
    expect(result.ok, JSON.stringify(data)).toBe(false);
    expect(result.error?.code).toBe("INVALID_SELECTION");
  }
  const unchanged = (await budgets(page)).find((b) => b.category === "ADMINISTRATION" && b.status === "ACTIVE")!;
  expect(unchanged.amount).toBe(target);
});

test("3. Manager and Owner cannot use federation funding commands", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  expect((await runtime(page, "getFederationGrants")).ok).toBe(true);
  for (const role of ["MANAGER", "CHAIRMAN_OWNER"]) {
    await page.getByLabel("Active career role").selectOption(role);
    for (const [command, data] of [
      ["setFederationBudget", { category: "ADMINISTRATION", amount: 5_000_000 }],
      ["getFederationGrants", {}],
    ] as const) {
      const result = await runtime(page, command, data);
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
  }
});

test("4. Overview, Finance, Projects and National Development link to each other", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Federation Overview").click();
  await expect(page.locator("main")).toContainText("Cash balance");
  await expect(page.locator("main")).toContainText("Restricted funds");
  await page.locator("main").getByRole("button", { name: "Open Finance" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation finance");

  await page.locator("main").getByRole("button", { name: "National Development", exact: true }).click();
  await expect(sectionTitle(page)).toHaveText("National development");
  await expect(page.locator("main")).toContainText("Active development programmes");

  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation finance");
  await page.locator("main").getByRole("button", { name: "Federation Projects", exact: true }).click();
  await expect(sectionTitle(page)).toHaveText("Federation projects");
  await page.locator("main").getByRole("button", { name: "Open Finance" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation finance");
});

test("5. Modified federation screens: no overflow at every width, one h1, axe clean, table scroll keyboard-reachable", async ({
  page,
}) => {
  test.setTimeout(700_000);
  await becomePresident(page);
  const screens: Array<[string, string]> = [
    ["Federation Overview", "Federation overview"],
    ["Finance", "Federation finance"],
    ["Federation Projects", "Federation projects"],
    ["National Development", "National development"],
  ];
  for (const width of [721, 1024, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [label, title] of screens) {
      await nav(page, label).click();
      await expect(sectionTitle(page)).toHaveText(title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(noOverflow, `${label} at ${width}px must not overflow the page`).toBe(true);
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [label, title] of screens) {
    await nav(page, label).click();
    await expect(sectionTitle(page)).toHaveText(title);
    await expect(page.getByText("Loading…")).toHaveCount(0);
    const violations = await seriousViolations(page);
    if (violations.length > 0) console.log(`axe serious/critical on ${label}:`, JSON.stringify(violations, null, 2));
    expect(violations, `serious/critical axe on ${label}`).toHaveLength(0);
  }

  // Keyboard: the budget table scroll region and its Change buttons are reachable.
  await nav(page, "Finance").click();
  await page.getByRole("region", { name: "Season budgets" }).focus();
  await expect(page.getByRole("region", { name: "Season budgets" })).toBeFocused();
  await page.getByRole("button", { name: "Change Grassroots budget" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("New budget for Grassroots")).toBeVisible();
});
