import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  InternationalFootballRepository,
  ManagerRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  advanceInternationalCompetition,
  calculateSimulationWorldRanking,
  createInternationalCompetitionEdition,
  createNepalSave,
  fastExternalMatch,
  getNationalTeamHistory,
  initializeInternationalFootballForSave,
  runInternationalDiagnostic,
  runNationalTeamCamp,
  scheduleInternationalFixtures,
  seedInternationalDraw,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-international-"));
  tempDirs.push(dir);
  return join(dir, "international.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `International ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("international football foundation", () => {
  it("creates lightweight external national teams, confederations and rankings", () => {
    const db = openGameDatabase(createSave("registry"));
    initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "registry" });
    const repo = new InternationalFootballRepository(db);
    const teams = repo.teamProfiles();
    const nepal = teams.find((team) => team.name === "Nepal Senior Men")!;

    expect(teams.length).toBeGreaterThan(20);
    expect(teams.map((team) => team.confederation)).toContain("AFC");
    expect(teams.map((team) => team.confederation)).toContain("UEFA");
    expect(nepal.region).toBe("SAFF");
    expect(nepal.nationalTeamId).toBeTruthy();
    expect(repo.developmentProfiles().length).toBeGreaterThan(20);
    expect(calculateSimulationWorldRanking(db, "2026-08-01")[0]?.rank).toBe(1);
    expect(
      repo.rankings("2026-08-01").find((ranking) => ranking.teamProfileId === nepal.id),
    ).toBeTruthy();
    db.close();
  });

  it("runs deterministic SAFF draw, group stage, knockout and history", () => {
    const db = openGameDatabase(createSave("saff"));
    const edition = createInternationalCompetitionEdition(db, {
      competitionKey: "SAFF",
      cycle: "2028",
      startDate: "2028-09-01",
      seed: "saff",
    });
    const repo = new InternationalFootballRepository(db);
    const groupStage = repo.stages(edition.id)[0]!;
    const draw = seedInternationalDraw(db, edition.id, groupStage.id, "2028-08-15", "saff");
    const fixtures = scheduleInternationalFixtures(db, edition.id, groupStage.id, "saff");
    const result = advanceInternationalCompetition(db, edition.id, "saff");
    const history = getNationalTeamHistory(db);

    expect(draw.groups.length).toBe(2);
    expect(fixtures.length).toBeGreaterThan(6);
    expect(result.edition.status).toBe("COMPLETED");
    expect(result.champion?.name).toContain("Senior Men");
    expect(
      repo.participants(edition.id).some((participant) => participant.finalPlacement === 1),
    ).toBe(true);
    expect(history.matches.length).toBeGreaterThan(0);
    expect(history.capsLeaders.length).toBeGreaterThan(0);
    expect(history.topScorers.some((row) => row.goals > 0)).toBe(true);

    // Nepal's SAFF matches route through simulateNepalInternationalMatch,
    // which now resolves (and persists) a real tactical setup for the
    // national team via the same resolver every club uses — never
    // tactics-blind, and never a fixed default when manager/team context
    // exists.
    const nepal = new InternationalFootballRepository(db)
      .teamProfiles()
      .find((team) => team.name === "Nepal Senior Men")!;
    const setups = new ManagerRepository(db).tacticalSetups(nepal.nationalTeamId!);
    expect(setups.length).toBeGreaterThan(0);
    expect(setups[0]!.assignments.length).toBeGreaterThan(0);
    db.close();
  });

  it("supports Asian and World qualification architecture plus club-country duty windows", () => {
    const db = openGameDatabase(createSave("qualification"));
    const asian = createInternationalCompetitionEdition(db, {
      competitionKey: "ASIAN_CUP_QUALIFICATION",
      cycle: "2031",
      startDate: "2031-03-20",
      seed: "qualification",
    });
    const world = createInternationalCompetitionEdition(db, {
      competitionKey: "AFC_WORLD_CUP_QUALIFICATION",
      cycle: "2034",
      startDate: "2033-10-08",
      seed: "qualification",
    });

    advanceInternationalCompetition(db, asian.id, "qualification:asian");
    advanceInternationalCompetition(db, world.id, "qualification:world");

    const repo = new InternationalFootballRepository(db);
    expect(repo.stages(asian.id).map((stage) => stage.formatType)).toContain("GROUP_STAGE");
    expect(repo.stages(world.id).some((stage) => stage.allowPenalties)).toBe(true);
    expect(repo.duties().length).toBeGreaterThan(0);
    expect(
      repo.matches().filter((match) => match.editionId === asian.id || match.editionId === world.id)
        .length,
    ).toBeGreaterThan(0);
    db.close();
  });

  it("keeps external-vs-external simulation deterministic including knockout penalties", () => {
    const db = openGameDatabase(createSave("external"));
    initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed: "external" });
    const repo = new InternationalFootballRepository(db);
    const japan = repo.teamProfiles().find((team) => team.name === "Japan Senior Men")!;
    const korea = repo.teamProfiles().find((team) => team.name === "South Korea Senior Men")!;

    const first = fastExternalMatch(japan, korea, {
      seed: "external",
      date: "2030-06-01",
      importance: "CONTINENTAL",
      knockout: true,
    });
    const second = fastExternalMatch(japan, korea, {
      seed: "external",
      date: "2030-06-01",
      importance: "CONTINENTAL",
      knockout: true,
    });

    expect(second).toEqual(first);
    expect(first.homeGoals + first.awayGoals).toBeGreaterThanOrEqual(0);
    expect(first.winnerTeamProfileId).toBeTruthy();
    db.close();
  });

  it("integrates international football into career saves and preserves history after reload", () => {
    const databasePath = createSave("career-international");
    const db = openGameDatabase(databasePath);
    const report = simulateNepalCareer({
      db,
      seasons: 2,
      seed: "career-international",
      internationalEnabled: true,
    });
    expect(report.worldDate).toBe("2028-07-31");
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const repo = new InternationalFootballRepository(reloaded);
    const federationRepo = new FederationGovernanceRepository(reloaded);
    expect(repo.matches().filter((match) => match.status === "PLAYED").length).toBeGreaterThan(0);
    expect(repo.rankings().length).toBeGreaterThan(0);
    expect(federationRepo.nationalTeamAppearances().length).toBeGreaterThan(0);
    expect(getNationalTeamHistory(reloaded).records.longestUnbeatenRun).toBeGreaterThanOrEqual(0);
    reloaded.close();
  });

  it("is deterministic for same-seed diagnostics", () => {
    const firstDb = openGameDatabase(createSave("deterministic-a"));
    const secondDb = openGameDatabase(createSave("deterministic-b"));
    const first = runInternationalDiagnostic({
      db: firstDb,
      startDate: "2026-08-01",
      years: 4,
      seed: "same-seed",
    });
    const second = runInternationalDiagnostic({
      db: secondDb,
      startDate: "2026-08-01",
      years: 4,
      seed: "same-seed",
    });

    expect(second.matches).toBe(first.matches);
    expect(second.wins).toBe(first.wins);
    expect(second.rankingEnd).toBe(first.rankingEnd);
    expect(second.externalOpponentsUsed).toEqual(first.externalOpponentsUsed);
    const firstRepo = new InternationalFootballRepository(firstDb);
    const camps = firstRepo.camps();
    expect(camps.length).toBeGreaterThan(0);
    expect(firstRepo.cohesion(camps[0]!.nationalTeamId).length).toBeGreaterThan(0);
    expect(
      firstDb
        .prepare("SELECT COUNT(*) AS count FROM historical_events WHERE event_type = ?")
        .get("NATIONAL_TEAM_CAMP_COMPLETED") as { count: number },
    ).toHaveProperty("count", camps.length);
    const camp = camps[0]!;
    const historyBefore = firstDb
      .prepare("SELECT COUNT(*) AS count FROM historical_events WHERE event_type = ?")
      .get("NATIONAL_TEAM_CAMP_COMPLETED") as { count: number };
    const ledgerBefore = new FederationGovernanceRepository(firstDb)
      .ledgerEntries(camp.federationId)
      .filter((entry) => entry.relatedEntityId === camp.id);
    runNationalTeamCamp(firstDb, {
      federationId: camp.federationId,
      nationalTeamId: camp.nationalTeamId,
      competitionEditionId: camp.competitionEditionId,
      startDate: camp.startDate,
      endDate: camp.endDate,
      focus: camp.focus,
      seed: "replay",
    });
    const historyAfter = firstDb
      .prepare("SELECT COUNT(*) AS count FROM historical_events WHERE event_type = ?")
      .get("NATIONAL_TEAM_CAMP_COMPLETED") as { count: number };
    const ledgerAfter = new FederationGovernanceRepository(firstDb)
      .ledgerEntries(camp.federationId)
      .filter((entry) => entry.relatedEntityId === camp.id);
    expect(historyAfter.count).toBe(historyBefore.count);
    expect(ledgerAfter.length).toBe(ledgerBefore.length);
    firstDb.close();
    secondDb.close();
  });
});
