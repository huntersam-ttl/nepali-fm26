import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GlobalFootballContextRepository,
  StaffMarketRepository,
  TransferMarketRepository,
  WorldRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  acceptStaffApplication,
  applyForStaffVacancy,
  createNepalSave,
  ensureAiStaffAssigned,
  hireStaff,
  openStaffVacancy,
  processExternalStaffVacancies,
  retireStaff,
  shortlistStaffCandidates,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const saveAt = (worldDate: string) => ({
  id: createStableEntityId("save", "staff-global-mobility"),
  name: "Staff global mobility",
  worldDate,
  databaseVersion: 64,
  gameVersion: "test",
  randomSeed: "staff-global-mobility",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSavedAt: "2026-01-01T00:00:00.000Z",
});

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("global staff mobility", () => {
  it("moves one staff identity through both directions, preserves exact-once contracts/history, and refills Nepal", () => {
    const directory = mkdtempSync(join(tmpdir(), "staff-global-mobility-"));
    tempDirs.push(directory);
    const db = openGameDatabase(join(directory, "world.sqlite"));
    migrateDatabase(db);
    try {
      const world = new WorldRepository(db);
      const market = new StaffMarketRepository(db);
      const finances = new TransferMarketRepository(db);
      const nepalId = createStableEntityId("country", "mobility-np");
      const indiaId = createStableEntityId("country", "mobility-in");
      const federationId = createStableEntityId("federation", "mobility-in");
      const leagueId = createStableEntityId("competition", "mobility-in");
      const nepalLeagueId = createStableEntityId("competition", "mobility-nepal");
      const nepalSeasonId = createStableEntityId("season", "mobility-nepal-2026");
      const nepalClubId = createStableEntityId("club", "mobility-nepal");
      const externalClubId = createStableEntityId("club", "mobility-external");
      const nepalTeamId = createStableEntityId("team", "mobility-nepal");
      const externalTeamId = createStableEntityId("team", "mobility-external");
      world.insertCountry({ id: nepalId, name: "Nepal", isoCode: "NPL" });
      world.insertCountry({ id: indiaId, name: "India", isoCode: "IND" });
      world.insertFederation({ id: federationId, countryId: indiaId, name: "India FA" });
      world.insertCompetition({ id: leagueId, federationId, name: "India Context League", scope: "domestic" });
      world.insertCompetition({ id: nepalLeagueId, name: "Nepal Mobility League", scope: "domestic" });
      world.insertClub({ id: nepalClubId, name: "Nepal Mobility FC", countryId: nepalId, ownershipType: "PRIVATE" });
      world.insertClub({ id: externalClubId, name: "India Mobility FC", countryId: indiaId, ownershipType: "PRIVATE", canonicalExternalId: "MOBILITY-EXTERNAL" });
      world.insertTeam({ id: nepalTeamId, clubId: nepalClubId, name: "Nepal Mobility Senior", level: "senior", gender: "men" });
      world.insertTeam({ id: externalTeamId, clubId: externalClubId, federationId, name: "India Mobility Senior", level: "senior", gender: "men" });
      world.insertCompetitionSeason({ id: nepalSeasonId, competitionId: nepalLeagueId, name: "Nepal Mobility 2026", startDate: "2026-08-01", endDate: "2027-05-31" });
      world.insertClubMembership({ id: createStableEntityId("membership", nepalClubId), clubId: nepalClubId, teamId: nepalTeamId, competitionId: nepalLeagueId, competitionSeasonId: nepalSeasonId, membershipType: "LEAGUE_MEMBER", status: "ACTIVE" });
      new GlobalFootballContextRepository(db).upsertFederation({ federationId, countryId: indiaId, confederation: "AFC", reputation: 45, simulationDepth: "CONTEXT_ONLY", updatedOn: "2026-08-01" });
      new GlobalFootballContextRepository(db).upsertLeague({ leagueId, federationId, countryId: indiaId, tier: 1, reputation: 45, simulationDepth: "CONTEXT_ONLY", continentalQualification: true });
      new GlobalFootballContextRepository(db).upsertClub({ clubId: externalClubId, leagueId, federationId, countryId: indiaId, reputation: 55, financialBand: "MEDIUM", academyStrength: 45, scoutingReach: 45, recruitmentRegions: ["SOUTH_ASIA"], simulationDepth: "CONTEXT_ONLY" });
      finances.upsertClubFinancialProfile({ id: createStableEntityId("finance", nepalClubId), clubId: nepalClubId, wageBudget: 20_000_000, transferBudget: 0, currentWageSpend: 0, financialHealth: "STABLE", currency: "NPR", status: "SIMULATION_ONLY" });

      const staffId = createStableEntityId("person", "mobility-scout");
      world.insertPerson({ id: staffId, fullName: "Context Scout", nationalityCountryId: indiaId, languages: ["en"] });
      world.insertPersonRole({ id: createStableEntityId("role", staffId), personId: staffId, role: "STAFF", activeFrom: "2026-08-01" });
      world.insertStaffProfile({ id: createStableEntityId("profile", staffId), personId: staffId, preferredRole: "SCOUT", salaryExpectation: "LOW", reputation: "LOW", countryKnowledge: [indiaId], clubKnowledge: [externalClubId], availability: "EMPLOYED", workEligibilityStatus: "ELIGIBLE" });
      const initialAppointment = hireStaff(db, saveAt("2026-08-01"), externalClubId, externalTeamId, staffId, "SCOUT", 450_000);
      const nepalVacancy = openStaffVacancy(db, nepalClubId, "SCOUT", "NEW_ROLE", "2026-08-02");
      const { application: inbound } = applyForStaffVacancy(db, saveAt("2026-08-02"), nepalVacancy.id, staffId, 1_000_000);
      expect(["OFFERED", "COUNTERED"]).toContain(inbound.status);
      const nepalAppointment = acceptStaffApplication(db, saveAt("2026-08-02"), inbound.id);
      expect(nepalAppointment.personId).toBe(staffId);
      expect(market.appointmentById(initialAppointment.id)?.employmentStatus).toBe("FORMER");
      expect(market.activeAppointment(staffId)?.clubId).toBe(nepalClubId);
      expect(market.employmentContractsForPerson(staffId).filter((contract) => contract.status === "ACTIVE")).toHaveLength(1);
      expect(finances.clubFinancialProfile(nepalClubId)?.currentWageSpend).toBe(1_000_000);

      const returnVacancy = market.openVacancyForRole(externalClubId, "SCOUT")!;
      const { application: outbound } = applyForStaffVacancy(db, saveAt("2026-08-03"), returnVacancy.id, staffId, 1_800_000);
      expect(["OFFERED", "COUNTERED"]).toContain(outbound.status);
      acceptStaffApplication(db, saveAt("2026-08-03"), outbound.id);
      expect(market.activeAppointment(staffId)?.clubId).toBe(externalClubId);
      expect(market.employmentContractsForPerson(staffId).filter((contract) => contract.status === "ACTIVE")).toHaveLength(1);
      expect(market.employmentContractsForPerson(staffId).filter((contract) => contract.status === "RESIGNED")).toHaveLength(2);
      expect(finances.clubFinancialProfile(nepalClubId)?.currentWageSpend).toBe(0);
      expect(market.staffHistoryForPerson(staffId).filter((event) => event.eventType === "STAFF_LEFT")).toHaveLength(2);
      expect(shortlistStaffCandidates(db, nepalClubId, "SCOUT").length).toBeLessThanOrEqual(8);

      ensureAiStaffAssigned(db, saveAt("2026-08-20"), undefined);
      expect(market.activeAppointmentsForClub(nepalClubId).some((appointment) => appointment.role === "SCOUT")).toBe(true);

      db.close();
      const reopened = openGameDatabase(join(directory, "world.sqlite"));
      try {
        const reopenedMarket = new StaffMarketRepository(reopened);
        expect(reopenedMarket.activeAppointment(staffId)?.clubId).toBe(externalClubId);
        expect(reopenedMarket.employmentContractsForPerson(staffId).filter((contract) => contract.status === "ACTIVE")).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      try { db.close(); } catch { /* already closed for reload */ }
    }
  });

  it("rejects an unqualified move without employment side effects and replaces a retired external staff member", () => {
    const directory = mkdtempSync(join(tmpdir(), "staff-global-replacement-"));
    tempDirs.push(directory);
    const db = openGameDatabase(join(directory, "world.sqlite"));
    migrateDatabase(db);
    try {
      const world = new WorldRepository(db);
      const nepalId = createStableEntityId("country", "replacement-np");
      const externalCountryId = createStableEntityId("country", "replacement-external");
      const federationId = createStableEntityId("federation", "replacement-external");
      const leagueId = createStableEntityId("competition", "replacement-external");
      const externalClubId = createStableEntityId("club", "replacement-external");
      const externalTeamId = createStableEntityId("team", "replacement-external");
      world.insertCountry({ id: nepalId, name: "Nepal", isoCode: "NPL" });
      world.insertCountry({ id: externalCountryId, name: "Bhutan", isoCode: "BTN" });
      world.insertFederation({ id: federationId, countryId: externalCountryId, name: "Bhutan FA" });
      world.insertCompetition({ id: leagueId, federationId, name: "Bhutan Context League", scope: "domestic" });
      world.insertClub({ id: externalClubId, name: "Replacement Context FC", countryId: externalCountryId, ownershipType: "PRIVATE" });
      world.insertTeam({ id: externalTeamId, clubId: externalClubId, federationId, name: "Replacement Context Senior", level: "senior", gender: "men" });
      const contexts = new GlobalFootballContextRepository(db);
      contexts.upsertFederation({ federationId, countryId: externalCountryId, confederation: "AFC", reputation: 40, simulationDepth: "CONTEXT_ONLY", updatedOn: "2026-08-01" });
      contexts.upsertLeague({ leagueId, federationId, countryId: externalCountryId, tier: 1, reputation: 40, simulationDepth: "CONTEXT_ONLY", continentalQualification: true });
      contexts.upsertClub({ clubId: externalClubId, leagueId, federationId, countryId: externalCountryId, reputation: 40, financialBand: "MEDIUM", academyStrength: 40, scoutingReach: 40, recruitmentRegions: ["SOUTH_ASIA"], simulationDepth: "CONTEXT_ONLY" });
      const candidateId = createStableEntityId("person", "replacement-unqualified");
      world.insertPerson({ id: candidateId, fullName: "Unqualified Coach", nationalityCountryId: nepalId, languages: ["ne"] });
      world.insertStaffProfile({ id: createStableEntityId("profile", candidateId), personId: candidateId, preferredRole: "HEAD_COACH", countryKnowledge: [], clubKnowledge: [], availability: "AVAILABLE", workEligibilityStatus: "ELIGIBLE" });
      const headCoachVacancy = openStaffVacancy(db, externalClubId, "HEAD_COACH", "NEW_ROLE", "2026-08-01");
      const { application: rejected } = applyForStaffVacancy(db, saveAt("2026-08-01"), headCoachVacancy.id, candidateId, 5_000_000);
      expect(rejected.status).toBe("REJECTED");
      expect(new StaffMarketRepository(db).activeAppointment(candidateId)).toBeUndefined();

      const lowOfferId = createStableEntityId("person", "replacement-low-offer-scout");
      world.insertPerson({ id: lowOfferId, fullName: "Low Offer Scout", nationalityCountryId: nepalId, languages: ["ne"] });
      world.insertStaffProfile({ id: createStableEntityId("profile", lowOfferId), personId: lowOfferId, preferredRole: "SCOUT", countryKnowledge: [], clubKnowledge: [], availability: "AVAILABLE", workEligibilityStatus: "ELIGIBLE" });
      const scoutVacancy = openStaffVacancy(db, externalClubId, "SCOUT", "NEW_ROLE", "2026-08-01");
      const { application: lowOffer } = applyForStaffVacancy(db, saveAt("2026-08-01"), scoutVacancy.id, lowOfferId, 1);
      expect(lowOffer.status).toBe("REJECTED");
      expect(new StaffMarketRepository(db).activeAppointment(lowOfferId)).toBeUndefined();

      const directorVacancy = openStaffVacancy(db, externalClubId, "SPORTING_DIRECTOR", "NEW_ROLE", "2026-08-01");
      const first = processExternalStaffVacancies(db, saveAt("2026-08-01"));
      const firstOutcome = first.find((outcome) => outcome.vacancyId === directorVacancy.id)!;
      expect(firstOutcome.generatedReplacement).toBe(true);
      expect(firstOutcome.applicationStatus).toBeDefined();
      const hired = new StaffMarketRepository(db).activeAppointmentsForClub(externalClubId).find((appointment) => appointment.role === "SPORTING_DIRECTOR")!;
      expect(hired).toBeDefined();
      retireStaff(db, saveAt("2026-08-02"), hired.personId);
      expect(new StaffMarketRepository(db).activeAppointment(hired.personId)).toBeUndefined();
      expect(new StaffMarketRepository(db).staffProfile(hired.personId)?.availability).toBe("RETIRED");
      const replacement = processExternalStaffVacancies(db, saveAt("2026-08-02"));
      expect(replacement.some((outcome) => outcome.generatedReplacement)).toBe(true);
      expect(contexts.clubs().find((club) => club.clubId === externalClubId)?.simulationDepth).toBe("CONTEXT_ONLY");
    } finally {
      db.close();
    }
  });

  it("imports a factual external staff identity into the bounded Nepal shortlist", () => {
    const directory = mkdtempSync(join(tmpdir(), "staff-global-imported-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "world.sqlite");
    createNepalSave({ databasePath, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "Imported staff", gameVersion: "test", randomSeed: "imported-staff" });
    const db = openGameDatabase(databasePath);
    try {
      const nepalClub = db.prepare("SELECT c.id FROM clubs c JOIN countries country ON country.id=c.country_id WHERE country.iso_code IN ('NP','NPL') ORDER BY c.id LIMIT 1").get() as { id: EntityId };
      const candidates = shortlistStaffCandidates(db, nepalClub.id, "HEAD_COACH");
      const imported = candidates.find((candidate) => Boolean(db.prepare("SELECT 1 FROM global_dataset_import_records WHERE entity_type='STAFF' AND provenance='VERIFIED' AND canonical_id=?").get(candidate.personId)));
      expect(imported).toBeDefined();
      const externalAppointment = db.prepare("SELECT sa.person_id FROM staff_appointments sa JOIN external_club_context ecc ON ecc.club_id=sa.club_id WHERE sa.person_id=? AND sa.employment_status='ACTIVE'").get(imported!.personId) as { person_id: EntityId } | undefined;
      expect(externalAppointment?.person_id).toBe(imported!.personId);
      expect(candidates.length).toBeLessThanOrEqual(8);
    } finally {
      db.close();
    }
  }, 300000);
});
