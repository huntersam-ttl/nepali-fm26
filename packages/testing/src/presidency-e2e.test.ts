import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CareerIdentityRepository, FederationGovernanceRepository, FederationPoliticsRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { CareerIdentity, EntityId } from "@nepal-football-sim/shared-types";
import { createFederationElectionCycle, DesktopApplicationService, generateFederationCandidates, initializeFederationGovernanceForSave, runFederationElection } from "@nepal-football-sim/simulation";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const character = { fullName: "Election Test", dateOfBirth: "1985-01-01", startingAge: 41, languages: ["en"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE", playingExperience: "AMATEUR_PLAYER", coachingExperience: "SENIOR_COACH", businessBackground: "ENTREPRENEURSHIP", startingReputationProfile: "LOCAL_RESPECTED" };

const prepare = (mode: "MANAGER" | "OWNER", reputation: number): { service: DesktopApplicationService; saveId: EntityId; personId: EntityId; path: string; federationId: EntityId; cycleId: EntityId } => {
  const dir = mkdtempSync(join(tmpdir(), `nepal-presidency-${mode.toLowerCase()}-`)); dirs.push(dir);
  const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
  const listed = service.listStartingClubs(); if (!listed.ok) throw new Error(listed.error.message);
  const club = listed.data.find((item) => item.division === "B"); if (!club) throw new Error("No B Division club");
  const created = service.createCareer({ careerMode: mode, saveName: `Election ${mode}`, joinTeamId: club.teamId, character }); if (!created.ok) throw new Error(created.error.message);
  const path = created.data.catalogEntry.filePath; const saveId = created.data.save.id;
  service.closeCareer();
  const db = openGameDatabase(path);
  const characterId = created.data.save.playerCharacterId; if (!characterId) throw new Error("Career character was not persisted");
  const personId = (db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(characterId) as { person_id: EntityId }).person_id;
  const identity: CareerIdentity = { personId, reputation: { sporting: reputation, businessOwnership: 0, governance: 0, nationalInternational: 0 }, milestones: [], activeRoles: [], retired: false, legacy: { clubsServed: 1, trophies: 0, ownershipEvents: mode === "OWNER" ? 1 : 0, federationTerms: 0, majorRecords: [], careerWealth: 0 }, lastUpdatedAt: "2029-08-01", provenanceStatus: "SIMULATION_ONLY" };
  new CareerIdentityRepository(db).upsert(identity);
  db.prepare("UPDATE saves SET world_date=? WHERE id=?").run("2029-08-01", saveId);
  initializeFederationGovernanceForSave({ db, worldDate: "2029-08-01", seed: "presidency-fixture" });
  // Nepal's own federation — the global dataset seed also inserts real
  // foreign federations into this same table (external_federation_context),
  // so an unscoped "first federation by id" could pick one of those instead.
  const federationId = (
    db
      .prepare("SELECT id FROM federations WHERE NOT EXISTS (SELECT 1 FROM external_federation_context efc WHERE efc.federation_id = federations.id) ORDER BY id LIMIT 1")
      .get() as { id: EntityId }
  ).id;
  const cycle = createFederationElectionCycle(db, { federationId, electionDate: "2029-09-01" });
  db.close();
  const loaded = service.loadCareer(saveId); if (!loaded.ok) throw new Error(loaded.error.message);
  return { service, saveId, personId, path, federationId, cycleId: cycle.id };
};

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("deterministic presidency progression", () => {
  it("takes a qualified manager through candidacy, canonical victory, role switch, and reload", () => {
    const fixture = prepare("MANAGER", 100);
    const declared = fixture.service.declareFederationElectionCandidacy(); expect(declared.ok).toBe(true);
    fixture.service.closeCareer(); const db = openGameDatabase(fixture.path); db.prepare("UPDATE federation_election_candidates SET reputation=9,support_base=9,committee_influence=1,voting_blocs_json=? WHERE cycle_id=? AND person_id=?").run(JSON.stringify({ clubs: 1, districts: 1, regions: 1 }), fixture.cycleId, fixture.personId);
    const result = runFederationElection(db, { cycleId: fixture.cycleId, date: "2029-09-01", seed: "manager-win" });
    expect(result.electedPersonId).toBe(fixture.personId);
    const tenure = db.prepare("SELECT person_id,federation_id,term_start,term_end FROM federation_leadership_tenures WHERE person_id=? AND role='FEDERATION_PRESIDENT' AND status='ACTIVE'").get(fixture.personId) as { person_id: EntityId; federation_id: EntityId; term_start: string; term_end: string };
    expect(tenure).toMatchObject({ person_id: fixture.personId, federation_id: fixture.federationId, term_start: "2029-09-01", term_end: "2033-09-01" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM federation_leadership_tenures WHERE person_id=? AND federation_id=? AND role='FEDERATION_PRESIDENT'").get(fixture.personId, fixture.federationId) as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM federation_election_results WHERE cycle_id=?").get(fixture.cycleId) as { n: number }).n).toBe(1);
    db.close();
    const loaded = fixture.service.loadCareer(fixture.saveId); expect(loaded.ok).toBe(true);
    const roles = fixture.service.getCareerRoles(); expect(roles.ok && roles.data.heldRoles).toEqual(expect.arrayContaining(["MANAGER", "FEDERATION_PRESIDENT"]));
    const switched = fixture.service.switchActiveCareerRole("FEDERATION_PRESIDENT"); expect(switched.ok).toBe(true);
    expect(fixture.service.getFederationPresidentDashboard().ok).toBe(true);
    fixture.service.closeCareer(); const reloaded = fixture.service.loadCareer(fixture.saveId); expect(reloaded.ok).toBe(true); expect(fixture.service.getCareerRoles().ok).toBe(true); fixture.service.closeCareer();
  }, 120_000);

  it("takes an owner through candidacy while preserving ownership and Chairman role", () => {
    const fixture = prepare("OWNER", 100);
    expect(fixture.service.declareFederationElectionCandidacy().ok).toBe(true);
    fixture.service.closeCareer(); const db = openGameDatabase(fixture.path); db.prepare("UPDATE federation_election_candidates SET reputation=9,support_base=9,committee_influence=1,voting_blocs_json=? WHERE cycle_id=? AND person_id=?").run(JSON.stringify({ clubs: 1, districts: 1, regions: 1 }), fixture.cycleId, fixture.personId);
    const result = runFederationElection(db, { cycleId: fixture.cycleId, date: "2029-09-01", seed: "owner-win" }); expect(result.electedPersonId).toBe(fixture.personId); db.close();
    expect(fixture.service.loadCareer(fixture.saveId).ok).toBe(true);
    const roles = fixture.service.getCareerRoles(); expect(roles.ok && roles.data.heldRoles).toEqual(expect.arrayContaining(["CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"]));
    expect(fixture.service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true); expect(fixture.service.getFederationPresidentDashboard().ok).toBe(true);
    expect(fixture.service.switchActiveCareerRole("CHAIRMAN_OWNER").ok).toBe(true); const chairman = fixture.service.getChairmanDashboard(); expect(chairman.ok).toBe(true); if (chairman.ok) expect(chairman.data.club.ownershipPercentage).toBe(75); fixture.service.closeCareer();
  }, 120_000);

  it("records a normal human loss without removing the Manager career", () => {
    const fixture = prepare("MANAGER", 45);
    expect(fixture.service.declareFederationElectionCandidacy().ok).toBe(true);
    fixture.service.closeCareer(); const db = openGameDatabase(fixture.path); const candidates = generateFederationCandidates(db, { cycleId: fixture.cycleId, federationId: fixture.federationId, date: "2029-08-01", seed: "loss" }); const ai = candidates[0]!;
    db.prepare("UPDATE federation_election_candidates SET reputation=9,support_base=9,committee_influence=1,voting_blocs_json=? WHERE id=?").run(JSON.stringify({ clubs: 1, districts: 1, regions: 1 }), ai.id);
    const result = runFederationElection(db, { cycleId: fixture.cycleId, date: "2029-09-01", seed: "loss" }); expect(result.electedPersonId).not.toBe(fixture.personId); expect(new FederationPoliticsRepository(db).candidates(fixture.cycleId).find((item) => item.personId === fixture.personId)?.status).toBe("DEFEATED"); db.close();
    expect(fixture.service.loadCareer(fixture.saveId).ok).toBe(true); const roles = fixture.service.getCareerRoles(); expect(roles.ok && roles.data.heldRoles).toEqual(["MANAGER"]); const lossDb = openGameDatabase(fixture.path); expect(new FederationGovernanceRepository(lossDb).leadershipTenures(fixture.federationId).some((item) => item.personId === fixture.personId && item.role === "FEDERATION_PRESIDENT")).toBe(false); lossDb.close(); fixture.service.closeCareer();
  }, 120_000);

  it("keeps day-one and closed-window candidacy blocked and duplicate declaration idempotent", () => {
    const dayOne = prepare("MANAGER", 0);
    const blocked = dayOne.service.getFederationCandidacy(); expect(blocked.ok && blocked.data.eligible).toBe(false);
    expect(blocked.ok && blocked.data.reasons.join(" ")).toContain("reputation"); expect(dayOne.service.declareFederationElectionCandidacy().ok).toBe(false); dayOne.service.closeCareer();
    const ownerDayOne = prepare("OWNER", 0); const ownerBlocked = ownerDayOne.service.getFederationCandidacy(); expect(ownerBlocked.ok && ownerBlocked.data.eligible).toBe(false); expect(ownerBlocked.ok && ownerBlocked.data.reasons.join(" ")).toContain("reputation"); ownerDayOne.service.closeCareer();
    const closed = prepare("MANAGER", 100); closed.service.closeCareer(); const closedDb = openGameDatabase(closed.path); closedDb.prepare("UPDATE saves SET world_date=? WHERE id=?").run("2029-10-01", closed.saveId); closedDb.close(); expect(closed.service.loadCareer(closed.saveId).ok).toBe(true); const closedAssessment = closed.service.getFederationCandidacy(); expect(closedAssessment.ok && closedAssessment.data.reasons.join(" ")).toContain("No election"); expect(closed.service.declareFederationElectionCandidacy().ok).toBe(false); closed.service.closeCareer();
    const eligible = prepare("MANAGER", 100);
    const contextDb = openGameDatabase(eligible.path); const foreignCountry = (contextDb.prepare("SELECT id FROM countries WHERE iso_code NOT IN ('NP','NPL') ORDER BY id LIMIT 1").get() as { id: EntityId }).id; const foreignFederationId = `foreign-federation-${eligible.saveId}` as EntityId; contextDb.prepare("INSERT INTO federations (id,country_id,name,founded_year) VALUES (?,?,?,?)").run(foreignFederationId, foreignCountry, "Context Federation", 1900); createFederationElectionCycle(contextDb, { federationId: foreignFederationId, electionDate: "2029-08-15" }); contextDb.close(); expect(eligible.service.loadCareer(eligible.saveId).ok).toBe(true);
    const first = eligible.service.declareFederationElectionCandidacy(); const second = eligible.service.declareFederationElectionCandidacy();
    expect(first.ok).toBe(true); expect(second.ok).toBe(true); eligible.service.closeCareer(); const db = openGameDatabase(eligible.path);
    expect((db.prepare("SELECT COUNT(*) AS n FROM federation_election_candidates WHERE cycle_id=? AND person_id=?").get(eligible.cycleId, eligible.personId) as { n: number }).n).toBe(1); db.close();
  }, 120_000);
});
