import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CareerWorldRepository,
  ClubEconomyRepository,
  ManagerRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  acceptJobOffer,
  applyForJob,
  createCareerCharacter,
  ensureAiManagersAssigned,
  negotiateManagerJobOffer,
  testLicence,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type ManagerAttributeSet,
  type ManagerProfile,
  type Team,
} from "@nepal-football-sim/shared-types";

/*
 * Phase 11B.1: AI clubs fill manager vacancies through the canonical hiring path
 * (interview -> offer -> negotiation -> appointment -> vacancy closed). Nothing here
 * appoints a manager directly.
 */

const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
const competitionId = createStableEntityId("competition", "hiring-league");
const seasonId = createStableEntityId("season", "hiring-league-2026");

const attributesAll = (n: number): ManagerAttributeSet => ({
  tactical: { tacticalKnowledge: n, adaptability: n, matchManagement: n, setPieceKnowledge: n },
  coaching: { attackingCoaching: n, defensiveCoaching: n, technicalCoaching: n, mentalCoaching: n, fitnessUnderstanding: n, youthDevelopment: n },
  people: { manManagement: n, motivation: n, discipline: n, communication: n },
  recruitment: { playerJudgement: n, potentialJudgement: n },
  personality: { reputation: n, mediaHandling: n, pressureHandling: n, professionalism: n, ambition: n, loyalty: n },
});

const saveAt = (worldDate: string, playerCharacterId?: EntityId) => ({
  id: createStableEntityId("save", "ai-hiring-test"),
  name: "AI Hiring Test",
  worldDate,
  databaseVersion: 20,
  gameVersion: "test",
  randomSeed: "ai-hiring-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
  ...(playerCharacterId ? { playerCharacterId } : {}),
});

const addDay = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** A small world of unmanaged senior teams whose boards are wary of risk (so a weak candidate fails). */
const buildWorld = (teamCount: number, risk: "LOW" | "BALANCED" = "LOW") => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  const world = new WorldRepository(db);
  world.insertCountry(country);
  world.insertFederation({ id: createStableEntityId("federation", "hiring-fa"), countryId: country.id, name: "Hiring Football Association" });
  world.insertCompetition({ id: competitionId, name: "Hiring League", scope: "domestic" });
  world.insertCompetitionSeason({ id: seasonId, competitionId, name: "2026 Hiring League", startDate: "2026-08-01", endDate: "2027-05-31" });
  const teams: Team[] = [];
  for (let index = 0; index < teamCount; index += 1) {
    const club: Club = { id: createStableEntityId("club", `hiring-${index}`), name: `Hiring FC ${index}`, countryId: country.id, ownershipType: "PRIVATE" };
    const team: Team = { id: createStableEntityId("team", `hiring-${index}`), clubId: club.id, name: club.name, level: "senior", gender: "men" };
    world.insertClub(club);
    world.insertTeam(team);
    world.insertClubMembership({
      id: createStableEntityId("membership", `hiring-${index}`),
      clubId: club.id,
      teamId: team.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });
    new ClubEconomyRepository(db).upsertBoardPolicy({
      clubId: club.id,
      financialRiskTolerance: risk,
      transferPhilosophy: "BALANCED",
      youthPriority: 0.5,
      commercialPriority: 0.5,
      infrastructurePriority: 0.5,
      strategicObjective: "SURVIVE",
      updatedAt: "2026-08-01",
      status: "SIMULATION_ONLY",
    });
    teams.push(team);
  }
  return { db, teams };
};

let candidateCount = 0;
const addCandidate = (db: GameDatabase, base: number): ManagerProfile => {
  candidateCount += 1;
  const personId = createStableEntityId("hiring-person", `c${candidateCount}`);
  new WorldRepository(db).insertPerson({ id: personId, fullName: `Candidate ${candidateCount}`, nationalityCountryId: country.id, languages: ["ne"] });
  const profile: ManagerProfile = {
    id: createStableEntityId("hiring-profile", `c${candidateCount}`),
    personId,
    attributes: attributesAll(base),
    reputationProfile: "LOCAL_RESPECTED",
    createdOn: "2026-07-01",
  };
  new ManagerRepository(db).insertProfile(profile);
  return profile;
};

