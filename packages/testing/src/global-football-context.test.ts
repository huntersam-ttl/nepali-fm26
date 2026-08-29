import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubNetworkRepository, GlobalFootballContextRepository, openGameDatabase } from "@nepal-football-sim/database";
import { accessibleRecruitmentRegions, activateClubPartnership, boundedPartnershipBenefits, createClubPartnership, createNepalSave, createOwnershipEnquiry, evaluateForeignRecruitmentCorridor, evaluateInternationalPartnership, initializeForeignFootballWorldForSave, initializeRecruitmentForSave, isContextOnlyClub, processForeignFootballWorldSeason, runChairmanDemo, searchRegionalCandidatesForClub } from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const save = (): { path: string; directory: string } => {
  const directory = mkdtempSync(join(tmpdir(), "global-context-"));
  const path = join(directory, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "Global context", gameVersion: "test", randomSeed: "global-context", globalSeedPath: null });
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

  it("wires active scouting partnerships into bounded regional discovery", () => {
    const created = save();
    const db = openGameDatabase(created.path);
    initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed: "global-context" });
    initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed: "scouting-partnership" });
    const nepaliClub = db.prepare("SELECT id FROM clubs WHERE canonical_external_id NOT LIKE 'SIM-FOREIGN-%' AND canonical_external_id NOT LIKE 'NEP-NSL-%' ORDER BY id LIMIT 1").get() as { id: EntityId };
    db.prepare("UPDATE club_recruitment_profiles SET network_reach='REGIONAL', international_knowledge=0 WHERE club_id=?").run(nepaliClub.id);
    const external = db.prepare("SELECT c.id, c.canonical_external_id FROM clubs c JOIN countries co ON co.id=c.country_id WHERE co.iso_code='GH' ORDER BY c.canonical_external_id LIMIT 1").get() as { id: EntityId; canonical_external_id: string };
    const player = db.prepare("SELECT p.id FROM persons p LEFT JOIN player_factual_profiles pfp ON pfp.player_id=p.id LEFT JOIN player_contracts pc ON pc.player_id=p.id AND pc.status='ACTIVE' WHERE COALESCE(pfp.current_club_id, pc.club_id)=? ORDER BY p.id LIMIT 1").get(external.id) as { id: EntityId };
    expect(player).toBeTruthy();
    expect(searchRegionalCandidatesForClub(db, nepaliClub.id, { clubId: external.id }, "2026-08-01", 12).some((item) => item.playerId === player.id)).toBe(false);

    const proposal = createClubPartnership(db, { fromClubId: nepaliClub.id, toClubId: external.id, partnershipType: "SCOUTING", relationshipStrength: 0, startDate: "2026-08-01" });
    activateClubPartnership(db, proposal.id, { date: "2026-08-01", eligibility: { eligible: true, score: 60 } });
    const repo = new ClubNetworkRepository(db);
    expect(repo.activeScoutingPartnerships(nepaliClub.id, "2026-08-01")).toHaveLength(1);
    expect(accessibleRecruitmentRegions(db, nepaliClub.id, "2026-08-01")).toContain("AFRICA");
    const found = searchRegionalCandidatesForClub(db, nepaliClub.id, { clubId: external.id }, "2026-08-01", 12).find((item) => item.playerId === player.id)!;
    expect(found).toBeTruthy();
    expect(found.knowledgeLevel).toBe("MINIMAL");
    expect(found.discoveryStatus).toBe("DISCOVERED");
    expect(found.estimatedAbility?.max).toBeLessThanOrEqual(20);
    const wrongGroup = found.publicPositionGroup === "GOALKEEPER" ? "DEFENDER" : "GOALKEEPER";
    expect(searchRegionalCandidatesForClub(db, nepaliClub.id, { clubId: external.id, positionGroup: wrongGroup }, "2026-08-01", 12).some((item) => item.playerId === player.id)).toBe(false);
    expect(searchRegionalCandidatesForClub(db, nepaliClub.id, { clubId: external.id }, "2026-08-01", 12).length).toBeLessThanOrEqual(12);

    db.prepare("UPDATE international_club_partnerships SET status='SUSPENDED' WHERE id=?").run(proposal.id);
    expect(repo.activeScoutingPartnerships(nepaliClub.id, "2026-08-01")).toEqual([]);
    expect(accessibleRecruitmentRegions(db, nepaliClub.id, "2026-08-01")).not.toContain("AFRICA");
    db.close();
    const reloaded = openGameDatabase(created.path);
    expect(accessibleRecruitmentRegions(reloaded, nepaliClub.id, "2026-08-01")).not.toContain("AFRICA");
    reloaded.close();
    rmSync(created.directory, { recursive: true, force: true });
  });
});
