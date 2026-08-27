import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import { activateClubPartnership, boundedPartnershipBenefits, createClubPartnership, createNepalSave, createOwnershipEnquiry, evaluateForeignRecruitmentCorridor, evaluateInternationalPartnership, initializeForeignFootballWorldForSave, isContextOnlyClub, processForeignFootballWorldSeason, runChairmanDemo } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const save = (): { path: string; directory: string } => {
  const directory = mkdtempSync(join(tmpdir(), "global-context-"));
  const path = join(directory, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "Global context", gameVersion: "test", randomSeed: "global-context" });
  return { path, directory };
};

describe("global football context", () => {
  it("persists context-only federations, leagues, clubs, seasons, and scouting interest", () => {
    const created = save();
    const db = openGameDatabase(created.path);
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "global-context" });
    processForeignFootballWorldSeason({ db, seasonEndDate: "2027-07-31", seed: "global-context" });
    const context = new GlobalFootballContextRepository(db);
    expect(context.federations().length).toBeGreaterThanOrEqual(8);
    expect(context.leagues().every((league) => league.simulationDepth === "CONTEXT_ONLY")).toBe(true);
    expect(context.clubs().every((club) => club.simulationDepth === "CONTEXT_ONLY")).toBe(true);
    const seasonCount = context.seasons().length;
    expect(seasonCount).toBeGreaterThanOrEqual(8);
    expect(context.seasons().every((season) => season.status === "COMPLETED")).toBe(true);
    expect(context.interests().length).toBeGreaterThan(0);
    const clubId = context.clubs()[0]!.clubId;
    expect(isContextOnlyClub(db, clubId)).toBe(true);
    db.close();
    const reloaded = openGameDatabase(created.path);
    expect(new GlobalFootballContextRepository(reloaded).seasons().length).toBe(seasonCount);
    reloaded.close();
    rmSync(created.directory, { recursive: true, force: true });
  });

  it("rejects ownership and chairman management for external clubs", () => {
    const created = save();
    const db = openGameDatabase(created.path);
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "global-context" });
    const clubId = new GlobalFootballContextRepository(db).clubs()[0]!.clubId;
    expect(() => runChairmanDemo({ db, seed: "global-context", worldDate: "2026-08-01", clubId })).toThrow("Context-only external clubs");
    expect(() => createOwnershipEnquiry(db, { clubId, buyerPersonId: createStableEntityId("person", "global-context-buyer"), percentage: 100, date: "2026-08-01" })).toThrow("Context-only external clubs");
    db.close();
    rmSync(created.directory, { recursive: true, force: true });
  });

  it("forms a bounded persisted partnership without making the external club playable", () => {
    const created = save();
    const db = openGameDatabase(created.path);
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "global-context" });
    const external = new GlobalFootballContextRepository(db).clubs()[0]!;
    const nepalClub = db.prepare("SELECT id FROM clubs WHERE canonical_external_id NOT LIKE 'SIM-FOREIGN-%' ORDER BY id LIMIT 1").get() as { id: string };
    const proposal = createClubPartnership(db, { fromClubId: nepalClub.id as EntityId, toClubId: external.clubId, partnershipType: "SCOUTING", relationshipStrength: 0, startDate: "2026-08-01" });
    const evaluation = evaluateInternationalPartnership({ nepalClubReputation: 70, academyQuality: 65, continentalExposure: 60, commercialReach: 55, foreignClubReputation: external.reputation, relationshipHistory: 60 });
    const active = activateClubPartnership(db, proposal.id, { date: "2026-08-01", eligibility: evaluation });
    expect(active.status).toBe("ACTIVE");
    expect(boundedPartnershipBenefits(active).scouting).toBeGreaterThan(0);
    expect(new GlobalFootballContextRepository(db).clubs().find((club) => club.clubId === external.clubId)?.simulationDepth).toBe("CONTEXT_ONLY");
    db.close();
    rmSync(created.directory, { recursive: true, force: true });
  });

  it("keeps recruitment corridors regional and bounded", () => {
    const africanPath = evaluateForeignRecruitmentCorridor({ sourceRegion: "AFRICA", destinationRegion: "NEPAL", playerReputation: 55, clubReputation: 45, scoutingReach: 60 });
    const elitePath = evaluateForeignRecruitmentCorridor({ sourceRegion: "EUROPE", destinationRegion: "NEPAL", playerReputation: 95, clubReputation: 95, scoutingReach: 95 });
    expect(africanPath.corridor).toBe("AFRICA_TO_NEPAL");
    expect(africanPath.score).toBeLessThanOrEqual(100);
    expect(elitePath.score).toBeLessThanOrEqual(100);
  });
});
