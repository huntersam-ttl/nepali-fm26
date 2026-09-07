import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventRepository, GovernmentRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  buildDistrictStoryline,
  createInfrastructureProject,
  createNepalSave,
  initializeClubEconomyForSave,
  initializeNepalTerritorialStructure,
  requestClubInfrastructureGovernmentSupport,
  resolveGovernmentInstitutionForClub,
  resolveStoryTerritory,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type EntityId, type HistoricalEvent } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "story-territory-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const setUp = (name: string) => {
  const db = openGameDatabase(makeSave(name));
  initializeNepalTerritorialStructure(db, "2026-08-01");
  initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: name });
  const club = db
    .prepare("SELECT id, location_id FROM clubs WHERE location_id IS NOT NULL LIMIT 1")
    .get() as { id: EntityId; location_id: EntityId };
  const districtId = (
    db
      .prepare(
        `WITH RECURSIVE up(id, parent_location_id) AS (
           SELECT id, parent_location_id FROM locations WHERE id = ?
           UNION ALL
           SELECT l.id, l.parent_location_id FROM locations l JOIN up ON l.id = up.parent_location_id
         )
         SELECT td.id FROM territorial_districts td JOIN up ON up.id = td.location_id LIMIT 1`,
      )
      .get(club.location_id) as { id: EntityId } | undefined
  )?.id;
  return { db, club, districtId };
};

const eventFor = (eventType: string, data: Record<string, unknown>): HistoricalEvent => ({
  id: createStableEntityId("history", `story-territory:${eventType}:${JSON.stringify(data)}`),
  occurredOn: "2026-08-02",
  eventType,
  involvedEntities: [],
  title: "A story",
  importance: "medium",
  scope: "club",
  data,
});

describe("resolveStoryTerritory", () => {
  it("resolves a club event to the club's own district via its registered location", () => {
    const { db, club, districtId } = setUp("territory-club");
    expect(districtId).toBeDefined();
    const territory = resolveStoryTerritory(db, eventFor("SPONSORSHIP_ACCEPTED", { clubId: club.id }));
    expect(territory?.districtId).toBe(districtId);
    db.close();
  });

  it("resolves an infrastructure-project event to the club's district via the project's clubId", () => {
    const { db, club, districtId } = setUp("territory-project");
    const project = createInfrastructureProject(db, { clubId: club.id, projectType: "TRAINING_GROUND", date: "2026-08-01", seed: "territory-project" });
    const territory = resolveStoryTerritory(db, eventFor("INFRASTRUCTURE_MILESTONE_REACHED", { projectId: project.id }));
    expect(territory?.districtId).toBe(districtId);
    db.close();
  });

  it("resolves a government-application event to the club's district via the application's clubId", () => {
    const { db, club, districtId } = setUp("territory-government");
    new GovernmentRepository(db).upsertInstitution({
      id: "nsc-territory" as EntityId,
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
    const project = createInfrastructureProject(db, { clubId: club.id, projectType: "TRAINING_GROUND", date: "2026-08-01", seed: "territory-government" });
    const institution = resolveGovernmentInstitutionForClub(db, club.id)!;
    const application = requestClubInfrastructureGovernmentSupport(db, {
      clubId: club.id,
      projectId: project.id,
      institutionId: institution.id,
      fundingType: "INFRASTRUCTURE",
      requestedAmount: 1_000_000,
      date: "2026-08-02",
    });
    const territory = resolveStoryTerritory(db, eventFor("GOVERNMENT_SUPPORT_REQUESTED", { applicationId: application.id }));
    expect(territory?.districtId).toBe(districtId);
    db.close();
  });

  it("never assigns a federation-wide event (no club/project/institution metadata) to any district", () => {
    const { db } = setUp("territory-federation-wide");
    const territory = resolveStoryTerritory(
      db,
      eventFor("NATIONAL_TEAM_CALLUP", { teamId: "nepal-senior-men", playerId: "some-player" }),
    );
    expect(territory).toBeUndefined();
    db.close();
  });

  it("never fabricates a district for an event whose clubId does not resolve to a real, located club", () => {
    const { db } = setUp("territory-missing-club");
    const territory = resolveStoryTerritory(db, eventFor("SPONSORSHIP_ACCEPTED", { clubId: "no-such-club" }));
    expect(territory).toBeUndefined();
    db.close();
  });
});

describe("buildDistrictStoryline", () => {
  it("includes an event that canonically resolves into this district and excludes an unrelated federation-wide event", () => {
    const { db, club, districtId } = setUp("territory-storyline");
    if (!districtId) throw new Error("expected a resolvable district for this test's seeded club");
    const events = new EventRepository(db);
    const inDistrictEventId = createStableEntityId("history", "territory-storyline:in-district");
    events.insertHistoricalEvent({
      id: inDistrictEventId,
      occurredOn: "2026-08-03",
      eventType: "SPONSORSHIP_ACCEPTED",
      involvedEntities: [{ id: club.id, type: "club" }],
      title: "This club's district-local sponsorship story",
      importance: "high",
      scope: "club",
      data: { clubId: club.id, sponsorshipId: "irrelevant-for-this-test" },
    });
    const federationWideEventId = createStableEntityId("history", "territory-storyline:federation-wide");
    events.insertHistoricalEvent({
      id: federationWideEventId,
      occurredOn: "2026-08-03",
      eventType: "NATIONAL_TEAM_CALLUP",
      involvedEntities: [{ id: "nepal-senior-men" as EntityId, type: "team" }],
      title: "Nepal call up a player for Senior Men",
      importance: "medium",
      scope: "federation",
      data: { teamId: "nepal-senior-men", playerId: "some-player" },
    });
    const storyline = buildDistrictStoryline(db, districtId, "FEDERATION_PRESIDENT");
    const eventIds = storyline.entries.map((entry) => entry.eventId);
    expect(eventIds).toContain(inDistrictEventId);
    expect(eventIds).not.toContain(federationWideEventId);
    db.close();
  });
});
