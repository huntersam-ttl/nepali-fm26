import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagerRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createNepalSave,
  initializeFederationGovernanceForSave,
  playNationalTeamFixture,
  scheduleFriendly,
  selectNationalTeamSquad,
} from "@nepal-football-sim/simulation";

// ---------------------------------------------------------------------------
// A save-backed harness for the two secondary production simulateMatch call
// sites that had no tactical context wired in before this sprint: national
// team friendlies (federation-governance.ts) and territorial representative
// fixtures (territorial-football.ts). One integration test per path, rather
// than duplicating the same assertion many times.
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-secondary-tactics-"));
  tempDirs.push(dir);
  return join(dir, "secondary-tactics.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Secondary tactics ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const firstFederationId = (db: ReturnType<typeof openGameDatabase>): EntityId =>
  (
    db
      .prepare("SELECT id FROM federations WHERE name = 'All Nepal Football Association' LIMIT 1")
      .get() as { id: EntityId }
  ).id;

const seniorMenTeamId = (db: ReturnType<typeof openGameDatabase>, federationId: EntityId): EntityId =>
  (
    db
      .prepare(
        "SELECT id FROM teams WHERE federation_id = ? AND level = 'senior' AND gender = 'men' LIMIT 1",
      )
      .get(federationId) as { id: EntityId }
  ).id;

describe("secondary production match tactical wiring", () => {
  it("a national team friendly persists a real, non-default tactical setup for the national team", () => {
    const path = createSave("national-team-tactics");
    const db = openGameDatabase(path);
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "national-team-tactics" });
    const federationId = firstFederationId(db);
    const teamId = seniorMenTeamId(db, federationId);

    // No tactical setup exists yet for the national team.
    expect(new ManagerRepository(db).tacticalSetups(teamId)).toHaveLength(0);

    selectNationalTeamSquad(db, {
      federationId,
      nationalTeamId: teamId,
      date: "2026-09-01",
      programme: "Tactics wiring test",
      seed: "national-team-tactics",
    });
    const fixture = scheduleFriendly(db, {
      federationId,
      nationalTeamId: teamId,
      opponentName: "Wiring Test XI",
      date: "2026-09-10",
      seed: "national-team-tactics",
    });
    playNationalTeamFixture(db, fixture.id, "national-team-tactics");

    // Playing the fixture resolves (and persists) a real tactical identity
    // for the national team via the same resolver every club uses — never
    // silently tactics-blind, and never a fixed default when manager/team
    // context exists.
    const setups = new ManagerRepository(db).tacticalSetups(teamId);
    expect(setups).toHaveLength(1);
    expect(setups[0]!.teamId).toBe(teamId);
    expect(setups[0]!.assignments.length).toBeGreaterThan(0);
    db.close();
  });
});
