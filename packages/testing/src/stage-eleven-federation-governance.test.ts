import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  CompetitionRepository,
  FederationGovernanceRepository,
  WorldRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { CompetitionRuleSet, EntityId } from "@nepal-football-sim/shared-types";
import {
  applyCompetitionReform,
  createNepalSave,
  distributeClubGrant,
  federationPresidentPermissions,
  getFederationOverview,
  initializeClubEconomyForSave,
  initializeFederationGovernanceForSave,
  playNationalTeamFixture,
  proposeCompetitionReform,
  runFederationDiagnostic,
  runFederationPresidentDemo,
  scheduleFriendly,
  selectNationalTeamSquad,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-federation-"));
  tempDirs.push(dir);
  return join(dir, "federation.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Federation ${seed}`,
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

describe("federation governance foundation", () => {
  it("creates ANFA simulation profile, finances, budgets, committees, national teams and relationships", () => {
    const db = openGameDatabase(createSave("foundation"));
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "foundation" });
    const federationId = firstFederationId(db);
    const overview = getFederationOverview(db, federationId);
    const teams = db
      .prepare("SELECT * FROM teams WHERE federation_id = ? ORDER BY name")
      .all(federationId) as Array<{ name: string }>;

    expect(overview.profile.status).toBe("SIMULATION_ONLY");
    expect(overview.account.status).toBe("SIMULATION_ONLY");
    expect(overview.budgets.some((budget) => budget.category === "YOUTH_DEVELOPMENT")).toBe(true);
    expect(overview.committees.map((committee) => committee.committeeType)).toContain(
      "REFEREE_COMMITTEE",
    );
    expect(overview.strategy.length).toBeGreaterThan(3);
    expect(teams.map((team) => team.name)).toContain("Nepal Senior Men");
    expect(
      new FederationGovernanceRepository(db).organisationRelationships(federationId),
    ).toHaveLength(5);
    db.close();
  });

  it("keeps personal, club and federation money separate while distributing club grants", () => {
    const db = openGameDatabase(createSave("grant-separation"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "grant-separation" });
    initializeFederationGovernanceForSave({
      db,
      worldDate: "2026-08-01",
      seed: "grant-separation",
    });
    const federationId = firstFederationId(db);
    const clubId = clubIdByName(db, "Machhindra FC");
    const repo = new FederationGovernanceRepository(db);
    const beforeFed = repo.financialAccount(federationId)!.cashBalance;
    const beforeClub = new ClubEconomyRepository(db).financialAccount(clubId)!.cashBalance;

    const grant = distributeClubGrant(db, {
      federationId,
      clubId,
      date: "2026-09-01",
      amount: 350000,
      grantType: "ACADEMY_GRANT",
    });

    expect(repo.financialAccount(federationId)!.cashBalance).toBe(beforeFed - 350000);
    expect(new ClubEconomyRepository(db).financialAccount(clubId)!.cashBalance).toBe(
      beforeClub + 350000,
    );
    expect(
      repo.ledgerEntries(federationId).find((entry) => entry.id === grant.federationLedgerEntryId)
        ?.direction,
    ).toBe("DEBIT");
    expect(
      new ClubEconomyRepository(db)
        .ledgerEntries(clubId)
        .find((entry) => entry.id === grant.clubLedgerEntryId)?.category,
    ).toBe("GRANT");
    expect(new ClubEconomyRepository(db).personalFinancialProfile(federationId)).toBeUndefined();
    db.close();
  });

  it("runs a president demo with explicit permissions and no club tactical authority", () => {
    const db = openGameDatabase(createSave("president-demo"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "president-demo" });
    const demo = runFederationPresidentDemo({
      db,
      seed: "president-demo",
      worldDate: "2026-08-01",
    });
    const repo = new FederationGovernanceRepository(db);

    expect(
      repo
        .leadershipTenures(demo.federationId)
        .some((tenure) => tenure.role === "FEDERATION_PRESIDENT"),
    ).toBe(true);
    expect(demo.callups).toBeGreaterThanOrEqual(20);
    expect(repo.projects(demo.federationId).map((project) => project.id)).toContain(demo.projectId);
    expect(
      repo.competitionReforms(demo.federationId).find((reform) => reform.id === demo.reformId)
        ?.status,
    ).toBe("IMPLEMENTED");
    expect(federationPresidentPermissions()).toContain("COMPETITION_POLICY");
    expect(federationPresidentPermissions()).not.toContain("CLUB_TACTICS");
    db.close();
  });

  it("applies competition reform only to future seasons and preserves historical played seasons", () => {
    const db = openGameDatabase(createSave("competition-reform"));
    simulateNepalCareer({
      db,
      seasons: 1,
      seed: "competition-reform",
      transfersEnabled: false,
      youthEnabled: false,
      economyEnabled: false,
      federationEnabled: true,
    });
    const federationId = firstFederationId(db);
    const competition = competitionByName(db, "Martyr's Memorial A-Division League");
    const historicalSeason = firstSeasonForCompetition(db, competition.id);
    const historicalRule = new CompetitionRepository(db).getRuleSet(historicalSeason.id)!;
    const futureSeason = createFutureSeason(db, competition.id, "2032", historicalRule);
    const reform = proposeCompetitionReform(db, {
      federationId,
      competitionId: competition.id,
      effectiveSeason: "2032",
      changes: { teamCount: 16, rounds: 2, promotionSlots: 2, relegationSlots: 2 },
      proposedAt: "2027-08-01",
      decidedAt: "2027-08-01",
      status: "APPROVED",
    });

    applyCompetitionReform(db, reform.id, "2027-08-01");

    expect(new CompetitionRepository(db).getRuleSet(historicalSeason.id)?.numberOfRounds).toBe(
      historicalRule.numberOfRounds,
    );
    expect(new CompetitionRepository(db).getRuleSet(futureSeason.id)?.promotionSlots).toBe(2);
    expect(new CompetitionRepository(db).getRuleSet(futureSeason.id)?.relegationSlots).toBe(2);
    db.close();
  });

  it("makes high youth investment gradually improve the development environment more than low investment", () => {
    const low = openGameDatabase(createSave("low-youth"));
    const high = openGameDatabase(createSave("high-youth"));

    const lowReport = runFederationDiagnostic({
      db: low,
      seed: "youth-impact",
      startDate: "2026-08-01",
      seasons: 3,
      youthInvestment: "LOW",
    });
    const highReport = runFederationDiagnostic({
      db: high,
      seed: "youth-impact",
      startDate: "2026-08-01",
      seasons: 3,
      youthInvestment: "HIGH",
    });

    expect(highReport.youthEnvironment!.grassrootsReach).toBeGreaterThan(
      lowReport.youthEnvironment!.grassrootsReach,
    );
    expect(highReport.youthEnvironment!.talentConversion).toBeGreaterThan(
      lowReport.youthEnvironment!.talentConversion,
    );
    high.close();
    low.close();
  });

  it("selects a national squad, schedules a friendly, persists call-ups, caps, goals and reloads", () => {
    const path = createSave("national-team");
    const db = openGameDatabase(path);
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team" });
    const federationId = firstFederationId(db);
    const teamId = seniorMenTeamId(db, federationId);
    const callups = selectNationalTeamSquad(db, {
      federationId,
      nationalTeamId: teamId,
      date: "2026-09-01",
      programme: "Friendly test",
      seed: "national-team",
    });
    const fixture = scheduleFriendly(db, {
      federationId,
      nationalTeamId: teamId,
      opponentName: "Simulation Test XI",
      date: "2026-09-10",
      seed: "national-team",
    });
    const played = playNationalTeamFixture(db, fixture.id, "national-team");
    db.close();

    const reloaded = openGameDatabase(path);
    const repo = new FederationGovernanceRepository(reloaded);
    expect(callups.length).toBeGreaterThanOrEqual(20);
    expect(repo.nationalTeamFixtures(teamId).find((item) => item.id === played.id)?.status).toBe(
      "PLAYED",
    );
    expect(repo.nationalTeamAppearances(teamId).length).toBeGreaterThan(10);
    expect(repo.internationalEligibilities(federationId).length).toBeGreaterThan(100);
    reloaded.close();
  });

  it("is deterministic for same-seed federation diagnostics", () => {
    const first = openGameDatabase(createSave("deterministic-fed-a"));
    const second = openGameDatabase(createSave("deterministic-fed-b"));
    const firstReport = runFederationDiagnostic({
      db: first,
      seed: "deterministic-fed",
      startDate: "2026-08-01",
      seasons: 2,
    });
    const secondReport = runFederationDiagnostic({
      db: second,
      seed: "deterministic-fed",
      startDate: "2026-08-01",
      seasons: 2,
    });

    expect(stripVolatile(firstReport)).toEqual(stripVolatile(secondReport));
    first.close();
    second.close();
  });
});

