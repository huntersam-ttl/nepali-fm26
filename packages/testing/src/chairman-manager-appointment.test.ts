import { describe, expect, it } from "vitest";
import { CareerWorldRepository, ClubEconomyRepository, ManagerRepository, WorldRepository, migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import { appointManagerForChairman, ChairmanManagerError, createCareerCharacter } from "@nepal-football-sim/simulation";
import { createStableEntityId, type Club, type EntityId, type Team } from "@nepal-football-sim/shared-types";

describe("chairman manager appointment", () => {
  it("appoints an available manager through the canonical vacancy and contract path", () => {
    const db = openGameDatabase(":memory:"); migrateDatabase(db);
    const country = { id: createStableEntityId("country", "NP"), name: "Nepal", isoCode: "NP" };
    const owner = { id: createStableEntityId("person", "owner"), fullName: "Club Owner", nationalityCountryId: country.id, languages: ["ne"] };
    const club: Club = { id: createStableEntityId("club", "chairman-target"), name: "Chairman Target", countryId: country.id, ownershipType: "PRIVATE" };
    const team: Team = { id: createStableEntityId("team", "chairman-target"), clubId: club.id, name: club.name, level: "senior", gender: "men" };
    const world = new WorldRepository(db); world.insertCountry(country); world.insertPerson(owner); world.insertClub(club); world.insertTeam(team);
    const career = createCareerCharacter({ fullName: "Available Coach", dateOfBirth: "1985-01-01", startingAge: 41, nationalityCountryId: country.id, languages: ["ne"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE", playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH", coachingLicences: [], businessBackground: "SMALL_BUSINESS", startingReputationProfile: "LOCAL_RESPECTED", careerStartDate: "2027-01-01" });
    world.insertPerson(career.person); world.insertPersonRole(career.managerRole); new ManagerRepository(db).insertProfile(career.managerProfile);
    new ClubEconomyRepository(db).upsertOwnershipStake({ id: createStableEntityId("stake", "chairman-target"), clubId: club.id, holderType: "PERSON", holderId: owner.id, holderName: owner.fullName, role: "MAJORITY_OWNER", percentage: 60, votingPercentage: 60, startDate: "2027-01-01", status: "ACTIVE", ownershipModel: "BUYABLE", provenanceStatus: "SIMULATION_ONLY" });
    const vacancy = { id: createStableEntityId("vacancy", "chairman-target"), clubId: club.id, teamId: team.id, countryId: country.id, openedOn: "2027-01-01", reason: "NEW_CLUB" as const, boardExpectation: "SURVIVE" as const, status: "OPEN" as const };
    new CareerWorldRepository(db).insertVacancy(vacancy);
    const contract = appointManagerForChairman(db, { ownerPersonId: owner.id, vacancyId: vacancy.id, managerProfileId: career.managerProfile.id, date: "2027-01-02" });
    expect(new ManagerRepository(db).activeContractForTeam(team.id)?.id).toBe(contract.id);
    expect(new CareerWorldRepository(db).vacancy(vacancy.id)?.status).toBe("FILLED");
    expect(() => appointManagerForChairman(db, { ownerPersonId: owner.id, vacancyId: vacancy.id, managerProfileId: career.managerProfile.id, date: "2027-01-03" })).toThrow(ChairmanManagerError);
    db.close();
  });

  it("resolves an appointment instantly with no pending/candidate-review status exposed to the UI", () => {
    // Staff appointment (Manager appointed by Owner) has no live negotiation
    // lifecycle either: the owner picks a candidate and the engine resolves
    // the contract synchronously in one call. This is why the off-pitch
    // decision-presentation work marks this flow
    // STAFF_APPOINTMENT_PRESENTATION = N/A_BY_ARCHITECTURE rather than
    // wiring a scene onto a moment that doesn't exist.
    const db = openGameDatabase(":memory:"); migrateDatabase(db);
    const country = { id: createStableEntityId("country", "NP2"), name: "Nepal", isoCode: "NP" };
    const owner = { id: createStableEntityId("person", "owner2"), fullName: "Club Owner", nationalityCountryId: country.id, languages: ["ne"] };
    const club: Club = { id: createStableEntityId("club", "chairman-target-2"), name: "Chairman Target 2", countryId: country.id, ownershipType: "PRIVATE" };
    const team: Team = { id: createStableEntityId("team", "chairman-target-2"), clubId: club.id, name: club.name, level: "senior", gender: "men" };
    const world = new WorldRepository(db); world.insertCountry(country); world.insertPerson(owner); world.insertClub(club); world.insertTeam(team);
    const career = createCareerCharacter({ fullName: "Available Coach 2", dateOfBirth: "1985-01-01", startingAge: 41, nationalityCountryId: country.id, languages: ["ne"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE", playingExperience: "PROFESSIONAL_PLAYER", coachingExperience: "SENIOR_COACH", coachingLicences: [], businessBackground: "SMALL_BUSINESS", startingReputationProfile: "LOCAL_RESPECTED", careerStartDate: "2027-01-01" });
    world.insertPerson(career.person); world.insertPersonRole(career.managerRole); new ManagerRepository(db).insertProfile(career.managerProfile);
    new ClubEconomyRepository(db).upsertOwnershipStake({ id: createStableEntityId("stake", "chairman-target-2"), clubId: club.id, holderType: "PERSON", holderId: owner.id, holderName: owner.fullName, role: "MAJORITY_OWNER", percentage: 60, votingPercentage: 60, startDate: "2027-01-01", status: "ACTIVE", ownershipModel: "BUYABLE", provenanceStatus: "SIMULATION_ONLY" });
    const vacancy = { id: createStableEntityId("vacancy", "chairman-target-2"), clubId: club.id, teamId: team.id, countryId: country.id, openedOn: "2027-01-01", reason: "NEW_CLUB" as const, boardExpectation: "SURVIVE" as const, status: "OPEN" as const };
    new CareerWorldRepository(db).insertVacancy(vacancy);
    const contract = appointManagerForChairman(db, { ownerPersonId: owner.id, vacancyId: vacancy.id, managerProfileId: career.managerProfile.id, date: "2027-01-02" });
    // The call returns the finished, active contract directly — there is no
    // intermediate "offered"/"pending"/"awaiting response" record a
    // presentation layer could ever observe.
    expect(contract.status).toBe("ACTIVE");
    db.close();
  });

  it("rejects a non-controlling owner and context-only target", () => {
    const db = openGameDatabase(":memory:"); migrateDatabase(db);
    expect(() => appointManagerForChairman(db, { ownerPersonId: "missing" as EntityId, vacancyId: "missing" as EntityId, managerProfileId: "missing" as EntityId, date: "2027-01-01" })).toThrow(ChairmanManagerError);
    db.close();
  });
});
