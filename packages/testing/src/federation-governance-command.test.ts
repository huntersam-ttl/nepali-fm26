import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernancePhaseBRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createFederationGovernanceProposal,
  createFederationElectionCycle,
  decideFederationGovernanceProposal,
  generateFederationCandidates,
  initializeFederationGovernanceForSave,
  reviewFederationGovernanceProposal,
  runFederationElection,
  DesktopApplicationService,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("federation governance production command", () => {
  it("implements an approved proposal only for the active president and persists the effect", () => {
    const dir = mkdtempSync(join(tmpdir(), "federation-command-production-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
    const created = service.createCareer({
      saveName: "President command",
      character: {
        fullName: "Maya Adhikari",
        preferredDisplayName: "Maya",
        dateOfBirth: "1993-05-12",
        startingAge: 33,
        languages: ["ne", "en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const path = created.data.catalogEntry.filePath;
    service.closeCareer();
    const db = openGameDatabase(path);
    const save = db.prepare("SELECT id, player_character_id, world_date FROM saves LIMIT 1").get() as { id: EntityId; player_character_id: EntityId; world_date: string };
    const personId = (db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId }).person_id;
    const federationId = (db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }).id;
    initializeFederationGovernanceForSave({ db, worldDate: save.world_date, seed: "president-command" });
    db.prepare("INSERT INTO federation_leadership_tenures (id,person_id,federation_id,role,term_start,term_end,status,provenance_status) VALUES (?,?,?,?,?,?,?,?)").run("production-president", personId, federationId, "FEDERATION_PRESIDENT", save.world_date, "2030-01-01", "ACTIVE", "SIMULATION_ONLY");
    const proposal = createFederationGovernanceProposal(db, { federationId, proposedByPersonId: personId, title: "President command project", policyArea: "DEVELOPMENT", payload: { projectType: "REGIONAL_CENTRE" }, proposedAt: save.world_date });
    reviewFederationGovernanceProposal(db, proposal.id, save.world_date);
    expect(decideFederationGovernanceProposal(db, proposal.id, { date: save.world_date, seed: "president-command", approve: true }).status).toBe("APPROVED");
    db.close();

    expect(service.loadCareerByPath(path).ok).toBe(true);
    expect(service.getCareerRoles()).toMatchObject({ ok: true, data: { activeRole: "MANAGER", heldRoles: ["MANAGER", "FEDERATION_PRESIDENT"] } });
    expect(service.implementFederationGovernanceProposal(proposal.id)).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true, data: { activeRole: "FEDERATION_PRESIDENT" } });
    expect(service.implementFederationGovernanceProposal("missing-proposal" as EntityId)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.implementFederationGovernanceProposal(proposal.id)).toMatchObject({ ok: true, data: { status: "IMPLEMENTED" } });
    expect(service.implementFederationGovernanceProposal(proposal.id)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.saveCareer().ok).toBe(true);
    service.closeCareer();

    const reloaded = openGameDatabase(path);
    expect(new FederationGovernancePhaseBRepository(reloaded).proposals().find((item) => item.id === proposal.id)?.status).toBe("IMPLEMENTED");
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM federation_projects WHERE name=?").get("President command project") as { count: number }).count).toBe(1);
    expect(new FederationGovernancePhaseBRepository(reloaded).events(federationId).filter((event) => event.subjectId === proposal.id).length).toBeGreaterThanOrEqual(2);
    reloaded.close();
  }, 300_000);
});
