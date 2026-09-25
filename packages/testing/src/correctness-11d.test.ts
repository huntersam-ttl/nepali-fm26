import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CareerWorldRepository,
  ClubEconomyRepository,
  CompetitionRepository,
  EventRepository,
  ManagerRepository,
  MediaPhaseBRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  BOARD_EVALUATION_INTERVAL_DAYS,
  DesktopApplicationService,
  createInternationalCompetitionEdition,
  createManagerContract,
  ensureADivisionTitleSponsorPackage,
  evaluateBoardConfidence,
  homeCountryId,
  homeFederationId,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type ManagerAttributeSet, type Team } from "@nepal-football-sim/shared-types";

/*
 * Phase 11D: known correctness defects. Country lookups resolve against the real world, regional
 * hosts exist, title sponsors come from the right competition, boards judge managers monthly,
 * and the hot Continue reads return exactly what the broad reads returned.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

const withDb = <T,>(path: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(path);
  migrateDatabase(db);
  try {
    return run(db);
  } finally {
    db.close();
  }
};

let savePath = "";
beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "correctness-"));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const created = service.createCareer({
    saveName: "correctness",
    character: {
      fullName: "Correctness Tester",
      dateOfBirth: "1985-01-01",
      startingAge: 41,
      languages: ["en"],
      footballBackground: "COMMUNITY_COACHING",
      education: "SPORTS_RELATED_DEGREE",
      playingExperience: "AMATEUR_PLAYER",
      coachingExperience: "YOUTH_COACH",
      businessBackground: "SMALL_BUSINESS",
      startingReputationProfile: "LOCAL_RESPECTED",
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  savePath = created.data.catalogEntry.filePath;
  service.closeCareer();
}, 240_000);

const copyOfSave = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "correctness-copy-"));
  dirs.push(directory);
  const path = join(directory, "copy.sqlite");
  copyFileSync(savePath, path);
  return path;
};

describe("country lookups resolve against the real world", () => {
  it("club economy resolves the home country: sponsors carry it", () => {
    withDb(savePath, (db) => {
      const home = homeCountryId(db)!;
      const row = db.prepare("SELECT COUNT(*) AS n FROM sponsor_organisations WHERE country_id = ?").get(home) as { n: number };
      expect(row.n, "the generated sponsor pool is in the home country").toBeGreaterThan(0);
      const orphans = db.prepare("SELECT COUNT(*) AS n FROM sponsor_organisations WHERE country_id IS NULL").get() as { n: number };
      expect(orphans.n, "no sponsor is left without a country").toBe(0);
    });
  });

  it("a regional edition is hosted by a country that exists, and Nepal (the home country) hosts the SAFF", () => {
    const path = copyOfSave();
    withDb(path, (db) => {
      const edition = createInternationalCompetitionEdition(db, { competitionKey: "SAFF", cycle: "2027", startDate: "2027-03-01", seed: "host-test" });
      expect(edition.hostCountryIds).toEqual([homeCountryId(db)]);
      for (const id of edition.hostCountryIds) expect(db.prepare("SELECT 1 AS present FROM countries WHERE id = ?").get(id)).toBeDefined();
      const asian = createInternationalCompetitionEdition(db, { competitionKey: "ASIAN_CUP", cycle: "2028", startDate: "2028-01-01", seed: "host-test" });
      for (const id of asian.hostCountryIds) expect(db.prepare("SELECT 1 AS present FROM countries WHERE id = ?").get(id)).toBeDefined();
      const participants = db
        .prepare("SELECT entry_status AS status FROM international_competition_participants p JOIN international_team_profiles t ON t.id = p.team_profile_id WHERE p.edition_id = ? AND t.country_id = ?")
        .all(edition.id, homeCountryId(db)) as Array<{ status: string }>;
      for (const participant of participants) expect(participant.status).toBe("HOST");
    });
  });
});

describe("title sponsors come from the correct competition", () => {
  it("picks the division by its place in the pyramid, not its name, and never the duplicate without seasons", () => {
    const path = copyOfSave();
    withDb(path, (db) => {
      const federationId = homeFederationId(db);
      const real = db.prepare("SELECT t.competition_id AS id FROM competition_tiers t WHERE t.tier = 1").get() as { id: EntityId };
      db.exec("UPDATE competitions SET name = 'Zzz A-Division Duplicate' WHERE name LIKE '%A-Division%'");
      db.prepare("UPDATE competitions SET name = 'Premier Tier One' WHERE id = ?").run(real.id);
      const pack = ensureADivisionTitleSponsorPackage(db, federationId, "2026-09-01");
      expect(pack.name).toBe("Premier Tier One Title Sponsor");
    });
  });
});

/** A minimal world with one managed club, for the board's evaluation cadence. */
const attributes = (n: number): ManagerAttributeSet => ({
  tactical: { tacticalKnowledge: n, adaptability: n, matchManagement: n, setPieceKnowledge: n },
  coaching: { attackingCoaching: n, defensiveCoaching: n, technicalCoaching: n, mentalCoaching: n, fitnessUnderstanding: n, youthDevelopment: n },
  people: { manManagement: n, motivation: n, discipline: n, communication: n },
  recruitment: { playerJudgement: n, potentialJudgement: n },
  personality: { reputation: n, mediaHandling: n, pressureHandling: n, professionalism: n, ambition: n, loyalty: n },
});
const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "board-test"),
  name: "Board Test",
  worldDate,
  databaseVersion: 20,
  gameVersion: "test",
  randomSeed: "board-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});
