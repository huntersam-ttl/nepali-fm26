import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 10A — the President's national-team workspace. The role fixture gives
 * one person Manager, Owner and President, and initialises the federation's five
 * national teams with their staff. A gated fixture command then gives the senior
 * men's team a real squad and two friendlies through the domain functions the
 * simulation itself uses.
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
const family = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "National team sections" }).getByRole("button", { name: label, exact: true });
const sectionTitle = (page: Page) => page.locator(".page-header h2");

type Envelope = { ok: boolean; data?: any; error?: { code: string; message: string } };
const runtime = async (page: Page, name: string, data: object = {}): Promise<Envelope> => {
  const response = await page.request.post(`/runtime/command/${name}`, { data });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Envelope;
};

const seedNationalTeam = async (page: Page): Promise<string> => {
  const seeded = await runtime(page, "seedE2ENationalTeamFixture");
  expect(seeded.ok, JSON.stringify(seeded.error)).toBe(true);
  return seeded.data.nationalTeamId as string;
};

const openTeam = async (page: Page, name: string): Promise<void> => {
  await nav(page, "National Teams").click();
  await expect(sectionTitle(page)).toHaveText("National teams");
  await page.getByRole("button", { name: new RegExp(`^Open ${name} \\(`) }).click();
  await expect(sectionTitle(page)).toHaveText("National team");
};

test("1. The hub lists every real national team and opens a team overview from real state", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  const dashboard = (await runtime(page, "getFederationPresidentDashboard")).data;
  expect(dashboard.nationalTeams.length).toBe(5);
  await nav(page, "National Teams").click();
  await expect(sectionTitle(page)).toHaveText("National teams");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator("article.facility-project-card")).toHaveCount(dashboard.nationalTeams.length);

  await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
  await expect(sectionTitle(page)).toHaveText("National team");
  const men = dashboard.nationalTeams.find((team: any) => team.level === "senior" && team.gender === "men");
  const overview = (await runtime(page, "getNationalTeamOverview", { nationalTeamId: men.id })).data;
  const main = page.locator("main");
  await expect(main).toContainText("Senior men");
  await expect(main).toContainText(overview.team.federation.name);
  await expect(page.getByRole("heading", { name: overview.team.name, level: 2 })).toBeVisible();
  if (overview.headCoach) await expect(main.getByRole("button", { name: overview.headCoach.label, exact: true })).toBeVisible();
  else await expect(main).toContainText("Vacant");
  await expect(main).toContainText("No squad has been called up");
  await expect(main).toContainText("No match is scheduled.");
  await expect(main).toContainText("not entered in a recorded competition");
  expect(await main.innerText()).not.toMatch(/strength|form rating|familiarity|cohesion|potential/i);
});

test("2. Squad shows the called-up players, opens a player, and Back returns to the same team", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  const teamId = await seedNationalTeam(page);
  await openTeam(page, "Nepal Senior Men");
  await family(page, "Squad").click();
  await expect(sectionTitle(page)).toHaveText("National team squad");
  const squad = (await runtime(page, "getNationalTeamSquad", { nationalTeamId: teamId })).data;
  expect(squad.players.length).toBeGreaterThan(0);
  const table = page.getByRole("table", { name: "Players called up to this national team" });
  await expect(table.locator("tbody tr")).toHaveCount(squad.players.length);
  await expect(page.locator("main")).toContainText("cannot be changed from this screen");
  await expect(page.locator("main").getByRole("button", { name: /call up|drop|replace|select player/i })).toHaveCount(0);

  const first = squad.players[0].player.label as string;
  await table.getByRole("button", { name: first, exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("National team squad");
  await expect(page.getByRole("table", { name: "Players called up to this national team" })).toBeVisible();
  await expect(page.locator("main select:not([aria-label])")).toHaveValue(teamId);
});

test("3. Staff shows the real coaching staff and opens the head coach", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  await seedNationalTeam(page);
  await openTeam(page, "Nepal Senior Men");
  await family(page, "Staff").click();
  await expect(sectionTitle(page)).toHaveText("National team staff");
  const dashboard = (await runtime(page, "getFederationPresidentDashboard")).data;
  const men = dashboard.nationalTeams.find((team: any) => team.level === "senior" && team.gender === "men");
  const staff = (await runtime(page, "getNationalTeamStaff", { nationalTeamId: men.id })).data;
  expect(staff.members.length).toBe(5);
  const table = page.getByRole("table", { name: "Current staff of this national team" });
  await expect(table.locator("tbody tr")).toHaveCount(staff.members.length);
  for (const label of ["Head coach", "Assistant coach", "Performance coach", "Medical lead", "Analyst"]) {
    await expect(table).toContainText(label);
  }
  await expect(page.locator("main")).not.toContainText("no head coach");
  const coach = staff.members[0].person.label as string;
  await table.getByRole("button", { name: coach, exact: true }).click();
  await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("National team staff");
});

