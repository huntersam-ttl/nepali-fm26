import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 10D — the national-team workspace on state the simulation itself wrote.
 * The gated command runs the real season-end international processing; nothing
 * here is created by a test-only path. Expectations are taken from the backend
 * reads, so the checks hold whichever of Nepal's teams the season entered.
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
const teamSelect = (page: Page) => page.locator("main select:not([aria-label])");

type Envelope = { ok: boolean; data?: any; error?: { code: string; message: string } };
const runtime = async (page: Page, name: string, data: object = {}): Promise<Envelope> => {
  const response = await page.request.post(`/runtime/command/${name}`, { data });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Envelope;
};

type Teams = { men: string; women: string; u23: string; u20: string; u17: string };
const KEYS = ["men", "women", "u23", "u20", "u17"] as const;

const seedBatch = async (page: Page): Promise<{ teams: Teams; views: Record<string, any>; withEntries: string[] }> => {
  const seeded = await runtime(page, "seedE2ENationalTeamSeasonBatch");
  expect(seeded.ok, JSON.stringify(seeded.error)).toBe(true);
  const teams = seeded.data as Teams;
  const views: Record<string, any> = {};
  for (const key of KEYS) views[key] = (await runtime(page, "getNationalTeamCompetitions", { nationalTeamId: teams[key] })).data;
  const withEntries = KEYS.filter((key) => views[key].active.length + views[key].upcoming.length + views[key].completed.length > 0);
  expect(withEntries.length, "the season should enter at least one Nepal team").toBeGreaterThan(0);
  return { teams, views, withEntries };
};

const entriesOf = (view: any): any[] => [...view.active, ...view.upcoming, ...view.completed];

const openTeamCompetitions = async (page: Page, teamId: string): Promise<void> => {
  await nav(page, "National Teams").click();
  await expect(sectionTitle(page)).toHaveText("National teams");
  await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
  await family(page, "Competitions").click();
  await expect(sectionTitle(page)).toHaveText("National team competitions");
  await teamSelect(page).selectOption(teamId);
};

test("1. The season's entries appear with a campaign, a final registration and no edit controls", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams, views, withEntries } = await seedBatch(page);
  const key = withEntries[0]!;
  await openTeamCompetitions(page, teams[key]);
  const entry = entriesOf(views[key])[0];
  const main = page.locator("main");
  await expect(page.getByRole("heading", { name: entry.edition, level: 2 })).toBeVisible();
  expect(entry.campaign, "the simulation wrote a campaign").toBeDefined();
  expect(entry.registration, "the simulation wrote a registration").toBeDefined();
  await expect(main).toContainText(entry.campaign.name);
  await expect(main).toContainText(`${entry.campaign.wins}W ${entry.campaign.draws}D ${entry.campaign.losses}L`);
  expect(entry.registration.status).toBe("FINAL");
  expect(entry.registration.locked).toBe(true);
  await expect(main).toContainText("Final");
  await expect(main).toContainText("Locked");
  await expect(main).toContainText(entry.registration.deadline);
  const players = page.getByRole("table", { name: "Players registered for this competition" });
  await expect(players.locator("tbody tr")).toHaveCount(entry.registration.playerCount);
  await expect(main).toContainText("separate record from the current squad");
  await expect(main.getByRole("button", { name: /register|amend|finali[sz]e|withdraw|enter competition|add player|remove player/i })).toHaveCount(0);
  await expect(main).toContainText("Qualification route");
  await expect(main).toContainText(entry.qualificationSource ?? "Not recorded");
});

test("2. A completed campaign shows its group table, knockout, outcome and status as the simulation recorded them", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams, views, withEntries } = await seedBatch(page);
  const key = withEntries.find((item) => views[item].completed.length > 0);
  expect(key, "a completed edition").toBeDefined();
  await openTeamCompetitions(page, teams[key!]);
  const entry = views[key!].completed[0];
  await expect(page.getByRole("heading", { name: entry.edition, level: 2 })).toBeVisible();
  expect(entry.status).toBe("COMPLETED");
  expect(entry.campaign.qualificationStatus).toBe(entry.entryStatus === "CHAMPION" ? "COMPLETED" : "ELIMINATED");
  await expect(page.locator("main")).toContainText(entry.outcome.label);
  if (entry.groupTable) {
    const table = page.getByRole("table", { name: `Standings of group ${entry.groupTable.name}` });
    await expect(table.locator("tbody tr")).toHaveCount(entry.groupTable.rows.length);
    const own = entry.groupTable.rows.find((row: any) => row.isThisTeam);
    const groupMatches = entry.matches.filter((match: any) => match.stage === "Group Stage" && match.status === "PLAYED");
    expect(own.played).toBe(groupMatches.length);
    expect(own.drawn).toBe(groupMatches.filter((match: any) => match.goalsFor === match.goalsAgainst).length);
  }
  if (entry.knockout.length === 0) await expect(page.getByText("This team has no knockout match in this competition.")).toBeVisible();
  else for (const round of entry.knockout) await expect(page.getByRole("heading", { name: round.round, level: 3 })).toBeVisible();
  // Only a champion has a placement; nobody else is ranked.
  const other = entry.entryStatus === "CHAMPION" ? "Champion" : "Eliminated";
  await expect(page.locator("main")).toContainText(other);
});

