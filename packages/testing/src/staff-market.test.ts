import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  StaffActionError,
  dismissStaff,
  ensureAiStaffAssigned,
  ensureStaffProfileForRetiree,
  evaluateStaffContracts,
  hireStaff,
  staffCareerHistory,
  staffEligibility,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type Team } from "@nepal-football-sim/shared-types";

const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "staff-market-test"),
  name: "Staff Market Test",
  worldDate,
  databaseVersion: 34,
  gameVersion: "test",
  randomSeed: "staff-market-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

describe("staff market phase A: hiring, dismissal, contracts, AI recruitment", () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "staff-market-"));
  const dbPath = join(savesDirectory, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "sm-club"),
    name: "Staff FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const rivalClub: Club = {
    id: createStableEntityId("club", "sm-rival"),
    name: "Rival FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "sm-club-senior"),
    clubId: club.id,
    name: "Staff FC",
    level: "senior",
    gender: "men",
  };
  const rivalTeam: Team = {
    id: createStableEntityId("team", "sm-rival-senior"),
    clubId: rivalClub.id,
    name: "Rival FC",
    level: "senior",
    gender: "men",
  };
  const competitionId = createStableEntityId("competition", "sm-league");
  const seasonId = createStableEntityId("season", "sm-league-2026");

  const gkCoachId = createStableEntityId("person", "sm-gk-coach");
  const headCoachCandidateId = createStableEntityId("person", "sm-head-coach-candidate");
  const retiredPlayerId = createStableEntityId("person", "sm-retired-player");

  const world = () => new WorldRepository(db);
  const market = () => new StaffMarketRepository(db);
  const finances = () => new TransferMarketRepository(db);

  beforeAll(() => {
    const w = world();
    w.insertCountry(country);
    w.insertClub(club);
    w.insertClub(rivalClub);
    w.insertTeam(team);
    w.insertTeam(rivalTeam);
    w.insertCompetition({ id: competitionId, name: "Test League", scope: "domestic" });
    w.insertCompetitionSeason({
      id: seasonId,
      competitionId,
      name: "2026 Test League",
      startDate: "2026-08-01",
      endDate: "2027-05-31",
    });
    for (const [c, t] of [
      [club, team],
      [rivalClub, rivalTeam],
    ] as const) {
      w.insertClubMembership({
        id: createStableEntityId("membership", c.id),
        clubId: c.id,
        teamId: t.id,
        competitionId,
        competitionSeasonId: seasonId,
        membershipType: "LEAGUE_MEMBER",
        status: "ACTIVE",
      });
    }

    finances().upsertClubFinancialProfile({
      id: createStableEntityId("finance", club.id),
      clubId: club.id,
      wageBudget: 5_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "STABLE",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });
    finances().upsertClubFinancialProfile({
      id: createStableEntityId("finance", rivalClub.id),
      clubId: rivalClub.id,
      wageBudget: 5_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "STABLE",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });

    w.insertPerson({ id: gkCoachId, fullName: "GK Coach Candidate", nationalityCountryId: country.id, languages: ["ne"] });
    w.insertStaffProfile({
      id: createStableEntityId("staff-profile", gkCoachId),
      personId: gkCoachId,
      preferredRole: "GOALKEEPER_COACH",
      salaryExpectation: "MEDIUM",
      reputation: "MEDIUM",
      countryKnowledge: [],
      clubKnowledge: [],
      availability: "AVAILABLE",
      workEligibilityStatus: "ELIGIBLE",
    });
    w.insertStaffLicence({
      id: createStableEntityId("staff-licence", gkCoachId),
      personId: gkCoachId,
      licenceType: "AFC_D",
      issuer: "ANFA",
      status: "VERIFIED",
    });

    w.insertPerson({
      id: headCoachCandidateId,
      fullName: "Unqualified Candidate",
      nationalityCountryId: country.id,
      languages: ["ne"],
    });
    w.insertStaffProfile({
      id: createStableEntityId("staff-profile", headCoachCandidateId),
      personId: headCoachCandidateId,
      preferredRole: "HEAD_COACH",
      salaryExpectation: "LOW",
      reputation: "LOW",
      countryKnowledge: [],
      clubKnowledge: [],
      availability: "AVAILABLE",
      workEligibilityStatus: "ELIGIBLE",
    });

    w.insertPerson({ id: retiredPlayerId, fullName: "Retired Player", nationalityCountryId: country.id, languages: ["ne"] });
  });

  it("rejects a hire when the candidate lacks the required coaching licence", () => {
    const eligibility = staffEligibility("HEAD_COACH", market().staffProfile(headCoachCandidateId), []);
    expect(eligibility.eligible).toBe(false);

    expect(() =>
      hireStaff(db, saveAt("2026-08-10"), club.id, team.id, headCoachCandidateId, "HEAD_COACH", 1_500_000),
    ).toThrow(StaffActionError);
  });

  it("rejects a hire the club's wage budget cannot absorb", () => {
    expect(() =>
      hireStaff(db, saveAt("2026-08-10"), club.id, team.id, gkCoachId, "GOALKEEPER_COACH", 50_000_000),
    ).toThrow(StaffActionError);
  });

  let appointmentId: EntityId;

  it("hires an eligible, affordable candidate and creates the backing contract", () => {
    const appointment = hireStaff(db, saveAt("2026-08-10"), club.id, team.id, gkCoachId, "GOALKEEPER_COACH", 700_000, 12);
    appointmentId = appointment.id;
    expect(appointment.employmentStatus).toBe("ACTIVE");
    expect(appointment.contractId).toBeDefined();

    const contract = market().employmentContractById(appointment.contractId!)!;
    expect(contract.status).toBe("ACTIVE");
    expect(contract.salaryAmountMinor).toBe(700_000);
    expect(contract.contractEnd).toBe("2027-08-05"); // 12 * 30-day months, not a calendar year

    const history = market().staffHistoryForPerson(gkCoachId);
    expect(history.some((event) => event.eventType === "STAFF_JOINED")).toBe(true);

    expect(market().activeAppointment(gkCoachId)?.id).toBe(appointmentId);
  });

  it("refuses to hire someone who already holds an active appointment", () => {
    expect(() =>
      hireStaff(db, saveAt("2026-08-11"), rivalClub.id, rivalTeam.id, gkCoachId, "GOALKEEPER_COACH", 700_000),
    ).toThrow(StaffActionError);
  });

  it("dismisses staff, ending their contract and reopening the role as a vacancy", () => {
    const dismissed = dismissStaff(db, saveAt("2026-09-01"), appointmentId);
    expect(dismissed.employmentStatus).toBe("FORMER");

    const contract = market().employmentContractsForPerson(gkCoachId)[0]!;
    expect(contract.status).toBe("TERMINATED");

    const vacancy = market().openVacancyForRole(club.id, "GOALKEEPER_COACH");
    expect(vacancy?.status).toBe("VACANT");
    expect(vacancy?.reason).toBe("DISMISSED");

    const history = market().staffHistoryForPerson(gkCoachId);
    expect(history.some((event) => event.eventType === "STAFF_LEFT")).toBe(true);
  });

  it("keeps a retired player's staff transition compatible with the hiring pipeline", () => {
    expect(market().staffProfile(retiredPlayerId)).toBeUndefined();
    const profile = ensureStaffProfileForRetiree(db, retiredPlayerId, "ASSISTANT_COACH");
    expect(profile.preferredRole).toBe("ASSISTANT_COACH");
    expect(market().unemployedStaffProfiles().some((p) => p.personId === retiredPlayerId)).toBe(true);

    // No coaching licence yet, so they're hired into an unlicensed role
    // (their preference is only a soft note, not a hard block).
    const appointment = hireStaff(
      db,
      saveAt("2026-09-05"),
      rivalClub.id,
      rivalTeam.id,
      retiredPlayerId,
      "SCOUT",
      600_000,
    );
    expect(appointment.employmentStatus).toBe("ACTIVE");
  });

  it("renews or lets a contract lapse near its end date, based on reputation, not a fixed outcome", () => {
    const contract = market().employmentContractsForPerson(retiredPlayerId)[0]!;
    // Force the contract to fall due within the renewal window.
    market().upsertEmploymentContract({ ...contract, contractEnd: "2026-09-25" });

    const before = market().activeAppointment(retiredPlayerId);
    expect(before).toBeDefined();

    const outcome = evaluateStaffContracts(db, saveAt("2026-09-10"), rivalClub.id);
    const touchedThisPerson =
      outcome.renewed.some((entry) => entry.personId === retiredPlayerId) ||
      outcome.expired.some((entry) => entry.personId === retiredPlayerId);
    expect(touchedThisPerson).toBe(true);

    const updatedContract = market().employmentContractsForPerson(retiredPlayerId)[0]!;
    if (updatedContract.status === "ACTIVE") {
      expect(updatedContract.contractEnd! > "2026-09-25").toBe(true);
    } else {
      expect(updatedContract.status).toBe("EXPIRED");
      expect(market().activeAppointment(retiredPlayerId)).toBeUndefined();
      const vacancy = market().openVacancyForRole(rivalClub.id, "SCOUT");
      expect(vacancy?.reason).toBe("EXPIRED");
    }
  });

  it("recruits AI clubs into open core roles, reusing free agents before generating new candidates, and skips the player's own club", () => {
    // A fresh club, untouched by earlier tests, so role slots start empty.
    const thirdClub: Club = {
      id: createStableEntityId("club", "sm-third"),
      name: "Third FC",
      countryId: country.id,
      ownershipType: "PRIVATE",
    };
    const thirdTeam: Team = {
      id: createStableEntityId("team", "sm-third-senior"),
      clubId: thirdClub.id,
      name: "Third FC",
      level: "senior",
      gender: "men",
    };
    world().insertClub(thirdClub);
    world().insertTeam(thirdTeam);
    world().insertClubMembership({
      id: createStableEntityId("membership", thirdClub.id),
      clubId: thirdClub.id,
      teamId: thirdTeam.id,
      competitionId,
      competitionSeasonId: seasonId,
      membershipType: "LEAGUE_MEMBER",
      status: "ACTIVE",
    });
    finances().upsertClubFinancialProfile({
      id: createStableEntityId("finance", thirdClub.id),
      clubId: thirdClub.id,
      wageBudget: 5_000_000,
      transferBudget: 0,
      currentWageSpend: 0,
      financialHealth: "STABLE",
      currency: "NPR",
      status: "SIMULATION_ONLY",
    });

    // A pre-existing unemployed candidate should be reused for one role.
    const freeAgentId = createStableEntityId("person", "sm-free-agent-scout");
    world().insertPerson({ id: freeAgentId, fullName: "Free Agent Scout", nationalityCountryId: country.id, languages: ["ne"] });
    world().insertStaffProfile({
      id: createStableEntityId("staff-profile", freeAgentId),
      personId: freeAgentId,
      preferredRole: "SCOUT",
      salaryExpectation: "LOW",
      reputation: "LOW",
      countryKnowledge: [],
      clubKnowledge: [],
      availability: "AVAILABLE",
      workEligibilityStatus: "ELIGIBLE",
    });

    ensureAiStaffAssigned(db, saveAt("2026-08-01"), club.id);

    // The player's own club must not be auto-staffed.
    expect(market().activeAppointmentsForClub(club.id)).toHaveLength(0);

    // The free agent should be reused as a SCOUT specialist somewhere.
    expect(market().activeAppointment(freeAgentId)?.role).toBe("SCOUT");
    const thirdStaff = market().activeAppointmentsForClub(thirdClub.id);
    const roles = new Set(thirdStaff.map((appointment) => appointment.role));
    expect(roles.has("GOALKEEPER_COACH")).toBe(true);
    expect(roles.has("FITNESS_COACH")).toBe(true);
  });

  it("reports career history combining staff events and contracts", () => {
    const view = staffCareerHistory(db, gkCoachId);
    expect(view.history.length).toBeGreaterThanOrEqual(2);
    expect(view.contracts.length).toBeGreaterThanOrEqual(1);
  });

  it("persists staff appointments, contracts and vacancies across a save/load cycle", () => {
    db.close();
    db = openGameDatabase(dbPath);

    const reopened = new StaffMarketRepository(db);
    expect(reopened.activeAppointment(freeAgentPersonIdPlaceholder())).toBeUndefined();
    const rivalStaff = reopened.activeAppointmentsForClub(rivalClub.id);
    expect(rivalStaff.length).toBeGreaterThan(0);
    expect(reopened.openVacancyForRole(club.id, "GOALKEEPER_COACH")?.status).toBe("VACANT");
  });

  function freeAgentPersonIdPlaceholder(): EntityId {
    return createStableEntityId("person", "sm-does-not-exist");
  }
});