test("4. Fixtures shows upcoming matches and results from the team's side", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  const teamId = await seedNationalTeam(page);
  await openTeam(page, "Nepal Senior Men");
  await family(page, "Fixtures").click();
  await expect(sectionTitle(page)).toHaveText("National team fixtures");
  const fixtures = (await runtime(page, "getNationalTeamFixtures", { nationalTeamId: teamId })).data;
  expect(fixtures.upcoming.map((m: any) => m.opponent)).toEqual(["Maldives"]);
  expect(fixtures.results.map((m: any) => m.opponent)).toEqual(["Bhutan"]);
  const upcoming = page.getByRole("table", { name: "Upcoming national-team matches" });
  const results = page.getByRole("table", { name: "National-team results" });
  await expect(upcoming).toContainText("Maldives");
  await expect(upcoming).toContainText("Scheduled");
  await expect(results).toContainText("Bhutan");
  await expect(results).toContainText("Played");
  await expect(results).toContainText(/\d–\d/);
  await expect(page.locator("main")).toContainText("Not recorded");
  // The overview reflects the same matches.
  await family(page, "Team overview").click();
  await expect(page.locator("main")).toContainText("Maldives");
  await expect(page.locator("main")).toContainText("Bhutan");
});

test("5. Switching teams never leaks one team's state into another, and the choice follows the sections", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  await seedNationalTeam(page);
  await openTeam(page, "Nepal Senior Men");
  await expect(page.locator("main")).toContainText("Maldives");
  await page.locator("main select:not([aria-label])").selectOption({ label: "Nepal Senior Women (Women & girls)" });
  await expect(page.getByRole("heading", { name: "Nepal Senior Women", level: 2 })).toBeVisible();
  await expect(page.locator("main")).toContainText("Senior women");
  await expect(page.locator("main")).not.toContainText("Maldives");
  await expect(page.locator("main")).toContainText("No squad has been called up");
  await family(page, "Squad").click();
  await expect(page.locator("main")).toContainText(/No players are currently called up/);
  await family(page, "Fixtures").click();
  await expect(page.locator("main")).toContainText("No matches are scheduled.");
  await expect(page.locator("main select:not([aria-label])")).toHaveValue(/.+/);
  await page.locator("main select:not([aria-label])").selectOption({ label: "Nepal U17 Men (Youth · U17)" });
  await expect(page.locator("main")).toContainText("No results are recorded yet");
  await family(page, "Staff").click();
  await expect(page.locator("main")).toContainText("Head coach");
  await family(page, "Team overview").click();
  await expect(page.getByRole("heading", { name: "Nepal U17 Men", level: 2 })).toBeVisible();
});

test("6. Manager and Owner cannot use the national-team workspace, and the President cannot reach another team", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  const dashboard = (await runtime(page, "getFederationPresidentDashboard")).data;
  const teamId = dashboard.nationalTeams[0].id as string;
  for (const role of ["MANAGER", "CHAIRMAN_OWNER"]) {
    await page.getByLabel("Active career role").selectOption(role);
    await expect(nav(page, "National Teams")).toHaveCount(0);
    for (const command of ["getNationalTeamOverview", "getNationalTeamStaff", "getNationalTeamFixtures", "seedE2ENationalTeamFixture"]) {
      const result = await runtime(page, command, { nationalTeamId: teamId });
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
  }
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  const clubTeam = await runtime(page, "getNationalTeamOverview", { nationalTeamId: "not-a-national-team" });
  expect(clubTeam.ok).toBe(false);
  expect(clubTeam.error?.code).toBe("INVALID_SELECTION");
});

test("7. National Teams and the Federation Overview link to each other", async ({ page }) => {
  test.setTimeout(500_000);
  await becomePresident(page);
  await nav(page, "Federation Overview").click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
  await page.locator("main").getByRole("button", { name: "Open National Teams" }).click();
  await expect(sectionTitle(page)).toHaveText("National teams");
  await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
  await expect(sectionTitle(page)).toHaveText("National team");
  await page.locator("main").getByRole("button", { name: "Back to Federation Overview" }).click();
  await expect(sectionTitle(page)).toHaveText("Federation overview");
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("National team");
  await family(page, "All teams").click();
  await expect(sectionTitle(page)).toHaveText("National teams");
  await expect(nav(page, "National Teams")).toHaveClass(/active/);
});

test("8. Every national-team screen: no overflow at every width, one h1, axe clean, scroll regions keyboard-reachable", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  await seedNationalTeam(page);
  const open = async (label: string | null): Promise<void> => {
    if (label === null) {
      await nav(page, "National Teams").click();
      return;
    }
    if (label === "Team overview") {
      await prime();
      return;
    }
    await family(page, label).click();
  };
  const screens: Array<[string | null, string]> = [
    [null, "National teams"],
    ["Team overview", "National team"],
    ["Squad", "National team squad"],
    ["Staff", "National team staff"],
    ["Fixtures", "National team fixtures"],
  ];
  const prime = async (): Promise<void> => {
    await nav(page, "National Teams").click();
    await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
  };
  for (const width of [721, 1024, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await prime();
    for (const [label, title] of screens) {
      await open(label);
      await expect(sectionTitle(page)).toHaveText(title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(noOverflow, `${title} at ${width}px must not overflow the page`).toBe(true);
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await prime();
  for (const [label, title] of screens) {
    await open(label);
    await expect(sectionTitle(page)).toHaveText(title);
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
    const violations = await seriousViolations(page);
    if (violations.length > 0) console.log(`axe serious/critical on ${title}:`, JSON.stringify(violations, null, 2));
    expect(violations, `serious/critical axe on ${title}`).toHaveLength(0);
  }

  await family(page, "Squad").click();
  await page.getByRole("region", { name: "Called-up players" }).focus();
  await expect(page.getByRole("region", { name: "Called-up players" })).toBeFocused();
});
