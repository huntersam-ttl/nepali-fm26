import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GovernmentRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  buildGovernmentSupportMeeting,
  createInfrastructureProject,
  createNepalSave,
  initializeClubEconomyForSave,
  requestClubInfrastructureGovernmentSupport,
  resolveGovernmentInstitutionForClub,
  reviewGovernmentFunding,
  submitGovernmentFunding,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "gov-support-meeting-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
  });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const seedInstitution = (db: ReturnType<typeof openGameDatabase>): void => {
  new GovernmentRepository(db).upsertInstitution({
    id: "nsc-meeting" as EntityId,
    name: "National Sports Council",
    institutionType: "NATIONAL_SPORTS_COUNCIL",
    profile: {
      budgetCapacity: 40_000_000,
      committedBudget: 0,
      footballPriority: 90,
      credibilityTowardFederation: 85,
      infrastructurePriority: 90,
      youthWomenPriority: 90,
    },
    provenanceStatus: "SIMULATION_ONLY",
  });
};

describe("government support meeting read model", () => {
  it("shows an honest blocked state when the club's location cannot resolve any institution", () => {
    const db = openGameDatabase(makeSave("meeting-blocked"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "meeting-blocked" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    db.prepare("UPDATE clubs SET location_id = NULL WHERE id = ?").run(club.id);
    const meeting = buildGovernmentSupportMeeting(db, { clubId: club.id }, "CHAIRMAN_OWNER");
    expect(meeting.institution).toBeUndefined();
    expect(meeting.nextAction).toBe("NONE");
    expect(meeting.blockedReason).toMatch(/lacks enough canonical location/i);
    expect(meeting.blockedReason).not.toMatch(/UNKNOWN/);
    db.close();
  });

  it("walks OPEN_REQUEST -> SUBMIT_CASE -> WAIT_FOR_REVIEW -> START_PROJECT across the real application lifecycle", () => {
    const db = openGameDatabase(makeSave("meeting-lifecycle"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "meeting-lifecycle" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    seedInstitution(db);
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);

    const before = buildGovernmentSupportMeeting(db, { clubId: club.id }, "CHAIRMAN_OWNER");
    expect(before.institution).toBeDefined();
    expect(before.nextAction).toBe("OPEN_REQUEST");
    expect(before.current).toBeUndefined();
    expect(before.locationLabel).toBeDefined();
    expect(before.locationLabel).not.toMatch(/unknown/i);

    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "meeting-lifecycle",
    });
    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    const application = requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });

    const afterOpen = buildGovernmentSupportMeeting(db, { clubId: club.id, projectId: project.id }, "CHAIRMAN_OWNER");
    expect(afterOpen.current?.status).toBe("PROPOSED");
    expect(afterOpen.nextAction).toBe("SUBMIT_CASE");
    expect(afterOpen.reasonNeeded).toMatch(/training ground/i);
    expect(afterOpen.project?.entityType).toBe("INFRASTRUCTURE_PROJECT");

    submitGovernmentFunding(db, application.id);
    const afterSubmit = buildGovernmentSupportMeeting(db, { clubId: club.id, projectId: project.id }, "CHAIRMAN_OWNER");
    expect(afterSubmit.current?.status).toBe("SUBMITTED");
    expect(afterSubmit.nextAction).toBe("WAIT_FOR_REVIEW");

    const reviewed = reviewGovernmentFunding(db, {
      applicationId: application.id,
      reviewedOn: "2026-08-05",
      evidence: { federationCredibility: 90, projectQuality: 85, footballPerformance: 70, existingCommitments: 10 },
    });
    expect(["APPROVED", "CONDITIONAL"]).toContain(reviewed.status);
    const afterApproval = buildGovernmentSupportMeeting(db, { clubId: club.id, projectId: project.id }, "CHAIRMAN_OWNER");
    expect(afterApproval.current?.status).toBe(reviewed.status);
    expect(afterApproval.fundingSettled).toBe(true);
    expect(afterApproval.nextAction).toBe("START_PROJECT");
    db.close();
  });

  /**
   * An UPGRADE_EXISTING facility plan (no siteOptionId) records its funding
   * as a camelCase `financing` key (e.g. "governmentGrant"). The meeting read
   * model must present that through the same humanized-token path every other
   * status/category renders through — never as the raw object key, which
   * would otherwise lowercase to a single run-together word like
   * "governmentgrant" once the UI's generic band() formatter reached it.
   */
  it("never leaks a raw camelCase financing key as the financing source", () => {
    const db = openGameDatabase(makeSave("meeting-financing-source"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "meeting-financing-source" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
      id: EntityId;
    };
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "meeting-financing-source",
    });
    db.prepare("UPDATE infrastructure_projects SET financing_json = ? WHERE id = ?").run(
      JSON.stringify({ governmentGrant: 1_000_000 }),
      project.id,
    );
    const meeting = buildGovernmentSupportMeeting(
      db,
      { clubId: club.id, projectId: project.id },
      "CHAIRMAN_OWNER",
    );
    expect(meeting.financingSource).toBeDefined();
    expect(meeting.financingSource).not.toBe("governmentgrant");
    expect(meeting.financingSource).not.toMatch(/[a-z][A-Z]/);
    expect(meeting.financingSource).toBe("GOVERNMENT_GRANT");
    db.close();
  });

  /**
   * `openClubInfrastructureGovernmentRequest` anchors a government support
   * request on an existing InfrastructureProject (the UPGRADE_EXISTING path)
   * rather than a site option. This was fully implemented on the backend but
   * had no UI call site at all — an owner planning an upgrade-existing
   * project with government co-funding had no way to ever open the real
   * application. The read model must resolve identically whether reached via
   * projectId or (as the NEW_SITE path already covered above) via the
   * request that created the application.
   */
  it("resolves a project-anchored request the same way an owner's UI action would open it", () => {
    const db = openGameDatabase(makeSave("meeting-project-anchor"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "meeting-project-anchor" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as {
      id: EntityId;
    };
    seedInstitution(db);
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "meeting-project-anchor",
    });
    const before = buildGovernmentSupportMeeting(
      db,
      { clubId: club.id, projectId: project.id },
      "CHAIRMAN_OWNER",
    );
    expect(before.institution).toBeDefined();
    expect(before.nextAction).toBe("OPEN_REQUEST");
    expect(before.project?.entityType).toBe("INFRASTRUCTURE_PROJECT");

    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_500_000,
      date: "2026-08-02",
    });
    const after = buildGovernmentSupportMeeting(
      db,
      { clubId: club.id, projectId: project.id },
      "CHAIRMAN_OWNER",
    );
    expect(after.current?.status).toBe("PROPOSED");
    expect(after.nextAction).toBe("SUBMIT_CASE");
    db.close();
  });
});