const addDay = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const boardWorld = (expectation: string) => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const country = { id: createStableEntityId("country", "BW"), name: "Boardland", isoCode: "BW" };
  world.insertCountry(country);
  const competitionId = createStableEntityId("competition", "board-league");
  const seasonId = createStableEntityId("season", "board-league-2026");
  world.insertCompetition({ id: competitionId, name: "Board League", scope: "domestic" });
  world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 Board League", startDate: "2026-08-01", endDate: "2027-05-31" });
  const teams: Team[] = [];
  for (let index = 0; index < 3; index += 1) {
    const club: Club = { id: createStableEntityId("club", `board-${index}`), name: `Board FC ${index}`, countryId: country.id, ownershipType: "PRIVATE" };
    const team: Team = { id: createStableEntityId("team", `board-${index}`), clubId: club.id, name: club.name, level: "senior", gender: "men" };
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClubMembership({ id: createStableEntityId("membership", `board-${index}`), clubId: club.id, teamId: team.id, competitionId, competitionSeasonId: seasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE" });
    new ClubEconomyRepository(db).upsertBoardPolicy({
      clubId: club.id, financialRiskTolerance: "BALANCED", transferPhilosophy: "BALANCED", youthPriority: 0.5, commercialPriority: 0.5, infrastructurePriority: 0.5,
      strategicObjective: expectation, updatedAt: "2026-08-01", status: "SIMULATION_ONLY",
    });
    new CompetitionRepository(db).upsertStanding({ competitionSeasonId: seasonId, teamId: team.id, played: 10, won: 9 - index * 4, drawn: 0, lost: 1 + index * 4, goalsFor: 20, goalsAgainst: 5 + index * 10, goalDifference: 15 - index * 10, points: 27 - index * 12 });
    teams.push(team);
  }
  const managers = new ManagerRepository(db);
  const contracts = teams.map((team, index) => {
    const personId = createStableEntityId("person", `board-manager-${index}`);
    world.insertPerson({ id: personId, fullName: `Manager ${index}`, nationalityCountryId: country.id, languages: ["en"] });
    const profile = { id: createStableEntityId("profile", `board-manager-${index}`), personId, attributes: attributes(8), reputationProfile: "LOCAL_RESPECTED" as const, createdOn: "2026-07-01" };
    managers.insertProfile(profile);
    const contract = createManagerContract({ managerProfileId: profile.id, personId, teamId: team.id, clubId: team.clubId, contractStart: "2026-08-01", contractEnd: "2028-08-01", salaryAmountMinor: 3_000_000 });
    managers.insertContract(contract);
    return contract;
  });
  return { db, teams, contracts };
};

describe("boards judge a manager on a fixed cadence, not every day", () => {
  const N = BOARD_EVALUATION_INTERVAL_DAYS;

  it("a bottom-table manager is not marked down every day; the swing arrives once per interval", () => {
    const { db, contracts } = boardWorld("TITLE_CHALLENGE");
    const bottom = contracts[2]!;
    const confidence = () => new CareerWorldRepository(db).boardConfidence(bottom.clubId!)?.confidence;
    evaluateBoardConfidence(db, saveAt("2026-08-01"));
    expect(confidence(), "a new contract starts at the default").toBe(60);
    const readings: number[] = [];
    for (let step = 1; step <= 2 * N + 5; step += 1) {
      evaluateBoardConfidence(db, saveAt(addDay("2026-08-01", step)));
      readings.push(confidence()!);
    }
    // readings[i] is the value on day i + 1: nothing moves until day N, then one swing per interval.
    expect(new Set(readings.slice(0, N - 1))).toEqual(new Set([60]));
    expect(readings[N - 1]).toBeLessThan(60);
    expect(new Set(readings.slice(N - 1, 2 * N - 1)).size).toBe(1);
    expect(readings[2 * N - 1]).toBeLessThan(readings[N - 1]!);
    expect(readings[2 * N + 4]).toBe(readings[2 * N - 1]);
    // A manager at the top of the table is never marked down.
    expect(new CareerWorldRepository(db).boardConfidence(contracts[0]!.clubId!)!.confidence).toBeGreaterThanOrEqual(60);
    db.close();
  });

  it("does not sack a bottom-table manager in the first two months, but does once the board has lost patience", () => {
    const { db, contracts } = boardWorld("TITLE_CHALLENGE");
    const bottom = contracts[2]!;
    let firstSacking: number | undefined;
    for (let step = 0; step <= 400 && firstSacking === undefined; step += 1) {
      evaluateBoardConfidence(db, saveAt(addDay("2026-08-01", step)));
      const row = db.prepare("SELECT status FROM manager_contracts WHERE id = ?").get(bottom.id) as { status: string };
      if (row.status === "SACKED") firstSacking = step;
    }
    expect(firstSacking, "a title-challenge board eventually loses patience with the bottom club").toBeDefined();
    expect(firstSacking!, "not inside the old two-month window").toBeGreaterThanOrEqual(70);
    expect(firstSacking!).toBeLessThan(250);
    db.close();
  });

  it("ignores a league table before five matches have been played", () => {
    const { db, contracts } = boardWorld("SURVIVE");
    db.exec("UPDATE league_standings SET played = 2");
    const bottom = contracts[2]!;
    for (let step = 0; step <= 3 * N; step += 1) evaluateBoardConfidence(db, saveAt(addDay("2026-08-01", step)));
    // With two matches played the table means nothing: mid-table treatment, so no mark-down.
    expect(new CareerWorldRepository(db).boardConfidence(bottom.clubId!)!.confidence).toBeGreaterThanOrEqual(60);
    db.close();
  });
});

describe("the hot Continue reads return what the broad reads returned", () => {
  it("single-row and bounded reads equal the filtered full reads", () => {
    const path = copyOfSave();
    withDb(path, (db) => {
      const events = new EventRepository(db);
      for (let index = 0; index < 5; index += 1) {
        events.insertHistoricalEvent({ id: createStableEntityId("history", `probe-${index}`), occurredOn: `2026-09-0${index + 1}`, eventType: "MILESTONE", involvedEntities: [], title: `Probe ${index}`, importance: "low", scope: "world" });
      }
      const all = events.historicalEvents();
      expect(events.historicalEventsUpTo("2026-09-03")).toEqual(all.filter((event) => event.occurredOn <= "2026-09-03"));
      expect(events.hasHistoricalEvent(createStableEntityId("history", "probe-2"))).toBe(true);
      expect(events.hasHistoricalEvent(createStableEntityId("history", "no-such-event"))).toBe(false);
      const interviews = new MediaPhaseBRepository(db);
      expect(interviews.interview("missing" as EntityId)).toBeUndefined();
      // The per-team availability index exists and the read stays ordered by person.
      expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'idx_player_availability_team'").get()).toEqual({ n: 1 });
    });
  });
});