const firstFederationId = (db: ReturnType<typeof openGameDatabase>): EntityId =>
  (db.prepare("SELECT id FROM federations ORDER BY name LIMIT 1").get() as { id: EntityId }).id;

const clubIdByName = (db: ReturnType<typeof openGameDatabase>, name: string): EntityId =>
  (db.prepare("SELECT id FROM clubs WHERE name = ?").get(name) as { id: EntityId }).id;

const competitionByName = (
  db: ReturnType<typeof openGameDatabase>,
  name: string,
): { id: EntityId; name: string } =>
  db.prepare("SELECT id, name FROM competitions WHERE name = ? LIMIT 1").get(name) as {
    id: EntityId;
    name: string;
  };

const firstSeasonForCompetition = (
  db: ReturnType<typeof openGameDatabase>,
  competitionId: EntityId,
): { id: EntityId; start_date: string; end_date: string; name: string } =>
  db
    .prepare(
      "SELECT * FROM competition_seasons WHERE competition_id = ? ORDER BY start_date LIMIT 1",
    )
    .get(competitionId) as { id: EntityId; start_date: string; end_date: string; name: string };

const createFutureSeason = (
  db: ReturnType<typeof openGameDatabase>,
  competitionId: EntityId,
  year: string,
  sourceRule: CompetitionRuleSet,
): { id: EntityId } => {
  const world = new WorldRepository(db);
  const competitions = new CompetitionRepository(db);
  const season = {
    id: `${competitionId}-${year}` as EntityId,
    competitionId,
    name: `Future Reform Season ${year}`,
    startDate: `${year}-01-01`,
    endDate: `${year}-07-31`,
  };
  world.insertCompetitionSeason(season);
  competitions.insertRuleSet({
    ...sourceRule,
    id: `${sourceRule.id}-${year}` as EntityId,
    competitionSeasonId: season.id,
    seasonStartDate: season.startDate,
    seasonEndDate: season.endDate,
  });
  return season;
};

