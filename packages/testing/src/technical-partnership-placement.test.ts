import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubNetworkRepository, GlobalFootballContextRepository, StaffMarketRepository, WorldRepository, migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import { activateClubPartnership, completeTechnicalPartnershipPlacements, createClubPartnership, hireStaff, planTechnicalPartnershipPlacements } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type SaveMetadata } from "@nepal-football-sim/shared-types";

const saveAt = (worldDate: string): SaveMetadata => ({ id: createStableEntityId("save", "technical-placement"), name: "Technical placement", worldDate, databaseVersion: 65, gameVersion: "test", randomSeed: "technical-placement", createdAt: worldDate, lastSavedAt: worldDate });

describe("technical partnership placements", () => {
  it("plans and completes one bounded placement without changing employment", () => {
    const directory = mkdtempSync(join(tmpdir(), "technical-placement-"));
    const db = openGameDatabase(join(directory, "world.sqlite"));
    migrateDatabase(db);
    try {
      const world = new WorldRepository(db);
      const np = createStableEntityId("country", "technical-np");
      const india = createStableEntityId("country", "technical-in");
      const home = createStableEntityId("club", "technical-home");
      const partner = createStableEntityId("club", "technical-imported-partner");
      const homeTeam = createStableEntityId("team", "technical-home");
      const partnerTeam = createStableEntityId("team", "technical-partner");
      const partnerFederation = createStableEntityId("federation", "technical-partner");
      const partnerLeague = createStableEntityId("competition", "technical-partner");
      world.insertCountry({ id: np, name: "Nepal", isoCode: "NPL" });
      world.insertCountry({ id: india, name: "India", isoCode: "IND" });
      world.insertFederation({ id: partnerFederation, countryId: india, name: "Imported Partner FA" });
      world.insertCompetition({ id: partnerLeague, federationId: partnerFederation, name: "Imported Partner League", scope: "domestic" });
      world.insertClub({ id: home, name: "Nepal Technical FC", countryId: np, ownershipType: "PRIVATE" });
      world.insertClub({ id: partner, name: "Imported Context Partner", countryId: india, ownershipType: "PRIVATE", canonicalExternalId: "CLB-TECHNICAL-001" });
      world.insertTeam({ id: homeTeam, clubId: home, name: "Nepal Technical Senior", level: "senior", gender: "men" });
      world.insertTeam({ id: partnerTeam, clubId: partner, name: "Imported Partner Senior", level: "senior", gender: "men" });
      new GlobalFootballContextRepository(db).upsertFederation({ federationId: partnerFederation, countryId: india, confederation: "AFC", reputation: 45, simulationDepth: "CONTEXT_ONLY", updatedOn: "2026-08-01" });
      new GlobalFootballContextRepository(db).upsertLeague({ leagueId: partnerLeague, federationId: partnerFederation, countryId: india, tier: 1, reputation: 45, simulationDepth: "CONTEXT_ONLY", continentalQualification: true });
      new GlobalFootballContextRepository(db).upsertClub({ clubId: partner, leagueId: partnerLeague, federationId: partnerFederation, countryId: india, reputation: 55, financialBand: "MEDIUM", academyStrength: 50, scoutingReach: 45, recruitmentRegions: ["SOUTH_ASIA"], simulationDepth: "CONTEXT_ONLY" });
      const person = createStableEntityId("person", "technical-coach");
      world.insertPerson({ id: person, fullName: "Generated Nepal Coach", nationalityCountryId: np, languages: ["ne"] });
      world.insertPersonRole({ id: createStableEntityId("role", person), personId: person, role: "STAFF", activeFrom: "2026-08-01" });
      world.insertStaffProfile({ id: createStableEntityId("profile", person), personId: person, preferredRole: "FIRST_TEAM_COACH", reputation: "MEDIUM", countryKnowledge: [np], clubKnowledge: [], availability: "AVAILABLE", workEligibilityStatus: "ELIGIBLE" });
      world.insertStaffSimulationProfile({ id: createStableEntityId("simulation", person), personId: person, coachingTechnical: 7, coachingTactical: 7, coachingPhysical: 7, coachingMental: 7, goalkeeping: 3, youthDevelopment: 6, manManagement: 7, status: "SIMULATION_ONLY" });
      world.insertStaffLicence({ id: createStableEntityId("licence", person), personId: person, licenceType: "AFC_C", issuer: "ANFA", status: "VERIFIED" });
      const save = saveAt("2026-08-01");
      hireStaff(db, save, home, homeTeam, person, "FIRST_TEAM_COACH", 400_000);
      const proposal = createClubPartnership(db, { fromClubId: home, toClubId: partner, partnershipType: "TECHNICAL", relationshipStrength: 0, startDate: save.worldDate });
      expect(planTechnicalPartnershipPlacements(db, save, home)).toEqual([]);
      activateClubPartnership(db, proposal.id, { date: save.worldDate, eligibility: { eligible: true, score: 60 } });
      const planned = planTechnicalPartnershipPlacements(db, save, home);
      expect(planned).toHaveLength(1);
      expect(planTechnicalPartnershipPlacements(db, save, home)).toEqual([]);
      expect(new StaffMarketRepository(db).activeAppointment(person)?.clubId).toBe(home);
      expect(new GlobalFootballContextRepository(db).clubs().find((club) => club.clubId === partner)?.simulationDepth).toBe("CONTEXT_ONLY");
      expect(completeTechnicalPartnershipPlacements(db, saveAt("2026-08-15"))).toEqual([]);
      const completed = completeTechnicalPartnershipPlacements(db, saveAt("2026-09-01"));
      expect(completed).toHaveLength(1);
      const market = new StaffMarketRepository(db);
      expect(market.staffSimulationProfile(person)?.coachingTechnical).toBe(8);
      expect(market.staffProfile(person)?.countryKnowledge).toContain(india);
      expect(market.activeAppointment(person)?.clubId).toBe(home);
      expect(market.staffHistoryForPerson(person).some((event) => event.eventType === "INTERNATIONAL_PLACEMENT_COMPLETED")).toBe(true);
      db.close();
      const reloaded = openGameDatabase(join(directory, "world.sqlite"));
      expect(new StaffMarketRepository(reloaded).technicalPlacementsForClub(home)).toHaveLength(1);
      expect(completeTechnicalPartnershipPlacements(reloaded, saveAt("2026-10-01"))).toEqual([]);
      reloaded.close();
      const inactiveDb = openGameDatabase(join(directory, "world.sqlite"));
      inactiveDb.prepare("UPDATE international_club_partnerships SET status='SUSPENDED' WHERE id=?").run(proposal.id);
      expect(new ClubNetworkRepository(inactiveDb).activeTechnicalPartnerships(home, "2026-10-01")).toEqual([]);
      inactiveDb.close();
    } finally {
      try { db.close(); } catch { /* closed for reload */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
