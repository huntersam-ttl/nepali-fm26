import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  ResponsibilityError,
  assertResponsibilityPermits,
  assignResponsibility,
  createStaffDevelopmentPlan,
  defaultResponsibilitiesForClub,
  evaluateStaffDevelopmentPlans,
  evaluateStaffPoaching,
  evaluateSuccessionNeeds,
  hireStaff,
  requestBoardApproval,
  responsibilityOwner,
  staffHierarchyForClub,
  staffWorkloadForClub,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type Team } from "@nepal-football-sim/shared-types";

const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "staff-market-c-test"),
  name: "Staff Market Phase C Test",
  worldDate,
  databaseVersion: 43,
  gameVersion: "test",
  randomSeed: "staff-market-c-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

describe("staff market phase C: hierarchy, delegation, workload, development, succession", () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "staff-market-c-"));
  const dbPath = join(savesDirectory, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "smc-NP"), name: "Nepal", isoCode: "NP" };
  const bigClub: Club = {
    id: createStableEntityId("club", "smc-big-club"),
    name: "Well-Staffed FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const smallClub: Club = {
    id: createStableEntityId("club", "smc-small-club"),
    name: "Small Town FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const poorClub: Club = {
    id: createStableEntityId("club", "smc-poor-club"),
    name: "Poor FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const bigTeam: Team = { id: createStableEntityId("team", "smc-big-senior"), clubId: bigClub.id, name: "Well-Staffed FC", level: "senior", gender: "men" };
  const smallTeam: Team = { id: createStableEntityId("team", "smc-small-senior"), clubId: smallClub.id, name: "Small Town FC", level: "senior", gender: "men" };
  const poorTeam: Team = { id: createStableEntityId("team", "smc-poor-senior"), clubId: poorClub.id, name: "Poor FC", level: "senior", gender: "men" };

  const competitionId = createStableEntityId("competition", "smc-league");
  const seasonId = createStableEntityId("season", "smc-league-2026");

  const sportingDirectorId = createStableEntityId("person", "smc-sporting-director");
  const scoutId = createStableEntityId("person", "smc-scout");
  const headCoachId = createStableEntityId("person", "smc-head-coach");
  const assistantCoachId = createStableEntityId("person", "smc-assistant-coach");
  const smallClubCoachId = createStableEntityId("person", "smc-small-coach");

  const world = () => new WorldRepository(db);
  const market = () => new StaffMarketRepository(db);
  const finances = () => new TransferMarketRepository(db);

  const person = (id: EntityId, name: string, role: string) => {
    world().insertPerson({ id, fullName: name, nationalityCountryId: country.id, languages: ["ne"] });
    world().insertStaffProfile({
      id: createStableEntityId("staff-profile", id),
      personId: id,
      preferredRole: role as never,
      salaryExpectation: "MEDIUM",
      reputation: "MEDIUM",
      countryKnowledge: [],
      clubKnowledge: [],
      availability: "AVAILABLE",
      workEligibilityStatus: "ELIGIBLE",
    });
  };

  const licence = (id: EntityId, licenceType: "AFC_D" | "AFC_C" | "AFC_B") => {
    world().insertStaffLicence({
      id: createStableEntityId("staff-licence", `${id}-${licenceType}`),
      personId: id,
      licenceType,
      issuer: "ANFA",
      status: "VERIFIED",
    });
  };

  beforeAll(() => {
    const w = world();
    w.insertCountry(country);
    for (const [club, team] of [
      [bigClub, bigTeam],
      [smallClub, smallTeam],
      [poorClub, poorTeam],
    ] as const) {
      w.insertClub(club);
      w.insertTeam(team);
    }
    w.insertCompetition({ id: competitionId, name: "Test League", scope: "domestic" });
    w.insertCompetitionSeason({
      id: seasonId,
      competitionId,
      name: "2026 Test League",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    for (const [club, team] of [
      [bigClub, bigTeam],
      [smallClub, smallTeam],
      [poorClub, poorTeam],
    ] as const) {
      w.insertClubMembership({
        id: createStableEntityId("membership", club.id),
        clubId: club.id,
        teamId: team.id,
        competitionId,
        competitionSeasonId: seasonId,
        membershipType: "LEAGUE_MEMBER",
        status: "ACTIVE",
      });
      new CompetitionRepository(db).upsertStanding({
        competitionSeasonId: seasonId,
        teamId: team.id,
        played: 5,
        won: 2,
        drawn: 1,
        lost: 2,
        goalsFor: 8,
        goalsAgainst: 7,
        goalDifference: 1,
        points: 7,
      });
    }
    finances().upsertClubFinancialProfile({
      id: createStableEntityId("finance", bigClub.id),
      clubId: bigClub.id,
      wageBudget: 50_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "STABLE",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });
    finances().upsertClubFinancialProfile({
      id: createStableEntityId("finance", smallClub.id),
      clubId: smallClub.id,
      wageBudget: 10_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "STABLE",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });
    finances().upsertClubFinancialProfile({
      id: createStableEntityId("finance", poorClub.id),
      clubId: poorClub.id,
      wageBudget: 5_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "POOR",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });

    person(sportingDirectorId, "Sporting Director", "SPORTING_DIRECTOR");
    person(scoutId, "Chief Scout", "CHIEF_SCOUT");
    person(headCoachId, "Head Coach", "HEAD_COACH");
    licence(headCoachId, "AFC_B");
    person(assistantCoachId, "Assistant Coach", "ASSISTANT_COACH");
    licence(assistantCoachId, "AFC_C");
    person(smallClubCoachId, "Small Club Coach", "HEAD_COACH");
    licence(smallClubCoachId, "AFC_B");

    hireStaff(db, saveAt("2026-08-01"), bigClub.id, bigTeam.id, sportingDirectorId, "SPORTING_DIRECTOR", 2_000_000, 24);
    hireStaff(db, saveAt("2026-08-01"), bigClub.id, bigTeam.id, scoutId, "CHIEF_SCOUT", 1_000_000, 24);
    hireStaff(db, saveAt("2026-08-01"), bigClub.id, bigTeam.id, headCoachId, "HEAD_COACH", 3_000_000, 24);
    hireStaff(db, saveAt("2026-08-01"), bigClub.id, bigTeam.id, assistantCoachId, "ASSISTANT_COACH", 1_500_000, 24);

    hireStaff(db, saveAt("2026-08-01"), smallClub.id, smallTeam.id, smallClubCoachId, "HEAD_COACH", 800_000, 24);
  });

  it("assigns a responsibility to an eligible staff member and enforces one owner per domain", () => {
    const sportingDirectorAppointment = market().activeAppointment(sportingDirectorId)!;
    const responsibility = assignResponsibility(db, saveAt("2026-08-02"), bigClub.id, "TRANSFERS", "STAFF", sportingDirectorAppointment.id);
    expect(responsibility.ownerType).toBe("STAFF");
    expect(responsibility.ownerAppointmentId).toBe(sportingDirectorAppointment.id);

    // Reassigning replaces the prior owner outright — never a second row for the same domain.
    const scoutAppointment = market().activeAppointment(scoutId)!;
    expect(() => assignResponsibility(db, saveAt("2026-08-03"), bigClub.id, "TRANSFERS", "STAFF", scoutAppointment.id)).toThrow(ResponsibilityError);

    const owner = responsibilityOwner(db, bigClub.id, "TRANSFERS");
    expect(owner.ownerAppointmentId).toBe(sportingDirectorAppointment.id);
    expect(market().responsibilitiesForClub(bigClub.id).filter((r) => r.domain === "TRANSFERS")).toHaveLength(1);
  });

  it("rejects delegating a domain to a staff member whose role is not eligible", () => {
    const scoutAppointment = market().activeAppointment(scoutId)!;
    expect(() => assignResponsibility(db, saveAt("2026-08-02"), bigClub.id, "MEDICAL", "STAFF", scoutAppointment.id)).toThrow(ResponsibilityError);
  });

  it("assigns a domain to a real specialist for a well-staffed club and falls back to MANAGER for a small club", () => {
    const bigDefaults = defaultResponsibilitiesForClub(db, saveAt("2026-08-05"), bigClub.id);
    const scoutingDefault = bigDefaults.find((r) => r.domain === "SCOUTING")!;
    expect(scoutingDefault.ownerType).toBe("STAFF");
    expect(scoutingDefault.ownerAppointmentId).toBe(market().activeAppointment(scoutId)!.id);

    const smallDefaults = defaultResponsibilitiesForClub(db, saveAt("2026-08-05"), smallClub.id);
    const smallScouting = smallDefaults.find((r) => r.domain === "SCOUTING")!;
    expect(smallScouting.ownerType).toBe("MANAGER"); // no scout on the small club's roster
    const smallTraining = smallDefaults.find((r) => r.domain === "TRAINING")!;
    expect(smallTraining.ownerType).toBe("STAFF"); // the head coach covers training
  });

  it("grants board approval from real financial health and gates a BOARD-owned domain until approved", () => {
    assignResponsibility(db, saveAt("2026-08-05"), bigClub.id, "CONTRACTS", "BOARD");
    expect(() => assertResponsibilityPermits(db, saveAt("2026-08-06"), bigClub.id, "CONTRACTS", "renewContract")).toThrow(ResponsibilityError);

    const { granted } = requestBoardApproval(db, saveAt("2026-08-06"), bigClub.id, "CONTRACTS");
    expect(granted).toBe(true); // STABLE club

    expect(() => assertResponsibilityPermits(db, saveAt("2026-08-07"), bigClub.id, "CONTRACTS", "renewContract")).not.toThrow();

    // The approval window expires after BOARD_APPROVAL_WINDOW_DAYS (7 days).
    expect(() => assertResponsibilityPermits(db, saveAt("2026-08-20"), bigClub.id, "CONTRACTS", "renewContract")).toThrow(ResponsibilityError);
  });

  it("denies board approval for a club in poor financial health", () => {
    assignResponsibility(db, saveAt("2026-08-05"), poorClub.id, "TRANSFERS", "BOARD");
    const { granted } = requestBoardApproval(db, saveAt("2026-08-06"), poorClub.id, "TRANSFERS");
    expect(granted).toBe(false);
    expect(() => assertResponsibilityPermits(db, saveAt("2026-08-07"), poorClub.id, "TRANSFERS", "makeTransferOffer")).toThrow(ResponsibilityError);
  });

  it("derives workload from how many domains a staff member actually owns", () => {
    assignResponsibility(db, saveAt("2026-08-08"), bigClub.id, "SCOUTING", "STAFF", market().activeAppointment(scoutId)!.id);
    assignResponsibility(db, saveAt("2026-08-08"), bigClub.id, "YOUTH", "MANAGER");
    const workload = staffWorkloadForClub(db, bigClub.id);
    const scoutWorkload = workload.find((w) => w.personId === scoutId);
    expect(scoutWorkload?.level).toBe("NORMAL");

    // Give the sporting director TRANSFERS and CONTRACTS both.
    const sportingDirectorAppointment = market().activeAppointment(sportingDirectorId)!;
    assignResponsibility(db, saveAt("2026-08-08"), bigClub.id, "TRANSFERS", "STAFF", sportingDirectorAppointment.id);
    assignResponsibility(db, saveAt("2026-08-08"), bigClub.id, "CONTRACTS", "STAFF", sportingDirectorAppointment.id);
    const sportingDirectorWorkload = staffWorkloadForClub(db, bigClub.id).find((w) => w.personId === sportingDirectorId);
    expect(sportingDirectorWorkload?.level).toBe("HEAVY");
  });

  it("builds a hierarchy read model ordered by seniority with domains and workload attached", () => {
    const hierarchy = staffHierarchyForClub(db, bigClub.id);
    expect(hierarchy.length).toBeGreaterThan(0);
    for (let i = 1; i < hierarchy.length; i += 1) {
      expect(hierarchy[i - 1]!.seniorityRank).toBeGreaterThanOrEqual(hierarchy[i]!.seniorityRank);
    }
    const sportingDirectorEntry = hierarchy.find((e) => e.personId === sportingDirectorId)!;
    expect(sportingDirectorEntry.domains).toContain("TRANSFERS");
  });

  it("creates a development plan that wraps licence-course enrolment and completes once the licence is actually issued", () => {
    const plan = createStaffDevelopmentPlan(db, saveAt("2026-08-10"), bigClub.id, assistantCoachId, "Coaching progression", "AFC_B", true);
    expect(plan.status).toBe("ACTIVE");
    expect(plan.licenceCourseId).toBeDefined();

    let updated = evaluateStaffDevelopmentPlans(db, bigClub.id);
    expect(updated).toHaveLength(0); // licence not issued yet

    licence(assistantCoachId, "AFC_B");
    updated = evaluateStaffDevelopmentPlans(db, bigClub.id);
    expect(updated.some((p) => p.id === plan.id && p.status === "COMPLETED")).toBe(true);
  });

  it("creates a development plan without a licence target using the default horizon", () => {
    const plan = createStaffDevelopmentPlan(db, saveAt("2026-08-10"), bigClub.id, scoutId, "General mentoring");
    expect(plan.status).toBe("ACTIVE");
    expect(plan.licenceCourseId).toBeUndefined();
    expect(plan.targetDate > "2026-08-10").toBe(true);
  });

  it("flags succession need for a key role nearing contract expiry and finds an internal candidate when eligible", () => {
    const soonExpiringId = createStableEntityId("person", "smc-soon-expiring-director");
    person(soonExpiringId, "Soon Expiring Director", "TECHNICAL_DIRECTOR");
    hireStaff(db, saveAt("2026-08-01"), bigClub.id, bigTeam.id, soonExpiringId, "TECHNICAL_DIRECTOR", 1_800_000, 1);

    const plans = evaluateSuccessionNeeds(db, saveAt("2026-08-15"), bigClub.id);
    const plan = plans.find((p) => p.outgoingPersonId === soonExpiringId);
    expect(plan).toBeDefined();
    expect(plan!.reason).toBe("CONTRACT_EXPIRING");

    // Re-running does not duplicate the active plan.
    const again = evaluateSuccessionNeeds(db, saveAt("2026-08-16"), bigClub.id);
    expect(again.some((p) => p.outgoingPersonId === soonExpiringId)).toBe(false);
    expect(market().successionPlansForClub(bigClub.id).filter((p) => p.outgoingPersonId === soonExpiringId)).toHaveLength(1);
  });

  it("does not flag succession need for a non-key role or a healthy contract", () => {
    const plans = evaluateSuccessionNeeds(db, saveAt("2026-08-16"), bigClub.id);
    expect(plans.some((p) => p.outgoingPersonId === scoutId)).toBe(false); // CHIEF_SCOUT not in KEY_ROLES
  });

  it("gates makeTransferOffer-equivalent domain actions consistently through assertResponsibilityPermits without altering existing business logic", () => {
    // TRANSFERS is STAFF-owned at bigClub (sporting director) — no board gate, should log and pass.
    expect(() => assertResponsibilityPermits(db, saveAt("2026-08-17"), bigClub.id, "TRANSFERS", "makeTransferOffer")).not.toThrow();
    const log = market().responsibilityLogForClub(bigClub.id);
    expect(log.some((entry) => entry.action === "makeTransferOffer")).toBe(true);
  });

  it("persists responsibilities, development plans, and succession plans across a save/load cycle", () => {
    db.close();
    db = openGameDatabase(dbPath);

    const reopened = new StaffMarketRepository(db);
    expect(reopened.responsibility(bigClub.id, "SCOUTING")?.ownerType).toBe("STAFF");
    expect(reopened.developmentPlansForClub(bigClub.id).length).toBeGreaterThan(0);
    expect(reopened.successionPlansForClub(bigClub.id).length).toBeGreaterThan(0);

    // Poaching evaluation still runs cleanly alongside Phase C state.
    expect(() => evaluateStaffPoaching(db, saveAt("2026-09-01"), bigClub.id)).not.toThrow();
  });
});
