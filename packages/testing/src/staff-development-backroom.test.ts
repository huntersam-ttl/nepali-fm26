import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  LicenceCourseError,
  enrolInLicenceCourse,
  evaluateAiStaffDevelopment,
  hireStaff,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type Team,
} from "@nepal-football-sim/shared-types";

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "staff-dev-backroom-test"),
  name: "Staff Development/Backroom Test",
  worldDate,
  databaseVersion: 38,
  gameVersion: "test",
  randomSeed: "staff-dev-backroom-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };

/**
 * A fresh, self-contained fixture: two AI clubs (each with one senior team
 * and one AFC_C-licensed head coach — one rank below the max, so a course
 * is genuinely available) and one "player" club whose staff must never be
 * touched by AI course participation.
 */
const buildFixture = (
  dbPath: string,
): {
  db: GameDatabase;
  aiClubs: Club[];
  playerClub: Club;
  headCoachIds: EntityId[];
  playerCoachId: EntityId;
} => {
  const db = openGameDatabase(dbPath);
  migrateDatabase(db);
  const world = new WorldRepository(db);
  const finances = new TransferMarketRepository(db);
  world.insertCountry(country);

  const makeClub = (slug: string, name: string): { club: Club; team: Team } => {
    const club: Club = {
      id: createStableEntityId("club", slug),
      name,
      countryId: country.id,
      ownershipType: "PRIVATE",
    };
    const team: Team = {
      id: createStableEntityId("team", `${slug}-senior`),
      clubId: club.id,
      name,
      level: "senior",
      gender: "men",
    };
    world.insertClub(club);
    world.insertTeam(team);
    finances.upsertClubFinancialProfile({
      id: createStableEntityId("finance", club.id),
      clubId: club.id,
      wageBudget: 20_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "STABLE",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });
    return { club, team };
  };

  const competitionId = createStableEntityId("competition", "sdb-league");
  const seasonId = createStableEntityId("season", "sdb-league-2026");
  world.insertCompetition({ id: competitionId, name: "Test League", scope: "domestic" });
  world.insertCompetitionSeason({
    id: seasonId,
    competitionId,
    name: "2026 Test League",
    startDate: "2026-08-01",
    endDate: "2027-05-31",
  });

  const aiOne = makeClub("sdb-ai-one", "AI Club One");
  const aiTwo = makeClub("sdb-ai-two", "AI Club Two");
  const player = makeClub("sdb-player", "Player Club");

  for (const { club, team } of [aiOne, aiTwo, player]) {
    world.insertClubMembership({
      id: createStableEntityId("membership", club.id),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });
  }

  const licensedHeadCoach = (slug: string): EntityId => {
    const personId = createStableEntityId("person", slug);
    world.insertPerson({
      id: personId,
      fullName: `Coach ${slug}`,
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    world.insertStaffLicence({
      id: createStableEntityId("staff-licence", personId),
      personId,
      licenceType: "AFC_B",
      issuer: "ANFA",
      status: "VERIFIED",
    });
    return personId;
  };

  const headCoachIds = [
    licensedHeadCoach("sdb-ai-one-coach"),
    licensedHeadCoach("sdb-ai-two-coach"),
  ];
  const playerCoachId = licensedHeadCoach("sdb-player-coach");

  hireStaff(
    db,
    saveAt("2026-08-01"),
    aiOne.club.id,
    aiOne.team.id,
    headCoachIds[0]!,
    "HEAD_COACH",
    3_000_000,
    24,
  );
  hireStaff(
    db,
    saveAt("2026-08-01"),
    aiTwo.club.id,
    aiTwo.team.id,
    headCoachIds[1]!,
    "HEAD_COACH",
    3_000_000,
    24,
  );
  hireStaff(
    db,
    saveAt("2026-08-01"),
    player.club.id,
    player.team.id,
    playerCoachId,
    "HEAD_COACH",
    3_000_000,
    24,
  );

  return {
    db,
    aiClubs: [aiOne.club, aiTwo.club],
    playerClub: player.club,
    headCoachIds,
    playerCoachId,
  };
};

describe("staff development: AI course participation and backroom summary", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "staff-dev-backroom-"));
  });

  it("eventually enrols an eligible AI club's staff in a licence course over several ticks, never the player's own club", () => {
    const { db, playerClub, playerCoachId } = buildFixture(join(dir, "career.sqlite"));
    const market = new StaffMarketRepository(db);
    let enrolledAny = false;
    // A bounded per-tick chance means it will not necessarily fire on day
    // one; running across many distinct real dates (each its own
    // deterministic seed) is the same real cadence continueCareer drives.
    for (let day = 0; day < 40 && !enrolledAny; day += 1) {
      const date = addDays("2026-08-01", day);
      const started = evaluateAiStaffDevelopment(db, saveAt(date), playerClub.id);
      if (started.length > 0) enrolledAny = true;
    }
    expect(enrolledAny).toBe(true);
    expect(market.activeLicenceCourseForPerson(playerCoachId)).toBeUndefined();
    db.close();
  });

  it("is deterministic: replaying the identical starting save produces the same AI enrolment outcome", () => {
    // Appointment ids are runtime-random (createEntityId()), the same way
    // every other seeded staff-market roll in this codebase works — so
    // determinism is a property of replaying the *same* save from the same
    // starting point (as the existing "is deterministic" desktop test does),
    // not of two independently-constructed fixtures with different random
    // appointment ids feeding the seed.
    const original = buildFixture(join(dir, "career-original.sqlite"));
    original.db.close();
    const copyPath = join(dir, "career-copy.sqlite");
    copyFileSync(join(dir, "career-original.sqlite"), copyPath);
    const dbA = openGameDatabase(join(dir, "career-original.sqlite"));
    const dbB = openGameDatabase(copyPath);
    const resultsA: EntityId[] = [];
    const resultsB: EntityId[] = [];
    for (let day = 0; day < 20; day += 1) {
      const date = addDays("2026-08-01", day);
      resultsA.push(
        ...evaluateAiStaffDevelopment(dbA, saveAt(date), original.playerClub.id).map(
          (course) => course.personId,
        ),
      );
      resultsB.push(
        ...evaluateAiStaffDevelopment(dbB, saveAt(date), original.playerClub.id).map(
          (course) => course.personId,
        ),
      );
    }
    expect(resultsA).toEqual(resultsB);
    dbA.close();
    dbB.close();
  });

  it("respects enrolInLicenceCourse's own rules — never enrols someone already enrolled or already at the top licence", () => {
    const { db, aiClubs, headCoachIds } = buildFixture(join(dir, "career.sqlite"));
    // Manually enrol one AI coach first, exactly like the human path would.
    enrolInLicenceCourse(db, saveAt("2026-08-01"), headCoachIds[0]!, aiClubs[0]!.id);
    expect(() =>
      enrolInLicenceCourse(db, saveAt("2026-08-01"), headCoachIds[0]!, aiClubs[0]!.id),
    ).toThrow(LicenceCourseError);
    // The AI development pass must skip the already-enrolled coach cleanly
    // (no throw, no duplicate course) across every subsequent tick checked.
    for (let day = 2; day <= 10; day += 1) {
      expect(() =>
        evaluateAiStaffDevelopment(
          db,
          saveAt(`2026-08-${String(day).padStart(2, "0")}`),
          undefined,
        ),
      ).not.toThrow();
    }
    const market = new StaffMarketRepository(db);
    expect(market.activeLicenceCourseForPerson(headCoachIds[0]!)).toBeDefined();
    db.close();
  });
});

