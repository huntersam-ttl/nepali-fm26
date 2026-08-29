import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GlobalFootballContextRepository, ClubNetworkRepository, WorldRepository, YouthRepository, openGameDatabase } from "@nepal-football-sim/database";
import { academyPartnershipDevelopmentContext, activateClubPartnership, createClubPartnership, createNepalSave, initializeYouthSystemForSave, runAnnualYouthAndRetirementCycle } from "@nepal-football-sim/simulation";
import { completeYouthDevelopmentPartnerships, planYouthDevelopmentPartnerships } from "@nepal-football-sim/simulation";
import { type EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

describe("youth and academy partnership pathways", () => {
  it("creates a bounded foreign youth programme and derives academy intake context", () => {
    const directory = mkdtempSync(join(tmpdir(), "youth-partnership-"));
    const path = join(directory, "career.sqlite");
    createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "Youth partnership", gameVersion: "test", randomSeed: "youth-partnership", globalSeedPath: null });
    const db = openGameDatabase(path);
    try {
      const world = new WorldRepository(db);
      const home = db.prepare("SELECT id FROM clubs WHERE canonical_external_id NOT LIKE 'SIM-FOREIGN-%' ORDER BY id LIMIT 1").get() as { id: EntityId };
      const partnerCountry = (db.prepare("SELECT id FROM countries WHERE iso_code='IND' LIMIT 1").get() as { id?: EntityId } | undefined)?.id ?? (world.insertCountry({ id: "youth-india" as EntityId, name: "India", isoCode: "IND" }), "youth-india" as EntityId);
      const partner = "youth-imported-partner" as EntityId;
      const federation = "youth-partner-federation" as EntityId;
      const league = "youth-partner-league" as EntityId;
      world.insertFederation({ id: federation, countryId: partnerCountry, name: "Partner FA" });
      world.insertCompetition({ id: league, federationId: federation, name: "Partner League", scope: "domestic" });
      world.insertClub({ id: partner, name: "Imported Youth Partner", countryId: partnerCountry, ownershipType: "PRIVATE", canonicalExternalId: "CLB-YOUTH-001" });
      new GlobalFootballContextRepository(db).upsertFederation({ federationId: federation, countryId: partnerCountry, confederation: "AFC", reputation: 45, simulationDepth: "CONTEXT_ONLY", updatedOn: "2026-08-01" });
      new GlobalFootballContextRepository(db).upsertLeague({ leagueId: league, federationId: federation, countryId: partnerCountry, tier: 1, reputation: 45, simulationDepth: "CONTEXT_ONLY", continentalQualification: true });
      new GlobalFootballContextRepository(db).upsertClub({ clubId: partner, leagueId: league, federationId: federation, countryId: partnerCountry, reputation: 55, financialBand: "MEDIUM", academyStrength: 50, scoutingReach: 45, recruitmentRegions: ["SOUTH_ASIA"], simulationDepth: "CONTEXT_ONLY" });
      initializeYouthSystemForSave({ db, worldDate: "2026-08-01", seed: "youth-partnership" });
      const proposed = createClubPartnership(db, { fromClubId: home.id, toClubId: partner, partnershipType: "YOUTH_DEVELOPMENT", relationshipStrength: 0, startDate: "2026-08-01" });
      runAnnualYouthAndRetirementCycle({ db, worldDate: "2026-08-01", seed: "youth-partnership", seasonLabel: "2026" });
      expect(planYouthDevelopmentPartnerships(db, { clubId: home.id, worldDate: "2026-08-01" })).toEqual([]);
      activateClubPartnership(db, proposed.id, { date: "2026-08-01", eligibility: { eligible: true, score: 60 } });
      const planned = planYouthDevelopmentPartnerships(db, { clubId: home.id, worldDate: "2026-08-01" });
      expect(planned.length).toBeGreaterThan(0);
      expect(planned.length).toBeLessThanOrEqual(2);
      expect(planYouthDevelopmentPartnerships(db, { clubId: home.id, worldDate: "2026-08-01" })).toEqual([]);
      expect(new YouthRepository(db).activePartnershipDevelopmentForPlayer(planned[0]!.playerId)?.partnerClubId).toBe(partner);
      const status = new YouthRepository(db).youthStatuses().find((item) => item.playerId === planned[0]!.playerId)!;
      expect(status.clubId).toBe(home.id);
      expect(completeYouthDevelopmentPartnerships(db, "2026-09-30")).toHaveLength(planned.length);
      expect(completeYouthDevelopmentPartnerships(db, "2026-10-01")).toEqual([]);
      expect(new YouthRepository(db).partnershipDevelopmentProgrammesForClub(home.id)[0]!.developmentApplied).toBe(true);
      const academy = createClubPartnership(db, { fromClubId: home.id, toClubId: partner, partnershipType: "ACADEMY", relationshipStrength: 0, startDate: "2026-08-01" });
      expect(academyPartnershipDevelopmentContext(db, home.id, "2026-08-01").regionalReachBonus).toBe(0);
      activateClubPartnership(db, academy.id, { date: "2026-08-01", eligibility: { eligible: true, score: 60 } });
      expect(academyPartnershipDevelopmentContext(db, home.id, "2026-08-01").regionalReachBonus).toBe(0.6);
      expect(new ClubNetworkRepository(db).activeYouthDevelopmentPartnerships(home.id, "2026-07-01")).toEqual([]);
      db.close();
      const reloaded = openGameDatabase(path);
      expect(new YouthRepository(reloaded).partnershipDevelopmentProgrammesForClub(home.id)).toHaveLength(planned.length);
      reloaded.close();
    } finally {
      try { db.close(); } catch { /* closed for reload */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