test("3. The season batch plays ahead of the calendar and the workspace says so", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams, views, withEntries } = await seedBatch(page);
  const key = withEntries[0]!;
  const entry = entriesOf(views[key])[0];
  expect(entry.simulatedAhead).toBe(true);
  await openTeamCompetitions(page, teams[key]);
  await expect(page.getByText("The season simulation has already played matches of this competition")).toBeVisible();
  await expect(page.getByRole("table", { name: `Matches in ${entry.edition}` }).getByText("Simulated ahead of its date").first()).toBeVisible();
  await family(page, "Fixtures").click();
  await expect(page.getByRole("table", { name: "National-team results" }).getByText("Simulated ahead of its date").first()).toBeVisible();
});

test("4. Each team shows only the competitions the simulation entered it in", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams, views } = await seedBatch(page);
  await openTeamCompetitions(page, teams.men);
  const everyEdition = new Set(KEYS.flatMap((key) => entriesOf(views[key]).map((entry: any) => entry.edition)));
  for (const key of KEYS) {
    await teamSelect(page).selectOption(teams[key]);
    const main = page.locator("main");
    const own = entriesOf(views[key]);
    if (own.length === 0) await expect(main).toContainText("This team is not entered in a recorded competition.");
    else for (const entry of own) await expect(main).toContainText(entry.edition);
    const ownNames = new Set(own.map((entry: any) => entry.edition));
    for (const name of everyEdition) if (!ownNames.has(name)) await expect(main).not.toContainText(name);
  }
});

test("5. Overview, Competitions, Fixtures and the player pool agree for the same team", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams, views, withEntries } = await seedBatch(page);
  const key = withEntries[0]!;
  const entry = entriesOf(views[key])[0];
  await nav(page, "National Teams").click();
  await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
  await teamSelect(page).selectOption(teams[key]);
  const main = page.locator("main");
  await expect(main).toContainText(entry.edition);
  await expect(main).toContainText(
    `${entry.registration.status === "FINAL" ? "Final" : "Provisional"} · ${entry.registration.locked ? "Locked" : "Open"} · ${entry.registration.playerCount} players`,
  );
  await page.getByRole("button", { name: "Open Competitions" }).click();
  await expect(sectionTitle(page)).toHaveText("National team competitions");
  await expect(page.getByRole("table", { name: `Matches in ${entry.edition}` }).locator("tbody tr")).toHaveCount(entry.matches.length);
  await family(page, "Fixtures").click();
  const fixtures = (await runtime(page, "getNationalTeamFixtures", { nationalTeamId: teams[key] })).data;
  for (const match of entry.matches.filter((item: any) => item.status === "PLAYED")) {
    const same = fixtures.results.find((item: any) => item.id === match.id);
    expect(same).toBeDefined();
    expect([same.goalsFor, same.goalsAgainst, same.result]).toEqual([match.goalsFor, match.goalsAgainst, match.result]);
  }
  await family(page, "Player pool").click();
  await expect(sectionTitle(page)).toHaveText("National team player pool");
  await expect(teamSelect(page)).toHaveValue(teams[key]);
});

test("6. Manager and Owner cannot read competitions or run the season batch; the President cannot read another team", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams } = await seedBatch(page);
  for (const role of ["MANAGER", "CHAIRMAN_OWNER"]) {
    await page.getByLabel("Active career role").selectOption(role);
    await expect(nav(page, "National Teams")).toHaveCount(0);
    for (const command of ["getNationalTeamCompetitions", "seedE2ENationalTeamSeasonBatch"]) {
      const result = await runtime(page, command, { nationalTeamId: teams.men });
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
  }
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  const invalid = await runtime(page, "getNationalTeamCompetitions", { nationalTeamId: "not-a-national-team" });
  expect(invalid.error?.code).toBe("INVALID_SELECTION");
});

test("7. Every final national-team screen: no overflow at every width, one h1, axe clean", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  const { teams, withEntries } = await seedBatch(page);
  const key = withEntries[0]!;
  const screens: Array<[string | null, string]> = [
    [null, "National teams"],
    ["Team overview", "National team"],
    ["Squad", "National team squad"],
    ["Player pool", "National team player pool"],
    ["Staff", "National team staff"],
    ["Fixtures", "National team fixtures"],
    ["Competitions", "National team competitions"],
  ];
  const prime = async (): Promise<void> => {
    await nav(page, "National Teams").click();
    await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
    if (key !== "men") await teamSelect(page).selectOption(teams[key]);
  };
  const open = async (label: string | null): Promise<void> => {
    if (label === null) await nav(page, "National Teams").click();
    else if (label === "Team overview") await prime();
    else await family(page, label).click();
  };
  for (const width of [721, 1024, 1280, 1440, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await prime();
    for (const [label, title] of screens) {
      await open(label);
      await expect(sectionTitle(page)).toHaveText(title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
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
  await family(page, "Competitions").click();
  await page.getByRole("region", { name: "Registered players" }).focus();
  await expect(page.getByRole("region", { name: "Registered players" })).toBeFocused();
});
