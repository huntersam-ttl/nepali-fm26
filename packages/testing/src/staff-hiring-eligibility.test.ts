import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  StaffMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  StaffNegotiationError,
  applyForStaffVacancy,
  openStaffVacancy,
  staffEligibility,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type Club,
  type EntityId,
  type Team,
} from "@nepal-football-sim/shared-types";

/**
 * Domain-level coverage for the staff-hiring vacancy/role/authority contract:
 * applyForStaffVacancy must never return an apparently-successful response
 * with no explanation, must never let a manager act against a vacancy they
 * do not manage, and staffEligibility (the same check the desktop read model
 * uses to compute eligibleVacancyIds) must agree with what the hire command
 * itself enforces.
 */

const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "staff-hire-eligibility-test"),
  name: "Staff Hiring Eligibility Test",
  worldDate,
  databaseVersion: 38,
  gameVersion: "test",
  randomSeed: "staff-hire-eligibility-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

describe("staff hiring: vacancy/role eligibility and authority", () => {
  const savesDirectory = mkdtempSync(join(tmpdir(), "staff-hire-eligibility-"));
  const dbPath = join(savesDirectory, "career.sqlite");
  let db = openGameDatabase(dbPath);
  migrateDatabase(db);

  const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
  const club: Club = {
    id: createStableEntityId("club", "she-club"),
    name: "Eligibility FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const otherClub: Club = {
    id: createStableEntityId("club", "she-other-club"),
    name: "Other Club FC",
    countryId: country.id,
    ownershipType: "PRIVATE",
  };
  const team: Team = {
    id: createStableEntityId("team", "she-club-senior"),
    clubId: club.id,
    name: "Eligibility FC",
    level: "senior",
    gender: "men",
  };
  const otherTeam: Team = {
    id: createStableEntityId("team", "she-other-club-senior"),
    clubId: otherClub.id,
    name: "Other Club FC",
    level: "senior",
    gender: "men",
  };

  const scoutCandidateId = createStableEntityId("person", "she-scout-candidate");
  const fitnessCandidateId = createStableEntityId("person", "she-fitness-candidate");
  const unlicencedHeadCoachId = createStableEntityId("person", "she-unlicenced-head-coach");

  const world = () => new WorldRepository(db);
  const market = () => new StaffMarketRepository(db);

  beforeAll(() => {
    const w = world();
    w.insertCountry(country);
    w.insertClub(club);
    w.insertClub(otherClub);
    w.insertTeam(team);
    w.insertTeam(otherTeam);

    for (const [personId, name, preferredRole] of [
      [scoutCandidateId, "Scout Candidate", "SCOUT"],
      [fitnessCandidateId, "Fitness Candidate", "FITNESS_COACH"],
      [unlicencedHeadCoachId, "Unlicenced Head Coach", "HEAD_COACH"],
    ] as const) {
      w.insertPerson({
        id: personId,
        fullName: name,
        nationalityCountryId: country.id,
        languages: ["ne"],
      });
      w.insertStaffProfile({
        id: createStableEntityId("profile", personId),
        personId,
        preferredRole,
        salaryExpectation: "LOW",
        reputation: "MEDIUM",
        countryKnowledge: [country.id],
        clubKnowledge: [],
        availability: "AVAILABLE",
        workEligibilityStatus: "ELIGIBLE",
      });
    }
  });

  it("staffEligibility (the read model's own check) agrees with what applyForStaffVacancy enforces", () => {
    const scoutVacancy = openStaffVacancy(db, club.id, "SCOUT", "NEW_ROLE", "2026-08-01");
    const scoutProfile = market().staffProfile(scoutCandidateId);
    const scoutLicences = market().staffLicencesForPerson(scoutCandidateId);
    expect(staffEligibility("SCOUT", scoutProfile, scoutLicences).eligible).toBe(true);

    const headCoachVacancy = openStaffVacancy(db, club.id, "HEAD_COACH", "NEW_ROLE", "2026-08-01");
    const hcProfile = market().staffProfile(unlicencedHeadCoachId);
    const hcLicences = market().staffLicencesForPerson(unlicencedHeadCoachId);
    const eligibility = staffEligibility("HEAD_COACH", hcProfile, hcLicences);
    expect(eligibility.eligible).toBe(false);

    // The command must agree: a well-qualified candidate against a real
    // vacancy resolves as a genuine outcome (never silently nothing)...
    const { application: goodApplication, reason: goodReason } = applyForStaffVacancy(
      db,
      saveAt("2026-08-01"),
      scoutVacancy.id,
      scoutCandidateId,
      500_000,
      24,
    );
    expect(["OFFERED", "COUNTERED", "REJECTED"]).toContain(goodApplication.status);
    if (goodApplication.status !== "OFFERED") expect(goodReason).toBeTruthy();

    // ...and an unqualified candidate is REJECTED with the *same* reason the
    // read model would have shown before the hire was even attempted.
    const { application: badApplication, reason: badReason } = applyForStaffVacancy(
      db,
      saveAt("2026-08-01"),
      headCoachVacancy.id,
      unlicencedHeadCoachId,
      5_000_000,
      24,
    );
    expect(badApplication.status).toBe("REJECTED");
    expect(badReason).toBeTruthy();
    expect(badReason).toBe(eligibility.note);
  });

  it("never returns an apparently-successful response with no explanation for a rejection", () => {
    const vacancy = openStaffVacancy(db, club.id, "GOALKEEPER_COACH", "NEW_ROLE", "2026-08-01");
    // A candidate with a preferred role the requested role doesn't require
    // extra licence for, but who will not be interested at a token salary.
    const { application, reason } = applyForStaffVacancy(
      db,
      saveAt("2026-08-01"),
      vacancy.id,
      fitnessCandidateId,
      1,
      1,
    );
    if (application.status === "REJECTED") {
      expect(reason).toBeTruthy();
      expect(reason!.length).toBeGreaterThan(0);
    }
  });

  it("rejects a hire attempt against a vacancy the caller does not manage (insufficient authority)", () => {
    const vacancy = openStaffVacancy(db, otherClub.id, "SCOUT", "NEW_ROLE", "2026-08-02");
    expect(() =>
      applyForStaffVacancy(
        db,
        saveAt("2026-08-02"),
        vacancy.id,
        scoutCandidateId,
        500_000,
        24,
        club.id,
      ),
    ).toThrow(StaffNegotiationError);
    try {
      applyForStaffVacancy(
        db,
        saveAt("2026-08-02"),
        vacancy.id,
        scoutCandidateId,
        500_000,
        24,
        club.id,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(StaffNegotiationError);
      expect((error as InstanceType<typeof StaffNegotiationError>).code).toBe(
        "ROLE_NOT_AUTHORIZED",
      );
    }
    // The caller's own club vacancy is unaffected by the rejected attempt.
    expect(market().vacancyById(vacancy.id)?.status).toBe("VACANT");
  });

  it("allows the same call when the caller does manage the vacancy's club", () => {
    const vacancy = openStaffVacancy(db, club.id, "SCOUT", "NEW_ROLE", "2026-08-03");
    expect(() =>
      applyForStaffVacancy(
        db,
        saveAt("2026-08-03"),
        vacancy.id,
        scoutCandidateId,
        500_000,
        24,
        club.id,
      ),
    ).not.toThrow();
  });

  it("rejects a stale/already-filled vacancy cleanly rather than silently doing nothing", () => {
    const vacancy = openStaffVacancy(db, club.id, "SCOUT", "NEW_ROLE", "2026-08-04");
    market().upsertVacancy({ ...vacancy, status: "FILLED" });
    expect(() =>
      applyForStaffVacancy(db, saveAt("2026-08-04"), vacancy.id, scoutCandidateId, 500_000, 24),
    ).toThrow(StaffNegotiationError);
  });
});
