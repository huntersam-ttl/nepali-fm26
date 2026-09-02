import { describe, expect, it } from "vitest";
import { CareerWorldRepository, ClubEconomyRepository, ManagerRepository, SquadDynamicsRepository, WorldRepository, migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import { createCareerCharacter, createOwnerManagerMeeting, ownerManagerMeetingOverview, resolveOwnerManagerMeeting } from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type ManagerContract, type Team } from "@nepal-football-sim/shared-types";

/**
 * On every real save, club_board_policies.chairman_person_id is unset —
 * only the chairman demo/CLI helper (a fake demo person) ever wrote it, and
 * even that helper only put it in its own report struct, never the actual
 * database row. This reproduces the real shape (a genuine controlling
 * ownership stake, no chairman_person_id) and confirms
 * createOwnerManagerMeeting self-heals it from real ownership instead of
 * throwing OWNER_MANAGER_MEETING_REQUIRES_ACTIVE_MANAGER_AND_CHAIRMAN.
 */
describe("owner-manager meeting overview and real-save chairman resolution", () => {
  const setup = () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const countryId = createStableEntityId("country", "omo-country");
    const clubId = createStableEntityId("club", "omo-club");
    const teamId = createStableEntityId("team", "omo-team");
    const ownerId = createStableEntityId("person", "omo-owner");
    const club: Club = { id: clubId, name: "Overview FC", countryId, ownershipType: "PRIVATE" };
    const team: Team = { id: teamId, clubId, name: "Overview FC", level: "senior", gender: "men" };
    world.insertCountry({ id: countryId, name: "Nepal", isoCode: "NP" });
    world.insertClub(club);
    world.insertTeam(team);
    world.insertPerson({ id: ownerId, fullName: "Owner", nationalityCountryId: countryId, languages: ["en"] });

    // A genuine controlling ownership stake, exactly how every real player-
    // owner career actually establishes control — never via
    // club_board_policies.chairman_person_id.
    db.prepare(
      "INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(createStableEntityId("stake", clubId), clubId, "PERSON", ownerId, "Owner", "MAJORITY_OWNER", 75, 75, "2026-08-01", "ACTIVE", "BUYABLE", "SIMULATION_ONLY");

    // A real board-policy row with no chairman set — the real-save shape.
    db.prepare(
      "INSERT INTO club_board_policies (club_id, financial_risk_tolerance, transfer_philosophy, youth_priority, commercial_priority, infrastructure_priority, strategic_objective, updated_at, status) VALUES (?, 'BALANCED', 'BALANCED', 0.6, 0.4, 0.5, 'STABILITY', '2026-08-01', 'SIMULATION_ONLY')",
    ).run(clubId);

    const character = createCareerCharacter({
      fullName: "Manager",
      dateOfBirth: "1980-01-01",
      startingAge: 46,
      nationalityCountryId: countryId,
      languages: ["en"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER",
      coachingExperience: "SENIOR_COACH",
      coachingLicences: [],
      businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER",
      careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    const managers = new ManagerRepository(db);
    managers.insertProfile(character.managerProfile);
    const contract: ManagerContract = {
      id: createStableEntityId("manager-contract", "omo-contract"),
      managerProfileId: character.managerProfile.id,
      personId: character.person.id,
      teamId,
      clubId,
      jobTitle: "Head Coach",
      contractStart: "2026-08-01",
      salaryAmountMinor: 100_000,
      currency: "NPR",
      status: "ACTIVE",
    };
    managers.insertContract(contract);
    new CareerWorldRepository(db).upsertBoardConfidence({ clubId, confidence: 55, expectation: "PROMOTION", lastEvaluatedOn: "2026-08-01" });

    return { db, clubId, ownerId, managerPersonId: character.person.id };
  };

  it("resolves the real controlling owner as chairman instead of throwing, and self-heals the board-policy row", () => {
    const { db, clubId, ownerId } = setup();
    expect(new ClubEconomyRepository(db).boardPolicy(clubId)?.chairmanPersonId).toBeUndefined();

    const meeting = createOwnerManagerMeeting(db, { clubId, date: "2026-09-01", topic: "FORM" });
    expect(meeting.initiator.entityId).toBe(ownerId);
    expect(new ClubEconomyRepository(db).boardPolicy(clubId)?.chairmanPersonId).toBe(ownerId);

    db.close();
  });

  /**
   * Some real clubs have NO club_board_policies row at all (not merely one
   * with an unset chairman_person_id, the shape `setup()` above reproduces).
   * This is the exact live shape that broke "Nepal Community FC": the
   * self-heal resolved the chairman correctly at meeting-open time, but a
   * missing-row guard skipped persisting it, so the meeting's own
   * authoritative execution step re-read boardPolicy(clubId) later, found no
   * row, and failed with OWNER_MANAGER_MEETING_CHAIRMAN_MISMATCH even though
   * the meeting had just been legitimately opened and accepted.
   */
  it("resolves and persists a chairman even when club_board_policies has no row at all, and completes the meeting end to end", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const countryId = createStableEntityId("country", "omo-nopolicy-country");
    const clubId = createStableEntityId("club", "omo-nopolicy-club");
    const teamId = createStableEntityId("team", "omo-nopolicy-team");
    const ownerId = createStableEntityId("person", "omo-nopolicy-owner");
    const club: Club = { id: clubId, name: "No Policy Row FC", countryId, ownershipType: "PRIVATE" };
    const team: Team = { id: teamId, clubId, name: "No Policy Row FC", level: "senior", gender: "men" };
    world.insertCountry({ id: countryId, name: "Nepal", isoCode: "NP" });
    world.insertClub(club);
    world.insertTeam(team);
    world.insertPerson({ id: ownerId, fullName: "Owner", nationalityCountryId: countryId, languages: ["en"] });
    db.prepare(
      "INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(createStableEntityId("stake", clubId), clubId, "PERSON", ownerId, "Owner", "MAJORITY_OWNER", 100, 100, "2026-08-01", "ACTIVE", "BUYABLE", "SIMULATION_ONLY");
    // Deliberately no club_board_policies row at all — the real bug shape.
    expect(new ClubEconomyRepository(db).boardPolicy(clubId)).toBeUndefined();

    const character = createCareerCharacter({
      fullName: "Manager",
      dateOfBirth: "1980-01-01",
      startingAge: 46,
      nationalityCountryId: countryId,
      languages: ["en"],
      footballBackground: "LOCAL_FOOTBALL",
      education: "UNIVERSITY",
      playingExperience: "PROFESSIONAL_PLAYER",
      coachingExperience: "SENIOR_COACH",
      coachingLicences: [],
      businessBackground: "NONE",
      startingReputationProfile: "FORMER_PLAYER",
      careerStartDate: "2026-08-01",
    });
    world.insertPerson(character.person);
    const managers = new ManagerRepository(db);
    managers.insertProfile(character.managerProfile);
    const contract: ManagerContract = {
      id: createStableEntityId("manager-contract", "omo-nopolicy-contract"),
      managerProfileId: character.managerProfile.id,
      personId: character.person.id,
      teamId,
      clubId,
      jobTitle: "Head Coach",
      contractStart: "2026-08-01",
      salaryAmountMinor: 100_000,
      currency: "NPR",
      status: "ACTIVE",
    };
    managers.insertContract(contract);
    new CareerWorldRepository(db).upsertBoardConfidence({ clubId, confidence: 58, expectation: "PROMOTION", lastEvaluatedOn: "2026-08-01" });

    const meeting = createOwnerManagerMeeting(db, { clubId, date: "2026-09-01", topic: "SQUAD_STRENGTHENING" });
    expect(meeting.initiator.entityId).toBe(ownerId);
    // The self-heal must have created and persisted a full policy row, not
    // just resolved the value in memory.
    expect(new ClubEconomyRepository(db).boardPolicy(clubId)?.chairmanPersonId).toBe(ownerId);

    const resolved = resolveOwnerManagerMeeting(db, {
      interactionId: meeting.id,
      date: "2026-09-01",
      seed: "owner-meeting-nopolicy",
      stance: "REQUEST",
      commitment: {
        type: "SQUAD_STRENGTHENING",
        targetCriteria: "IMPROVE_SQUAD_DEPTH",
        description: "Strengthen the squad before the next transfer window closes.",
        dueOn: "2027-01-31",
      },
    });
    expect(resolved.execution?.status).toBe("APPLIED");
    expect(resolved.execution?.error).toBeUndefined();
    expect(new SquadDynamicsRepository(db).promisesForPerson(character.person.id, teamId)).toHaveLength(1);
    db.close();
  });

  it("builds an honest overview from real board confidence, vision, and budgets", () => {
    const { db, clubId, managerPersonId } = setup();
    const overview = ownerManagerMeetingOverview(db, clubId, "2026-09-01");
    expect(overview.clubId).toBe(clubId);
    expect(overview.managerPersonId).toBe(managerPersonId);
    expect(overview.boardConfidence).toBe(55);
    expect(overview.boardExpectation).toBe("PROMOTION");
    expect(overview.vision?.objective).toBe("STABILITY");
    expect(overview.recentForm).toEqual([]);
    expect(overview.history).toEqual([]);
    expect(overview.openMeeting).toBeUndefined();
    db.close();
  });

  it("throws a clear error for a club with no genuine controlling owner", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    expect(() => createOwnerManagerMeeting(db, { clubId: createStableEntityId("club", "missing"), date: "2026-09-01", topic: "FORM" })).toThrow(
      /OWNER_MANAGER_MEETING_REQUIRES_ACTIVE_MANAGER_AND_CHAIRMAN/,
    );
    db.close();
  });
});
