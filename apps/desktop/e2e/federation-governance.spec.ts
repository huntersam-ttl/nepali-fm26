import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 9C — domestic competition governance, club licensing, recorded reforms
 * and development programmes for the active President. A fresh save has no
 * reform, licence case or programme, so this spec proves the honest empty
 * states and the real competition structure; the domain tests prove the
 * mapping of recorded reforms, licences and programmes.
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

test("1. Domestic Pyramid shows the real competition structure, and honest empty reform and licensing state", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Domestic Pyramid").click();
  await expect(sectionTitle(page)).toHaveText("Domestic pyramid");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Domestic competitions", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Competition reforms", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Club licensing/, level: 2 })).toBeVisible();

  const governance = (await runtime(page, "getFederationCompetitionGovernance")).data;
  expect(governance.competitions.length).toBeGreaterThan(0);
  const table = page.getByRole("table", { name: "Domestic competitions of the federation" });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(governance.competitions.length);
  for (const row of governance.competitions.slice(0, 5)) {
    await expect(table).toContainText(row.competition.label);
  }
  const topTier = governance.competitions.find((row: any) => /a-division/i.test(row.competition.label) && row.seasonName);
  expect(topTier).toBeTruthy();
  expect(topTier.teamCount).toBeGreaterThan(0);
  const pyramid = (await runtime(page, "getCompetitionPyramid")).data;
  const tierOne = pyramid.tiers.find((tier: any) => tier.level === 1);
  expect(tierOne.currentSeasonName, "the pyramid must use the A-Division competition that has a season").toBeTruthy();
  expect(tierOne.teamCount).toBeGreaterThan(0);

  await expect(page.getByText("No competition reforms have been recorded.")).toBeVisible();
  await expect(page.getByText(/No club licence cases are on record yet/)).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/prestige|competitiveness|financial ranking|approval odds|desirab/i);
});

test("2. Reforms are read-only here and route to Governance", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Domestic Pyramid").click();
  await expect(page.getByRole("heading", { name: "Competition reforms", level: 2 })).toBeVisible();
  await expect(page.getByText(/not available from this office/i)).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: /apply|implement|approve|reject|deny|grant licen/i })).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "Open Governance" }).click();
  await expect(sectionTitle(page)).toHaveText("Governance");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("Domestic pyramid");
});

test("3. National Development shows programmes and funding honestly, and links onward", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "National Development").click();
  await expect(sectionTitle(page)).toHaveText("National development");
  await expect(page.getByRole("heading", { name: "Development programmes and funding", level: 2 })).toBeVisible();
  const programmes = (await runtime(page, "getFederationDevelopmentProgrammes")).data;
  for (const category of ["COACH_EDUCATION", "REFEREE_DEVELOPMENT", "YOUTH_DEVELOPMENT", "GRASSROOTS", "WOMENS_FOOTBALL"]) {
    expect(programmes.budgets.map((b: any) => b.category)).toContain(category);
  }
  const budgets = page.getByRole("table", { name: "Season budgets for development areas" });
  await expect(budgets).toBeVisible();
  await expect(budgets).toContainText("Coach education");
  await expect(budgets).toContainText("Women's football");
  if (programmes.coachEducation.length === 0)
    await expect(page.getByText("No coach-education programme has been run.")).toBeVisible();
  if (programmes.referee.length === 0)
    await expect(page.getByText("No referee development programme has been run.")).toBeVisible();
  await expect(page.getByText(/separate from your own career\s+qualifications/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Women & girls programme", level: 2 })).toBeVisible();
  await page.locator("main").getByRole("button", { name: "Open Finance" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation finance");
});

test("4. The Governance programme cards no longer draw an invented progress bar", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Governance").click();
  await expect(sectionTitle(page)).toHaveText("Governance");
  const card = page.locator("article.facility-project-card", { hasText: "National Training Centre" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Status");
  await expect(card).toContainText("Construction");
  await expect(page.locator(".project-progress-fill")).toHaveCount(0);
  await expect(page.locator('[role="progressbar"], progress')).toHaveCount(0);
  expect(await card.innerText()).not.toMatch(/\d+%/);
});

test("5. Manager and Owner cannot read the President's competition governance or programmes", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  expect((await runtime(page, "getFederationCompetitionGovernance")).ok).toBe(true);
  expect((await runtime(page, "getFederationDevelopmentProgrammes")).ok).toBe(true);
  for (const role of ["MANAGER", "CHAIRMAN_OWNER"]) {
    await page.getByLabel("Active career role").selectOption(role);
    for (const command of ["getFederationCompetitionGovernance", "getFederationDevelopmentProgrammes"]) {
      const result = await runtime(page, command);
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
  }
});

test("6. Overview links to the Domestic Pyramid and stays uncluttered", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Federation Overview").click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
  await expect(page.getByRole("heading", { name: "Needs your attention", level: 2 })).toBeVisible();
  const governance = (await runtime(page, "getFederationCompetitionGovernance")).data;
  const approved = governance.reforms.filter((r: any) => r.status === "APPROVED").length;
  const licences = governance.licensing.cases.filter((c: any) => c.status === "FAILED" || c.status === "CONDITIONAL").length;
  const attention = page.locator("main").getByRole("button", { name: "Open Domestic Pyramid" });
  await expect(attention).toHaveCount(approved > 0 || licences > 0 ? (approved > 0 ? 1 : 0) + (licences > 0 ? 1 : 0) : 0);
});

test("7. Modified federation screens: no overflow at every width, one h1, axe clean, scroll regions keyboard-reachable", async ({
  page,
}) => {
  test.setTimeout(700_000);
  await becomePresident(page);
  const screens: Array<[string, string]> = [
    ["Federation Overview", "Federation overview"],
    ["Domestic Pyramid", "Domestic pyramid"],
    ["National Development", "National development"],
    ["Governance", "Governance"],
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

  await nav(page, "Domestic Pyramid").click();
  await page.getByRole("region", { name: "Domestic competitions" }).focus();
  await expect(page.getByRole("region", { name: "Domestic competitions" })).toBeFocused();
});