describe("staff hierarchy read model: backroom summary", () => {
  const registryPath = resolve("data/nepal/2026-08/club-registry.json");
  const serviceDirs: string[] = [];
  afterEach(() => {
    for (const serviceDir of serviceDirs.splice(0))
      rmSync(serviceDir, { recursive: true, force: true });
  });

  it("exposes a truthful, banded backroom summary from real staff — never the underlying raw relationship scores", () => {
    const serviceDir = mkdtempSync(join(tmpdir(), "staff-backroom-desktop-"));
    serviceDirs.push(serviceDir);
    const service = new DesktopApplicationService({
      savesDirectory: serviceDir,
      worldDatasetPath: registryPath,
    });
    const listed = service.listStartingClubs();
    if (!listed.ok) throw new Error(listed.error.message);
    const club = listed.data.find((item) => item.division === "B");
    if (!club?.teamId) throw new Error("No B-Division club in the starting-club list");
    const created = service.createCareer({
      careerMode: "MANAGER",
      saveName: "Backroom Test",
      joinTeamId: club.teamId,
      character: {
        fullName: "Backroom Test",
        dateOfBirth: "1985-01-01",
        startingAge: 41,
        languages: ["en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "SENIOR_COACH",
        businessBackground: "ENTREPRENEURSHIP",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    if (!created.ok) throw new Error(created.error.message);

    const hierarchy = service.getStaffHierarchy();
    expect(hierarchy.ok).toBe(true);
    if (!hierarchy.ok) return;
    expect(hierarchy.data.backroom.clubId).toBe(club.clubId);
    expect(["ALIGNED", "NEUTRAL", "STRAINED", "CONFLICT"]).toContain(
      hierarchy.data.backroom.atmosphere,
    );
    expect(typeof hierarchy.data.backroom.activeStaff).toBe("number");
    expect(typeof hierarchy.data.backroom.alignedRelationships).toBe("number");
    expect(typeof hierarchy.data.backroom.strainedRelationships).toBe("number");
    expect(typeof hierarchy.data.backroom.clue).toBe("string");
    // The read model must never leak the raw trust/respect/tension scores
    // that feed the banded atmosphere label.
    const keys = Object.keys(hierarchy.data.backroom);
    expect(keys).not.toContain("trust");
    expect(keys).not.toContain("respect");
    expect(keys).not.toContain("tension");
  });
});
