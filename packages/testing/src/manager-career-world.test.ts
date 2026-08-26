import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CareerWorldRepository,
  ClubEconomyRepository,
  CompetitionRepository,
  ManagerRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  acceptJobOffer,
  applyForJob,
  careerHistory,
  createCareerCharacter,
  createManagerContract,
  ensureAiManagersAssigned,
  evaluateBoardConfidence,
  listVacancies,
  resignFromClub,
  sackManager,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type ManagerContract,
  type Team,
} from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");

describe("manager career world: unemployed -> hired -> managing -> another job", () => {
  let service: DesktopApplicationService;
  let savesDirectory: string;

  beforeAll(() => {
    savesDirectory = mkdtempSync(join(tmpdir(), "nepal-career-world-"));
    service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer({
      saveName: "Career World",
      character: {
        fullName: "Sita Rana",
        preferredDisplayName: "Sita",
        dateOfBirth: "1988-03-20",
        startingAge: 38,
        languages: ["ne", "en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "PROFESSIONAL_PLAYER",
        coachingExperience: "SENIOR_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    if (!created.ok) throw new Error(`career creation failed: ${created.error.message}`);
  }, 240_000);

  afterAll(() => {
    service.closeCareer();
    rmSync(savesDirectory, { recursive: true, force: true });
  });

  it("starts employed", () => {
    const dashboard = service.getManagerDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    expect(dashboard.data.employmentStatus).toBe("EMPLOYED");
  });

  it("resigning opens a vacancy at the old club and moves the manager to the job centre", () => {
    const before = service.getManagerDashboard();
    if (!before.ok) throw new Error("dashboard failed");
    const oldClub = before.data.clubName;

    const resigned = service.resignFromClub();
    expect(resigned.ok).toBe(true);
    if (!resigned.ok) return;
    expect(resigned.data.header.teamName).toBeUndefined();

    const dashboard = service.getManagerDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    expect(dashboard.data.employmentStatus).toBe("UNEMPLOYED");
    expect(dashboard.data.jobCentre).toBeDefined();
    const vacancy = dashboard.data.jobCentre?.vacancies.find((entry) => entry.clubName === oldClub);
    expect(vacancy).toBeDefined();
    expect(vacancy?.reason).toBe("RESIGNED");
  });

  it("applying resolves into an interview outcome, and accepting an offer ends unemployment", () => {
    let offerApplicationId: EntityId | undefined;

    for (let attempt = 0; attempt < 5 && !offerApplicationId; attempt += 1) {
      const jobCentre = service.getJobCentre();
      if (!jobCentre.ok) throw new Error("job centre failed");
      const vacancy = jobCentre.data.vacancies.find((entry) => entry.eligible);
      expect(vacancy).toBeDefined();
      if (!vacancy) return;

      const applied = service.applyForJob(vacancy.id);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      const application = applied.data.applications.find((entry) => entry.vacancyId === vacancy.id);
      expect(application?.status === "OFFERED" || application?.status === "REJECTED").toBe(true);

      if (application?.status === "OFFERED") {
        offerApplicationId = application.id;
        break;
      }

      // Rejected: let a little time pass (still inside the vacancy grace
      // window) so the next application rolls against a different date.
      const advanced = service.continueCareer();
      expect(advanced.ok).toBe(true);
    }

    expect(offerApplicationId).toBeDefined();
    if (!offerApplicationId) return;

    const accepted = service.acceptJobOffer(offerApplicationId);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.data.header.teamName).toBeTruthy();

    const dashboard = service.getManagerDashboard();
    expect(dashboard.ok).toBe(true);
    if (!dashboard.ok) return;
    expect(dashboard.data.employmentStatus).toBe("EMPLOYED");
  });

  it("records the completed spell and the new appointment in career history", () => {
    const history = service.getCareerHistory();
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.data.jobsHeld).toBeGreaterThanOrEqual(2);
    expect(history.data.history.some((entry) => entry.outcome === "RESIGNED")).toBe(true);
    expect(history.data.history.some((entry) => entry.outcome === "ACTIVE")).toBe(true);
  });
});

describe("manager career world: board confidence, sacking and AI reassignment", () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "ai-club"),
    name: "AI United",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "ai-united-senior"),
    clubId: club.id,
    name: "AI United",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "test-league");
  const seasonId = createStableEntityId("season", "test-league-2026");

  beforeAll(() => {
    const world = new WorldRepository(db);
    world.insertCountry(country);
    world.insertClub(club);
    world.insertTeam(team);
    world.insertCompetition({ id: competitionId, name: "Test League", scope: "domestic" });
    world.insertCompetitionSeason({
      id: seasonId,
      competitionId,
      name: "2026 Test League",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    world.insertClubMembership({
      id: createStableEntityId("membership", "ai-united"),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });
    new ClubEconomyRepository(db).upsertBoardPolicy({
      clubId: club.id,
      financialRiskTolerance: "BALANCED",
      transferPhilosophy: "BALANCED",
      youthPriority: 0.5,
      commercialPriority: 0.5,
      infrastructurePriority: 0.5,
      strategicObjective: "SURVIVE",
      updatedAt: "2026-08-01",
      status: "SIMULATION_ONLY",
    });
  });

  it("assigns an AI manager to an unmanaged senior team", () => {
    ensureAiManagersAssigned(db, saveAt("2026-08-01"), undefined);
    const contract = new ManagerRepository(db).activeContractForTeam(team.id);
    expect(contract).toBeDefined();
    expect(contract?.status).toBe("ACTIVE");
  });

  it("sacks a manager once the board's confidence bottoms out and opens a vacancy", () => {
    const contract = new ManagerRepository(db).activeContractForTeam(team.id) as ManagerContract;
    new CareerWorldRepository(db).upsertBoardConfidence({
      clubId: club.id,
      contractId: contract.id,
      confidence: 2,
      expectation: "TITLE_CHALLENGE",
      lastEvaluatedOn: "2026-08-01",
    });
    // Bottom-of-the-table finish against a title-challenge expectation drives
    // confidence to zero and triggers the sacking inside evaluateBoardConfidence.
    new CompetitionRepository(db).upsertStanding({
      competitionSeasonId: seasonId,
      teamId: team.id,
      played: 10,
      won: 0,
      drawn: 1,
      lost: 9,
      goalsFor: 4,
      goalsAgainst: 30,
      goalDifference: -26,
      points: 1,
    });

    // Well past the minimum-tenure guard (60 days from the 2026-08-01 start).
    const outcome = evaluateBoardConfidence(db, saveAt("2026-10-15"));
    expect(outcome.sackedContracts.map((entry) => entry.id)).toContain(contract.id);

    const updatedContract = new ManagerRepository(db).contractsForPerson(contract.personId)[0];
    expect(updatedContract?.status).toBe("SACKED");

    const vacancy = new CareerWorldRepository(db).openVacancyForTeam(team.id);
    expect(vacancy).toBeDefined();
    expect(vacancy?.reason).toBe("SACKED");
  });

  it("directly exercises apply/accept and leaves a fresh vacancy for the club history", () => {
    const character = createCareerCharacter({
      fullName: "Bikash Test Manager",
      dateOfBirth: "1985-01-01",
      startingAge: 41,
      nationalityCountryId: country.id,
      languages: ["ne"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER",
      coachingExperience: "SENIOR_COACH",
      coachingLicences: [testLicence("Testing A Licence", 3)],
      businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER",
      careerStartDate: "2026-09-01",
    });
    new WorldRepository(db).insertPerson(character.person);
    new ManagerRepository(db).insertProfile(character.managerProfile);

    const vacancy = new CareerWorldRepository(db).openVacancyForTeam(team.id);
    expect(vacancy).toBeDefined();
    if (!vacancy) return;

    const listing = listVacancies(db, character.managerProfile);
    expect(listing.some((entry) => entry.vacancy.id === vacancy.id)).toBe(true);

    let application = applyForJob(db, saveAt("2026-09-01"), character.managerProfile, vacancy.id);
    let day = 1;
    while (application.status === "REJECTED" && day < 20) {
      application = applyForJob(
        db,
        saveAt(`2026-09-${String(1 + day).padStart(2, "0")}`),
        character.managerProfile,
        vacancy.id,
      );
      day += 1;
    }
    expect(application.status).toBe("OFFERED");

    const newContract = acceptJobOffer(
      db,
      saveAt("2026-09-01"),
      character.managerProfile,
      application.id,
    );
    expect(newContract.status).toBe("ACTIVE");
    expect(newContract.teamId).toBe(team.id);
    expect(new CareerWorldRepository(db).openVacancyForTeam(team.id)).toBeUndefined();

    const { history } = careerHistory(db, character.person.id);
    expect(history.some((entry) => entry.contract.id === newContract.id)).toBe(true);

    // And resigning reopens the cycle for the next manager.
    resignFromClub(db, saveAt("2026-10-01"), newContract);
    const reopened = new CareerWorldRepository(db).openVacancyForTeam(team.id);
    expect(reopened?.reason).toBe("RESIGNED");
  });

  it("also sacks via the shared helper without a prior board-confidence tick", () => {
    // A second club: a club/season pair can only hold one active membership,
    // so a second senior team needs its own club.
    const secondClub: Club = {
      id: createStableEntityId("club", "ai-club-b"),
      name: "AI Rovers",
      countryId: country.id,
      ownershipType: "PRIVATE",
    };
    const freshTeam: Team = {
      id: createStableEntityId("team", "ai-second-senior"),
      clubId: secondClub.id,
      name: "AI Rovers",
      level: "senior",
      gender: "men",
    };
    new WorldRepository(db).insertClub(secondClub);
    new WorldRepository(db).insertTeam(freshTeam);
    new WorldRepository(db).insertClubMembership({
      id: createStableEntityId("membership", "ai-rovers"),
      clubId: secondClub.id,
      teamId: freshTeam.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });
    new ClubEconomyRepository(db).upsertBoardPolicy({
      clubId: secondClub.id,
      financialRiskTolerance: "BALANCED",
      transferPhilosophy: "BALANCED",
      youthPriority: 0.5,
      commercialPriority: 0.5,
      infrastructurePriority: 0.5,
      strategicObjective: "SURVIVE",
      updatedAt: "2026-08-01",
      status: "SIMULATION_ONLY",
    });
    ensureAiManagersAssigned(db, saveAt("2026-11-01"), undefined);
    const contract = new ManagerRepository(db).activeContractForTeam(freshTeam.id);
    expect(contract).toBeDefined();
    if (!contract) return;
    sackManager(db, saveAt("2026-11-02"), contract, "SACKED");
    expect(new ManagerRepository(db).activeContractForTeam(freshTeam.id)).toBeUndefined();
    expect(new CareerWorldRepository(db).openVacancyForTeam(freshTeam.id)?.reason).toBe("SACKED");
  });
});

const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "career-world-test"),
  name: "Career World Test",
  worldDate,
  databaseVersion: 20,
  gameVersion: "test",
  randomSeed: "career-world-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});
