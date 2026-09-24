import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 9D — the Federation President life cycle and the final Federation
 * family. The role fixture gives one person Manager, Owner and President. Term
 * end is driven through the real leadership-continuity routine by a gated
 * fixture command, exactly as the season-end batch would run it.
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

const FAMILY: Array<[string, string | undefined]> = [
  ["Dashboard", undefined],
  ["Federation Overview", "Federation overview"],
  ["Governance", "Governance"],
  ["Federation Projects", "Federation projects"],
  ["Finance", "Federation finance"],
  ["Commercial", undefined],
  ["National Teams", "National teams"],
  ["National Development", "National development"],
  ["Domestic Pyramid", "Domestic pyramid"],
  ["Nepal Map", "Nepal football map"],
  ["Government", "Government relations"],
  ["Election / Tenure", "Tenure"],
];

test("1. The final Federation family is exactly the supported destinations and each opens", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  const sidebar = page.getByRole("navigation", { name: "Primary navigation" });
  for (const [label] of FAMILY) {
    await expect(sidebar.getByRole("button", { name: label, exact: true })).toBeVisible();
  }  for (const [label, title] of FAMILY) {
    await nav(page, label).click();
    if (title) await expect(sectionTitle(page)).toHaveText(title);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
  }
});

test("2. Tenure shows the real term, base career, what happens at term end, and honest election state", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Election / Tenure").click();
  await expect(sectionTitle(page)).toHaveText("Tenure");
  await expect(page.getByRole("heading", { name: "Presidency and tenure", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "When the term ends", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Elections", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Presidency history", level: 2 })).toBeVisible();

  const tenure = (await runtime(page, "getFederationTenure")).data;
  expect(tenure.current.status).toBe("ACTIVE");
  const main = page.locator("main");
  await expect(main).toContainText(`${tenure.current.termStart} – ${tenure.current.termEnd}`);
  await expect(main).toContainText(/same person across every role/i);
  await expect(main).toContainText(/Base career:/);
  const history = page.getByRole("table", { name: "Your presidencies of this federation" });
  await expect(history.locator("tbody tr")).toHaveCount(tenure.history.length);
  if (!tenure.election.upcoming) {
    await expect(main).toContainText(/No election is scheduled/);
    await expect(main).not.toContainText("Election date");
  } else {
    await expect(main).toContainText(tenure.election.upcoming.electionDate);
  }
  const text = await main.innerText();
  expect(text).not.toMatch(/mandate|political capital|support score|coalition|probabilit|\d\s*%/i);
});

test("3. Term end restores the base career, removes President access and keeps the same person", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  const before = (await runtime(page, "getCareerOverview")).data;
  expect(before.heldRoles.map((r: any) => r.role)).toContain("FEDERATION_PRESIDENT");
  const baseRole = before.baseRole as string;
  expect(["MANAGER", "CHAIRMAN_OWNER"]).toContain(baseRole);

  expect((await runtime(page, "seedE2EExpirePresidency")).ok).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /Load career/i }).click().catch(() => {});

  const after = (await runtime(page, "getCareerOverview")).data;
  expect(after.personId).toBe(before.personId);
  expect(after.name).toBe(before.name);
  expect(after.activeRole).toBe(baseRole);
  expect(after.heldRoles.map((r: any) => r.role)).not.toContain("FEDERATION_PRESIDENT");
  expect(after.heldRoles.map((r: any) => r.role)).toContain(baseRole);

  for (const command of [
    "getFederationPresidentDashboard",
    "getFederationTenure",
    "getFederationExternalContext",
    "getFederationCompetitionGovernance",
    "getFederationDevelopmentProgrammes",
    "getFederationGrants",
    "getGovernmentOverview",
  ]) {
    const result = await runtime(page, command);
    expect(result.ok, command).toBe(false);
    expect(result.error?.code, command).toBe("ROLE_NOT_AUTHORIZED");
  }
  const budget = await runtime(page, "setFederationBudget", { category: "ADMINISTRATION", amount: 1_000_000 });
  expect(budget.ok).toBe(false);
  expect(budget.error?.code).toBe("ROLE_NOT_AUTHORIZED");
});

