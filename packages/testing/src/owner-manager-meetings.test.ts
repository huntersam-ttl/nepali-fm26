import { describe, expect, it } from "vitest";
import { CareerWorldRepository, ManagerRepository, SquadDynamicsRepository, WorldRepository, migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import { createCareerCharacter, createOwnerManagerMeeting, resolveOwnerManagerMeeting } from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type ManagerContract, type Team } from "@nepal-football-sim/shared-types";

describe("owner-manager meetings", () => {
  it("applies a measurable commitment and board consequences exactly once", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const countryId = createStableEntityId("country", "owner-meeting-country");
    const clubId = createStableEntityId("club", "owner-meeting-club");
    const teamId = createStableEntityId("team", "owner-meeting-team");
    const chairmanId = createStableEntityId("person", "owner-meeting-chairman");
    const club: Club = { id: clubId, name: "Meeting FC", countryId, ownershipType: "PRIVATE" };
    const team: Team = { id: teamId, clubId, name: "Meeting FC", level: "senior", gender: "men" };
    world.insertCountry({ id: countryId, name: "Nepal", isoCode: "NP" });
    world.insertClub(club);
    world.insertTeam(team);
    world.insertPerson({ id: chairmanId, fullName: "Chairman", nationalityCountryId: countryId, languages: ["en"] });
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
      id: createStableEntityId("manager-contract", "owner-meeting-contract"),
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
    const careerWorld = new CareerWorldRepository(db);
    careerWorld.upsertBoardConfidence({ clubId, confidence: 55, expectation: "PROMOTION", lastEvaluatedOn: "2026-08-01" });
    db.prepare(`INSERT INTO club_board_policies (club_id, financial_risk_tolerance, transfer_philosophy, youth_priority, commercial_priority, infrastructure_priority, strategic_objective, chairman_person_id, updated_at, status) VALUES (?, 'BALANCED', 'BALANCED', 60, 40, 50, 'PROMOTION', ?, '2026-08-01', 'SIMULATION_ONLY')`).run(clubId, chairmanId);

    const meeting = createOwnerManagerMeeting(db, { clubId, date: "2026-09-01", topic: "SQUAD_STRENGTHENING" });
    const resolved = resolveOwnerManagerMeeting(db, {
      interactionId: meeting.id,
      date: "2026-09-02",
      seed: "owner-meeting",
      stance: "REQUEST",
      commitment: {
        type: "SQUAD_STRENGTHENING",
        targetCriteria: "IMPROVE_SQUAD_DEPTH",
        description: "Strengthen the squad before the next season.",
        dueOn: "2027-05-31",
      },
    });
    expect(resolved.execution?.status).toBe("APPLIED");
    expect(new CareerWorldRepository(db).boardConfidence(clubId)?.confidence).toBe(56);
    expect(new SquadDynamicsRepository(db).promisesForPerson(character.person.id, teamId)).toHaveLength(1);
    // A concise, stance-driven label — not the old internal-sounding
    // "applied through board confidence and relationship systems" sentence.
    expect(resolved.outcome).toBe("Commitment agreed");
    const again = resolveOwnerManagerMeeting(db, { interactionId: meeting.id, date: "2026-09-03", seed: "other", stance: "CONCERN" });
    expect(again.execution?.status).toBe("APPLIED");
    expect(new CareerWorldRepository(db).boardConfidence(clubId)?.confidence).toBe(56);
    db.close();
  });

  it("rejects a meeting opened by a non-chairman actor", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    expect(() => createOwnerManagerMeeting(db, { clubId: "missing-club" as EntityId, date: "2026-09-01", topic: "FORM" })).toThrow();
    db.close();
  });

  it("labels a plain SUPPORT/CONCERN outcome (no commitment) concisely, from the real stance", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const world = new WorldRepository(db);
    const countryId = createStableEntityId("country", "owner-meeting-label-country");
    const clubId = createStableEntityId("club", "owner-meeting-label-club");
    const teamId = createStableEntityId("team", "owner-meeting-label-team");
    const chairmanId = createStableEntityId("person", "owner-meeting-label-chairman");
    world.insertCountry({ id: countryId, name: "Nepal", isoCode: "NP" });
    world.insertClub({ id: clubId, name: "Label FC", countryId, ownershipType: "PRIVATE" });
    world.insertTeam({ id: teamId, clubId, name: "Label FC", level: "senior", gender: "men" });
    world.insertPerson({ id: chairmanId, fullName: "Chairman", nationalityCountryId: countryId, languages: ["en"] });
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
    managers.insertContract({
      id: createStableEntityId("manager-contract", "owner-meeting-label-contract"),
      managerProfileId: character.managerProfile.id,
      personId: character.person.id,
      teamId,
      clubId,
      jobTitle: "Head Coach",
      contractStart: "2026-08-01",
      salaryAmountMinor: 100_000,
      currency: "NPR",
      status: "ACTIVE",
    });
    new CareerWorldRepository(db).upsertBoardConfidence({ clubId, confidence: 55, expectation: "PROMOTION", lastEvaluatedOn: "2026-08-01" });
    db.prepare(`INSERT INTO club_board_policies (club_id, financial_risk_tolerance, transfer_philosophy, youth_priority, commercial_priority, infrastructure_priority, strategic_objective, chairman_person_id, updated_at, status) VALUES (?, 'BALANCED', 'BALANCED', 60, 40, 50, 'PROMOTION', ?, '2026-08-01', 'SIMULATION_ONLY')`).run(clubId, chairmanId);

    const supportMeeting = createOwnerManagerMeeting(db, { clubId, date: "2026-09-01", topic: "FORM" });
    const supportResolved = resolveOwnerManagerMeeting(db, { interactionId: supportMeeting.id, date: "2026-09-02", seed: "support", stance: "SUPPORT" });
    expect(supportResolved.outcome).toBe("Support extended");

    const concernMeeting = createOwnerManagerMeeting(db, { clubId, date: "2026-09-05", topic: "FORM" });
    const concernResolved = resolveOwnerManagerMeeting(db, { interactionId: concernMeeting.id, date: "2026-09-06", seed: "concern", stance: "CONCERN" });
    expect(concernResolved.outcome).toBe("Concern raised");
    db.close();
  });
});