const count = (db: GameDatabase, sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...(params as [])) as { n: number }).n;

const openVacancy = (db: GameDatabase, team: Team, openedOn = "2026-08-01"): EntityId => {
  const id = createStableEntityId("manager-job-vacancy", `${team.id}:${openedOn}`);
  new CareerWorldRepository(db).insertVacancy({
    id,
    clubId: team.clubId,
    teamId: team.id,
    countryId: country.id,
    openedOn,
    reason: "NEW_CLUB",
    boardExpectation: "SURVIVE",
    status: "OPEN",
  });
  return id;
};

const dirs: string[] = [];
afterAll(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5 })));

describe("the interview", () => {
  it("a valid candidate passes and an invalid candidate still fails", () => {
    const { db, teams } = buildWorld(1);
    const vacancy = openVacancy(db, teams[0]!);
    const strong = addCandidate(db, 9);
    const weak = addCandidate(db, 6);
    expect(applyForJob(db, saveAt("2026-08-01"), strong, vacancy).status).toBe("OFFERED");
    expect(applyForJob(db, saveAt("2026-08-01"), weak, vacancy).status).toBe("REJECTED");
    db.close();
  });

  it("a counter made exactly at the club's ceiling is accepted", () => {
    const { db, teams } = buildWorld(1);
    const vacancy = openVacancy(db, teams[0]!);
    const strong = addCandidate(db, 9);
    // 3,500,000 x 1.17 is 4,094,999.9999999995 in floating point; the candidate asks for 4,095,000.
    const careerWorld = new CareerWorldRepository(db);
    const application = {
      id: createStableEntityId("manager-job-application", "boundary"),
      vacancyId: vacancy,
      managerProfileId: strong.id,
      personId: strong.personId,
      status: "OFFERED" as const,
      createdOn: "2026-08-01",
      decidedOn: "2026-08-01",
      offeredSalaryMinor: 3_500_000,
      offeredContractEnd: "2028-08-01",
    };
    careerWorld.insertApplication(application);
    careerWorld.upsertManagerJobNegotiation({
      id: createStableEntityId("manager-job-negotiation", "boundary"),
      applicationId: application.id,
      vacancyId: vacancy,
      stage: "OFFERED",
      round: 0,
      maxRounds: 2,
      offeredSalaryMinor: 3_500_000,
      offeredContractEnd: "2028-08-01",
      updatedOn: "2026-08-01",
      provenanceStatus: "SIMULATION_ONLY",
    });
    const negotiated = negotiateManagerJobOffer({ db, save: saveAt("2026-08-02"), managerProfile: strong, applicationId: application.id, action: "COUNTER", requestedSalaryMinor: 4_095_000 });
    expect(negotiated.stage).toBe("ACCEPTED");
    db.close();
  });
});