const seniorMenTeamId = (
  db: ReturnType<typeof openGameDatabase>,
  federationId: EntityId,
): EntityId =>
  (
    db
      .prepare(
        "SELECT id FROM teams WHERE federation_id = ? AND level = 'senior' AND gender = 'men' LIMIT 1",
      )
      .get(federationId) as { id: EntityId }
  ).id;

const stripVolatile = (report: any): any => ({
  cashBalance: report.cashBalance,
  financialHealth: report.financialHealth,
  ledgerEntries: report.ledgerEntries,
  statements: report.statements,
  projects: report.projects,
  completedProjects: report.completedProjects,
  clubGrants: report.clubGrants,
  nationalTeamFixtures: report.nationalTeamFixtures,
  nationalTeamWins: report.nationalTeamWins,
  callups: report.callups,
  coachGraduates: report.coachGraduates,
  refereesAdvanced: report.refereesAdvanced,
  reforms: report.reforms,
  licensingAssessments: report.licensingAssessments,
  youthEnvironment: {
    footballPopularity: report.youthEnvironment?.footballPopularity,
    grassrootsReach: report.youthEnvironment?.grassrootsReach,
    coachingQuality: report.youthEnvironment?.coachingQuality,
    youthInfrastructure: report.youthEnvironment?.youthInfrastructure,
    talentConversion: report.youthEnvironment?.talentConversion,
  },
  kpis: report.kpis.map((kpi: any) => [kpi.metric, kpi.value]),
});