test("4. Government shows real institutions or an honest empty state, and no hidden political values", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Government").click();
  await expect(sectionTitle(page)).toHaveText("Government relations");
  const overview = (await runtime(page, "getGovernmentOverview")).data;
  const main = page.locator("main");
  if (overview.institutions.length === 0) {
    await expect(main).toContainText(/No government institution has engaged with the federation yet/);
  } else {
    await expect(main).toContainText(overview.institutions[0].name);
    await expect(main).toContainText(/not reviewed automatically/i);
  }
  const text = await main.innerText();
  expect(text).not.toMatch(/party|ideolog|corruption|lobby|trust score|credibility/i);
  expect(JSON.stringify(overview)).not.toMatch(/credibilityTowardFederation|"trust"|footballPriority"/);
});

test("5. External bodies context is the recorded compliance and sanctions only", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Federation Overview").click();
  await expect(page.getByRole("heading", { name: "External bodies", level: 2 })).toBeVisible();
  const context = (await runtime(page, "getFederationExternalContext")).data;
  const main = page.locator("main");
  await expect(main).toContainText("Compliance standing");
  if (context.sanctions.length === 0) {
    await expect(main).toContainText(/No sanctions are on record from FIFA, the AFC or domestic authorities/);
  } else {
    await expect(page.getByRole("table", { name: "Sanctions imposed on the federation" })).toBeVisible();
  }
  await expect(main.getByRole("button", { name: /FIFA|AFC|SAFF/ })).toHaveCount(0);
  expect(JSON.stringify(context)).not.toMatch(/autonomy|statutoryCompliance|electionLegitimacy|dimensions/);
});

test("6. Manager and Owner have no President access", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  for (const role of ["MANAGER", "CHAIRMAN_OWNER"]) {
    await page.getByLabel("Active career role").selectOption(role);
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Election / Tenure", exact: true })).toHaveCount(0);
    for (const command of ["getFederationTenure", "getFederationExternalContext", "getGovernmentOverview", "getFederationPresidentDashboard"]) {
      const result = await runtime(page, command);
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
    const request = await runtime(page, "requestGovernmentFunding", { institutionId: "x", fundingType: "INFRASTRUCTURE", requestedAmount: 1000 });
    expect(request.ok).toBe(false);
    expect(request.error?.code).toBe("ROLE_NOT_AUTHORIZED");
  }
});

test("7. Federation navigation and contextual links preserve history", async ({ page }) => {
  test.setTimeout(400_000);
  await becomePresident(page);
  await nav(page, "Federation Overview").click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
  await page.locator("main").getByRole("button", { name: "Government", exact: true }).click();
  await expect(sectionTitle(page)).toHaveText("Government relations");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
  await nav(page, "Election / Tenure").click();
  await expect(sectionTitle(page)).toHaveText("Tenure");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
});

test("8. Final Federation screens: no overflow at every width, one h1, axe clean, scroll regions keyboard-reachable", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const screens: Array<[string, string]> = [
    ["Federation Overview", "Federation overview"],
    ["Governance", "Governance"],
    ["Federation Projects", "Federation projects"],
    ["Finance", "Federation finance"],
    ["National Development", "National development"],
    ["Domestic Pyramid", "Domestic pyramid"],
    ["Government", "Government relations"],
    ["Election / Tenure", "Tenure"],
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
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
    const violations = await seriousViolations(page);
    if (violations.length > 0) console.log(`axe serious/critical on ${label}:`, JSON.stringify(violations, null, 2));
    expect(violations, `serious/critical axe on ${label}`).toHaveLength(0);
  }

  await nav(page, "Election / Tenure").click();
  await page.getByRole("region", { name: "Presidency history" }).focus();
  await expect(page.getByRole("region", { name: "Presidency history" })).toBeFocused();
});