describe("an AI club filling its vacancy", () => {
  it("goes vacancy -> interview -> offer -> appointment -> vacancy closed, with one manager, and never re-interviews a rejected candidate", () => {
    const { db, teams } = buildWorld(1);
    // The only people known to the game fail this board's interview (score 54 against 55).
    for (let index = 0; index < 3; index += 1) addCandidate(db, 7);
    const team = teams[0]!;
    const managers = new ManagerRepository(db);

    let day = "2026-08-01";
    let appointedOn: string | undefined;
    for (let step = 0; step < 90 && !appointedOn; step += 1) {
      ensureAiManagersAssigned(db, saveAt(day), undefined);
      if (managers.activeContractForTeam(team.id)) appointedOn = day;
      day = addDay(day, 1);
    }
    expect(appointedOn, "the vacancy was eventually filled").toBeDefined();

    const contract = managers.activeContractForTeam(team.id)!;
    const vacancy = new CareerWorldRepository(db).applicationsForVacancy(
      (db.prepare("SELECT id FROM manager_job_vacancies WHERE team_id = ?").get(team.id) as { id: EntityId }).id,
    );
    const row = db.prepare("SELECT status, filled_on AS filledOn, filled_by_contract_id AS contractId FROM manager_job_vacancies WHERE team_id = ?").get(team.id) as { status: string; filledOn: string; contractId: EntityId };
    expect(row.status).toBe("FILLED");
    expect(row.contractId).toBe(contract.id);
    expect(row.filledOn).toBe(appointedOn);

    // Exactly one active manager for the team and one team for that manager.
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts WHERE team_id = ? AND status = 'ACTIVE'", team.id)).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts WHERE manager_profile_id = ? AND status = 'ACTIVE'", contract.managerProfileId)).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts")).toBe(1);

    // Application states are terminal: the appointed one accepted, every other closed, none left open.
    expect(vacancy.filter((application) => application.status === "ACCEPTED")).toHaveLength(1);
    expect(vacancy.filter((application) => application.status === "OFFERED" || application.status === "PENDING")).toHaveLength(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_applications WHERE status = 'OFFERED'")).toBe(0);

    // Nobody was interviewed twice for this vacancy, and the search widened rather than repeating itself.
    expect(count(db, "SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM manager_job_applications GROUP BY vacancy_id, manager_profile_id)")).toBe(1);
    expect(vacancy.length).toBeGreaterThan(3);
    expect(vacancy.length).toBeLessThan(40);
    db.close();
  });

  it("resumes an open offer instead of leaving it stuck, and never opens a second offer to the same candidate", () => {
    const { db, teams } = buildWorld(1);
    const team = teams[0]!;
    const vacancy = openVacancy(db, team);
    const candidate = addCandidate(db, 9);
    // The offer exists (interview passed) but was never negotiated to an appointment.
    const offer = applyForJob(db, saveAt("2026-08-01"), candidate, vacancy);
    expect(offer.status).toBe("OFFERED");

    ensureAiManagersAssigned(db, saveAt("2026-09-05"), undefined);
    const contract = new ManagerRepository(db).activeContractForTeam(team.id);
    expect(contract?.managerProfileId).toBe(candidate.id);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_applications WHERE vacancy_id = ? AND manager_profile_id = ?", vacancy, candidate.id)).toBe(1);
    expect(new CareerWorldRepository(db).application(offer.id)?.status).toBe("ACCEPTED");
    db.close();
  });

  it("does not hire a manager into a second job on the day they take the first", () => {
    const { db } = buildWorld(4, "BALANCED");
    // One outstanding candidate who would qualify for, and could be poached to, every job.
    const star = addCandidate(db, 9);
    // Vacancies wait out a 30-day grace period after their first day, then the search widens daily.
    for (let day = 0; day < 90; day += 1) ensureAiManagersAssigned(db, saveAt(addDay("2026-08-01", day)), undefined);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts WHERE manager_profile_id = ?", star.id)).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts WHERE status != 'ACTIVE'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM (SELECT team_id FROM manager_contracts WHERE status = 'ACTIVE' GROUP BY team_id HAVING COUNT(*) > 1)")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts WHERE status = 'ACTIVE'")).toBe(4);
    db.close();
  });
});

