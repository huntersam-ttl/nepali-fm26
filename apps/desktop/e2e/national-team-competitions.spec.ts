import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createExistingClubOwner } from "./support/owner-harness.js";

/**
 * Phase 10C — national-team competitions. The gated fixture runs three real
 * editions through the simulation's own functions: a completed senior men's SAFF
 * Championship (with the campaign and final squad registration the simulation writes), a
 * partly played Under-23 edition and a planned senior women's edition. Under-20
 * and Under-17 have no competition, which is what the isolation checks rely on.
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
const seedCompetitions = async (page: Page): Promise<Teams> => {
  const seeded = await runtime(page, "seedE2ENationalTeamCompetitionFixture");
  expect(seeded.ok, JSON.stringify(seeded.error)).toBe(true);
  return seeded.data as Teams;
};

const openCompetitions = async (page: Page, team = "Nepal Senior Men"): Promise<void> => {
  await nav(page, "National Teams").click();
  await expect(sectionTitle(page)).toHaveText("National teams");
  await page.getByRole("button", { name: new RegExp(`^Open ${team} \\(`) }).click();
  await family(page, "Competitions").click();
  await expect(sectionTitle(page)).toHaveText("National team competitions");
};

const competitions = async (page: Page, teamId: string) =>
  (await runtime(page, "getNationalTeamCompetitions", { nationalTeamId: teamId })).data;

test("1. Senior Men's Competitions shows the real completed edition with its stage, outcome and rules", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  await openCompetitions(page);
  const view = await competitions(page, teams.men);
  expect(view.completed).toHaveLength(1);
  expect(view.active).toHaveLength(0);
  const saff = view.completed[0];
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const completed = page.getByRole("table", { name: "Completed competitions of this national team" });
  await expect(completed).toContainText(saff.edition);
  await expect(completed).toContainText(saff.outcome.label);
  await expect(page.getByRole("table", { name: "Active competitions of this national team" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: saff.edition, level: 2 })).toBeVisible();
  const stages = page.getByRole("table", { name: "Stages of this competition and their recorded rules" });
  for (const stage of saff.stages) await expect(stages).toContainText(stage.name);
  await expect(page.locator("main")).toContainText("Qualification route");
  await expect(page.locator("main")).toContainText("Not recorded");
  expect(await page.locator("main").innerText()).not.toMatch(/\b(probability|chance to qualify|odds|seed rating|strength)\b/i);
});

test("2. The group table shows the exact standings, and the team's row agrees with its own matches", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  await openCompetitions(page);
  const saff = (await competitions(page, teams.men)).completed[0];
  const table = page.getByRole("table", { name: `Standings of group ${saff.groupTable.name}` });
  await expect(table.locator("tbody tr")).toHaveCount(saff.groupTable.rows.length);
  for (const [index, row] of (saff.groupTable.rows as any[]).entries()) {
    const cells = table.locator("tbody tr").nth(index);
    await expect(cells).toContainText(row.team);
    const numbers = (await cells.locator("td").allInnerTexts()).slice(1).map((value) => value.trim());
    expect(numbers).toEqual([row.played, row.won, row.drawn, row.lost, row.goalsFor, row.goalsAgainst, row.goalDifference, row.points].map(String));
  }
  await expect(table).toContainText("(this team)");
  await expect(page.locator("main")).toContainText(`The top ${saff.groupTable.advanceCount} of each group advance`);
  await expect(page.getByText("Advancing place")).toHaveCount(saff.groupTable.advanceCount);

  // The team's own row matches its own group matches, whichever side it was drawn on.
  const own = saff.groupTable.rows.find((row: any) => row.isThisTeam);
  const groupMatches = saff.matches.filter((match: any) => match.stage === "Group Stage" && match.status === "PLAYED");
  expect(own.played).toBe(groupMatches.length);
  expect(own.won).toBe(groupMatches.filter((match: any) => match.result === "WIN").length);
  expect(own.drawn).toBe(groupMatches.filter((match: any) => match.result === "DRAW").length);
  expect(own.lost).toBe(groupMatches.filter((match: any) => match.result === "LOSS").length);
});

test("3. Knockout state is listed by round when the team reached it, and stated plainly when it did not", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  await openCompetitions(page);
  const saff = (await competitions(page, teams.men)).completed[0];
  if (saff.knockout.length === 0) {
    await expect(page.getByText("This team has no knockout match in this competition.")).toBeVisible();
    expect(saff.outcome.stageReached).toBe("Group Stage");
    return;
  }
  for (const round of saff.knockout) {
    await expect(page.getByRole("heading", { name: round.round, level: 3 })).toBeVisible();
    const matches = page.getByRole("table", { name: `${round.round} matches` });
    await expect(matches.locator("tbody tr")).toHaveCount(round.matches.length);
    for (const match of round.matches) await expect(matches).toContainText(match.opponent);
  }
  expect(["CHAMPION", "ELIMINATED"]).toContain(saff.outcome.key);
});

test("4. Registration is a separate, read-only record with its deadline, lock state and linked players", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  await openCompetitions(page);
  const saff = (await competitions(page, teams.men)).completed[0];
  const registration = saff.registration;
  expect(registration.status).toBe("FINAL");
  expect(registration.locked).toBe(true);
  const main = page.locator("main");
  await expect(main).toContainText("Final");
  await expect(main).toContainText("Locked");
  await expect(main).toContainText(registration.deadline);
  await expect(main).toContainText("separate record from the current squad");
  const players = page.getByRole("table", { name: "Players registered for this competition" });
  await expect(players.locator("tbody tr")).toHaveCount(registration.playerCount);
  await expect(main.getByRole("button", { name: /register|amend|finali[sz]e|withdraw|enter competition|add player|remove player/i })).toHaveCount(0);

  // A registered player opens their page; Back returns to the same competition.
  const name = registration.players[0].player.label as string;
  await players.getByRole("button", { name, exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("National team competitions");
  await expect(page.getByRole("table", { name: "Players registered for this competition" })).toBeVisible();

  // Navigating away and back shows the same registration.
  await family(page, "Squad").click();
  await family(page, "Competitions").click();
  await expect(page.getByRole("table", { name: "Players registered for this competition" }).locator("tbody tr")).toHaveCount(registration.playerCount);
});

test("5. Each team sees only its own competitions and registration", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  await openCompetitions(page);
  const main = page.locator("main");
  const men = await competitions(page, teams.men);
  await expect(main).toContainText(men.completed[0].edition);
  await expect(main).toContainText("Squad registration");

  await teamSelect(page).selectOption({ label: "Nepal Senior Women (Women & girls)" });
  const women = await competitions(page, teams.women);
  await expect(page.getByRole("table", { name: "Upcoming competitions of this national team" })).toContainText(women.upcoming[0].edition);
  await expect(main).not.toContainText(men.completed[0].edition);
  await expect(main).toContainText("Not started");
  await expect(main).toContainText("No squad registration is recorded for this competition. Deadline: Not recorded.");
  await expect(main).toContainText("This team has no knockout match in this competition.");

  await teamSelect(page).selectOption({ label: "Nepal U23 Men (Youth · U23)" });
  const u23 = await competitions(page, teams.u23);
  await expect(page.getByRole("table", { name: "Active competitions of this national team" })).toContainText(u23.active[0].edition);
  await expect(main).not.toContainText(women.upcoming[0].edition);
  await expect(main).toContainText("Competing in");

  for (const label of ["Nepal U20 Men (Youth · U20)", "Nepal U17 Men (Youth · U17)"]) {
    await teamSelect(page).selectOption({ label });
    await expect(main).toContainText("This team is not entered in a recorded competition.");
    await expect(main).not.toContainText("SAFF");
  }

  // The chosen team follows the sections.
  await family(page, "Fixtures").click();
  await expect(teamSelect(page)).toHaveValue(teams.u17);
});

test("6. Overview links to Competitions, and Back returns to the same team", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  await nav(page, "National Teams").click();
  await page.getByRole("button", { name: /^Open Nepal U23 Men \(/ }).click();
  await expect(sectionTitle(page)).toHaveText("National team");
  await page.getByRole("button", { name: "Open Competitions" }).click();
  await expect(sectionTitle(page)).toHaveText("National team competitions");
  const u23 = await competitions(page, teams.u23);
  await expect(page.getByRole("heading", { name: u23.active[0].edition, level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(sectionTitle(page)).toHaveText("National team");
  await expect(page.getByRole("heading", { name: "Nepal U23 Men", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Go forward" }).click();
  await expect(sectionTitle(page)).toHaveText("National team competitions");
  await expect(teamSelect(page)).toHaveValue(teams.u23);
});

test("7. Competition matches read the same on Competitions and Fixtures, from the team's side", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  const saff = (await competitions(page, teams.men)).completed[0];
  const fixtures = (await runtime(page, "getNationalTeamFixtures", { nationalTeamId: teams.men })).data;
  for (const match of saff.matches.filter((item: any) => item.status === "PLAYED")) {
    const same = fixtures.results.find((item: any) => item.id === match.id);
    expect(same, `${match.opponent} is on the Fixtures read`).toBeDefined();
    expect([same.goalsFor, same.goalsAgainst, same.result, same.venueSide]).toEqual([match.goalsFor, match.goalsAgainst, match.result, match.venueSide]);
  }
  await openCompetitions(page);
  const matches = page.getByRole("table", { name: `Matches in ${saff.edition}` });
  await expect(matches.locator("tbody tr")).toHaveCount(saff.matches.length);
  await family(page, "Fixtures").click();
  const results = page.getByRole("table", { name: "National-team results" });
  for (const match of saff.matches.filter((item: any) => item.status === "PLAYED")) await expect(results).toContainText(match.opponent);
});

test("8. Manager and Owner cannot read competitions; the President cannot read another team", async ({ page }) => {
  test.setTimeout(600_000);
  await becomePresident(page);
  const teams = await seedCompetitions(page);
  for (const role of ["MANAGER", "CHAIRMAN_OWNER"]) {
    await page.getByLabel("Active career role").selectOption(role);
    await expect(nav(page, "National Teams")).toHaveCount(0);
    for (const command of ["getNationalTeamCompetitions", "seedE2ENationalTeamCompetitionFixture"]) {
      const result = await runtime(page, command, { nationalTeamId: teams.men });
      expect(result.ok, `${command} as ${role}`).toBe(false);
      expect(result.error?.code, `${command} as ${role}`).toBe("ROLE_NOT_AUTHORIZED");
    }
  }
  await page.getByLabel("Active career role").selectOption("FEDERATION_PRESIDENT");
  const invalid = await runtime(page, "getNationalTeamCompetitions", { nationalTeamId: "not-a-national-team" });
  expect(invalid.ok).toBe(false);
  expect(invalid.error?.code).toBe("INVALID_SELECTION");
});

test("9. Every national-team screen with competitions: no overflow at every width, one h1, axe clean", async ({ page }) => {
  test.setTimeout(900_000);
  await becomePresident(page);
  await seedCompetitions(page);
  const screens: Array<[string | null, string]> = [
    [null, "National teams"],
    ["Team overview", "National team"],
    ["Fixtures", "National team fixtures"],
    ["Competitions", "National team competitions"],
  ];
  const prime = async (): Promise<void> => {
    await nav(page, "National Teams").click();
    await page.getByRole("button", { name: /^Open Nepal Senior Men \(/ }).click();
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
  // Wide tables scroll in their own focusable region.
  await family(page, "Competitions").click();
  await page.getByRole("region", { name: "Registered players" }).focus();
  await expect(page.getByRole("region", { name: "Registered players" })).toBeFocused();
});
