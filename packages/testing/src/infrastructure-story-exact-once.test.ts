import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClubEconomyRepository,
  EventRepository,
  GovernmentRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  advanceGovernmentApplications,
  advanceInfrastructureProjects,
  createInfrastructureProject,
  createNepalSave,
  initializeClubEconomyForSave,
  requestClubInfrastructureGovernmentSupport,
  resolveGovernmentInstitutionForClub,
  reviewGovernmentFunding,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (seed: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "infra-story-once-"));
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

/**
 * Infrastructure advancement and government-application review both run on
 * every simulated day, and the desktop layer can legitimately re-request the
 * same day (autosave replay, a UI retry). Every story emitted along the way
 * must therefore be exact-once — proven here by driving the exact same
 * transition through repeated/overlapping calls and asserting the
 * historical_events table only ever holds one row per (project, milestone).
 */
describe("infrastructure and government story exact-once guarantees", () => {
  it("never duplicates the project-start story across repeated same-day and later-day advancement", () => {
    const db = openGameDatabase(makeSave("story-start"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-start" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "story-start",
    });
    // First tick 30+ days out flips PLANNING -> CONSTRUCTION and should
    // record the story exactly once...
    advanceInfrastructureProjects(db, { date: "2026-09-05", seed: "story-start" });
    advanceInfrastructureProjects(db, { date: "2026-09-05", seed: "story-start" });
    // ...and later ticks (still under construction) must not re-fire it.
    advanceInfrastructureProjects(db, { date: "2026-09-20", seed: "story-start" });
    const started = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "INFRASTRUCTURE_PROJECT_STARTED" && event.data?.projectId === project.id);
    expect(started).toHaveLength(1);
    db.close();
  });

  it("never duplicates the mid-construction milestone story once crossed", () => {
    const db = openGameDatabase(makeSave("story-milestone"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-milestone" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "story-milestone",
    });
    advanceInfrastructureProjects(db, { date: "2026-09-05", seed: "story-milestone" });
    const economy = new ClubEconomyRepository(db);
    const inConstruction = economy.infrastructureProjects(club.id).find((item) => item.id === project.id)!;
    expect(inConstruction.status).toBe("CONSTRUCTION");
    const start = new Date(`${inConstruction.constructionStart}T00:00:00Z`).getTime();
    const end = new Date(`${inConstruction.expectedCompletion}T00:00:00Z`).getTime() + (inConstruction.delayDays ?? 0) * 86_400_000;
    const midpoint = new Date(start + (end - start) * 0.6).toISOString().slice(0, 10);
    // Cross the midpoint, then re-process the same day and a later day still
    // short of completion — the milestone must not re-fire either time.
    advanceInfrastructureProjects(db, { date: midpoint, seed: "story-milestone" });
    advanceInfrastructureProjects(db, { date: midpoint, seed: "story-milestone" });
    const oneWeekLater = new Date(new Date(`${midpoint}T00:00:00Z`).getTime() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    advanceInfrastructureProjects(db, { date: oneWeekLater, seed: "story-milestone" });
    const milestones = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "INFRASTRUCTURE_MILESTONE_REACHED" && event.data?.projectId === project.id);
    expect(milestones).toHaveLength(1);
    db.close();
  });

  it("never duplicates the completion story across repeated processing of the same or later days", () => {
    const db = openGameDatabase(makeSave("story-complete"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-complete" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "MEDICAL_ROOM",
      date: "2026-08-01",
      seed: "story-complete",
    });
    advanceInfrastructureProjects(db, { date: "2027-12-01", seed: "story-complete" });
    advanceInfrastructureProjects(db, { date: "2027-12-01", seed: "story-complete" });
    advanceInfrastructureProjects(db, { date: "2027-12-15", seed: "story-complete" });
    const completed = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "FACILITY_PROJECT_COMPLETED" && event.data?.projectId === project.id);
    expect(completed).toHaveLength(1);
    db.close();
  });

  it("never duplicates the request-opened story when the same application is proposed again", () => {
    const db = openGameDatabase(makeSave("story-requested"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-requested" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    seedInstitution(db);
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "story-requested",
    });
    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });
    // Re-proposing the identical request (same club/institution/type/date)
    // resolves to the same stable application id — the story must not double.
    requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });
    const requested = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "GOVERNMENT_SUPPORT_REQUESTED");
    expect(requested).toHaveLength(1);
    db.close();
  });

  it("never duplicates the approval story across a re-run review or a replayed tick review", () => {
    const db = openGameDatabase(makeSave("story-approval"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-approval" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    seedInstitution(db);
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "story-approval",
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
    const evidence = { federationCredibility: 90, projectQuality: 85, footballPerformance: 70, existingCommitments: 10 };
    const reviewed = reviewGovernmentFunding(db, { applicationId: application.id, reviewedOn: "2026-08-05", evidence });
    expect(["APPROVED", "CONDITIONAL"]).toContain(reviewed.status);
    // reviewGovernmentFunding itself no-ops once terminal, but the tick that
    // drives it (advanceGovernmentApplications) can still be re-run for the
    // same day — prove that doesn't duplicate the story either.
    reviewGovernmentFunding(db, { applicationId: application.id, reviewedOn: "2026-08-05", evidence });
    advanceGovernmentApplications(db, { date: "2026-08-20" });
    const approved = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "GOVERNMENT_SUPPORT_APPROVED");
    expect(approved).toHaveLength(1);
    db.close();
  });

  it("advances a stale PROPOSED club application to a real decision on its own, and never duplicates the decision story", () => {
    const db = openGameDatabase(makeSave("story-auto-review"));
    initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "story-auto-review" });
    const club = db.prepare("SELECT id FROM clubs WHERE name = ?").get("Machhindra FC") as { id: EntityId };
    seedInstitution(db);
    db.prepare(
      "UPDATE clubs SET location_id = (SELECT location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1) WHERE id = ?",
    ).run(club.id);
    const project = createInfrastructureProject(db, {
      clubId: club.id,
      projectType: "TRAINING_GROUND",
      date: "2026-08-01",
      seed: "story-auto-review",
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
    expect(application.status).toBe("PROPOSED");
    // Nothing reviews it before the real-time review lag has passed.
    advanceGovernmentApplications(db, { date: "2026-08-05" });
    expect(new GovernmentRepository(db).applications().find((item) => item.id === application.id)?.status).toBe("PROPOSED");
    advanceGovernmentApplications(db, { date: "2026-08-20" });
    advanceGovernmentApplications(db, { date: "2026-08-20" });
    advanceGovernmentApplications(db, { date: "2026-08-25" });
    const decided = new GovernmentRepository(db).applications().find((item) => item.id === application.id)!;
    expect(["APPROVED", "CONDITIONAL", "REJECTED"]).toContain(decided.status);
    const decisionEvents = new EventRepository(db)
      .historicalEvents()
      .filter((event) => event.eventType === "GOVERNMENT_SUPPORT_APPROVED" || event.eventType === "GOVERNMENT_SUPPORT_REJECTED");
    expect(decisionEvents).toHaveLength(1);
    db.close();
  });
});

function seedInstitution(db: ReturnType<typeof openGameDatabase>): void {
  new GovernmentRepository(db).upsertInstitution({
    id: "nsc-story" as EntityId,
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
}