describe("the human's job market", () => {
  it("a pending human offer is never overridden by the board, and the human is never an AI candidate", () => {
    const { db, teams } = buildWorld(1, "BALANCED");
    const team = teams[0]!;
    const character = createCareerCharacter({
      fullName: "Maya Test",
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
      careerStartDate: "2026-08-01",
    });
    const world = new WorldRepository(db);
    world.insertPerson(character.person);
    world.insertCareerCharacter(character.character);
    new ManagerRepository(db).insertProfile(character.managerProfile);
    const save = (date: string) => saveAt(date, character.character.id);

    const vacancy = openVacancy(db, team);
    let application = applyForJob(db, save("2026-08-01"), character.managerProfile, vacancy);
    for (let day = 1; application.status === "REJECTED" && day < 25; day += 1) {
      application = applyForJob(db, save(addDay("2026-08-01", day)), character.managerProfile, vacancy);
    }
    expect(application.status).toBe("OFFERED");

    // The board keeps looking for months, and even has strong candidates available, but the human decides.
    addCandidate(db, 9);
    addCandidate(db, 9);
    for (let day = 40; day < 140; day += 1) ensureAiManagersAssigned(db, save(addDay("2026-08-01", day)), undefined);
    expect(new ManagerRepository(db).activeContractForTeam(team.id)).toBeUndefined();
    expect(new CareerWorldRepository(db).vacancy(vacancy)?.status).toBe("OPEN");
    expect(new CareerWorldRepository(db).application(application.id)?.status).toBe("OFFERED");
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_applications WHERE manager_profile_id = ? AND vacancy_id = ?", character.managerProfile.id, vacancy)).toBeGreaterThanOrEqual(1);

    // Accepting still works exactly as before and the human is the one manager.
    negotiateManagerJobOffer({ db, save: save("2026-12-20"), managerProfile: character.managerProfile, applicationId: application.id, action: "ACCEPT" });
    const contract = acceptJobOffer(db, save("2026-12-20"), character.managerProfile, application.id);
    expect(contract.status).toBe("ACTIVE");
    expect(count(db, "SELECT COUNT(*) AS n FROM manager_contracts WHERE team_id = ? AND status = 'ACTIVE'", team.id)).toBe(1);
    expect(new ManagerRepository(db).activeContractForTeam(team.id)?.managerProfileId).toBe(character.managerProfile.id);
    db.close();
  });
});

describe("a real desktop save", () => {
  it("fills AI manager vacancies over a season through Continue, with one interview per candidate per vacancy", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-hiring-"));
    dirs.push(directory);
    const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: resolve("data/nepal/2026-08/club-registry.json") });
    const clubs = service.listStartingClubs();
    if (!clubs.ok || !clubs.data[0]?.teamId) throw new Error("No starting club available");
    const created = service.createCareer({
      saveName: "hiring",
      careerMode: "MANAGER",
      joinTeamId: clubs.data[0].teamId,
      character: {
        fullName: "Hiring Tester",
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
    const savePath = created.data.catalogEntry.filePath;
    for (let guard = 0; guard < 700; guard += 1) {
      const status = service.getSeasonStatus();
      if (status.ok && status.data.phase !== "IN_PROGRESS") break;
      const step = service.continueCareer();
      if (!step.ok) throw new Error(`continue: ${step.error.code} ${step.error.message}`);
      service.quickSimMatch();
    }
    service.closeCareer();

    const db = openGameDatabase(savePath);
    try {
      const vacancies = count(db, "SELECT COUNT(*) AS n FROM manager_job_vacancies");
      const filled = count(db, "SELECT COUNT(*) AS n FROM manager_job_vacancies WHERE status = 'FILLED'");
      expect(vacancies).toBeGreaterThan(5);
      expect(filled, "some AI vacancies actually close").toBeGreaterThan(vacancies / 2);
      expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_vacancies v WHERE v.status = 'FILLED' AND NOT EXISTS (SELECT 1 FROM manager_contracts c WHERE c.id = v.filled_by_contract_id)")).toBe(0);
      // Exactly one active manager per team and one team per manager.
      expect(count(db, "SELECT COUNT(*) AS n FROM (SELECT team_id FROM manager_contracts WHERE status = 'ACTIVE' GROUP BY team_id HAVING COUNT(*) > 1)")).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM (SELECT manager_profile_id FROM manager_contracts WHERE status = 'ACTIVE' GROUP BY manager_profile_id HAVING COUNT(*) > 1)")).toBe(0);
      // No repeat interviews, no dangling offers on filled vacancies, no manager hired twice in a season.
      expect(count(db, "SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM manager_job_applications GROUP BY vacancy_id, manager_profile_id)")).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS n FROM manager_job_applications a JOIN manager_job_vacancies v ON v.id = a.vacancy_id WHERE v.status = 'FILLED' AND a.status = 'OFFERED'")).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS n FROM (SELECT manager_profile_id FROM manager_contracts GROUP BY manager_profile_id HAVING COUNT(*) > 2)")).toBe(0);
    } finally {
      db.close();
    }
  }, 900_000);
});
