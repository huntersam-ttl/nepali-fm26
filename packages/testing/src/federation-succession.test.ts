import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FederationGovernanceRepository, FederationPoliticsRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave, ensureFederationLeadershipContinuity, initializeFederationGovernanceForSave } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("federation leadership continuity", () => {
  it("produces three recurring administrations with interim and persisted authority", () => {
    const dir = mkdtempSync(join(tmpdir(), "federation-succession-"));
    dirs.push(dir);
    const path = join(dir, "federation.sqlite");
    createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "federation succession", gameVersion: "test", randomSeed: "federation-succession" });
    const db = openGameDatabase(path);
    initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "federation-succession" });
    const federationId = (db.prepare("SELECT id FROM federations ORDER BY id LIMIT 1").get() as { id: EntityId }).id;
    // ensureFederationLeadershipContinuity processes every federation in the
    // canonical dataset (now many, not just Nepal's) in a single call, so its
    // return value covers all of them — this test only cares about the one
    // federation it's tracking.
    const forTarget = (results: readonly { federationId: EntityId }[]) =>
      results.filter((item) => item.federationId === federationId);

    const first = ensureFederationLeadershipContinuity(db, { date: "2026-08-28", seed: "federation-succession" });
    expect(forTarget(first)).toHaveLength(0);
    expect(new FederationGovernanceRepository(db).leadershipTenures(federationId).some((item) => item.status === "INTERIM")).toBe(true);
    const results = [
      ...forTarget(ensureFederationLeadershipContinuity(db, { date: "2026-10-28", seed: "federation-succession" })),
      ...forTarget(ensureFederationLeadershipContinuity(db, { date: "2031-01-28", seed: "federation-succession" })),
      ...forTarget(ensureFederationLeadershipContinuity(db, { date: "2035-08-28", seed: "federation-succession" })),
      ...forTarget(ensureFederationLeadershipContinuity(db, { date: "2035-11-28", seed: "federation-succession" })),
      ...forTarget(ensureFederationLeadershipContinuity(db, { date: "2036-02-28", seed: "federation-succession" })),
    ];
    expect(results).toHaveLength(3);
    expect(new FederationPoliticsRepository(db).results(federationId)).toHaveLength(3);
    expect(new FederationGovernanceRepository(db).leadershipTenures(federationId).filter((item) => item.status === "ACTIVE")).toHaveLength(1);
    expect(new FederationGovernanceRepository(db).leadershipTenures(federationId).filter((item) => item.status === "FORMER")).toHaveLength(5);
    expect(db.prepare("SELECT COUNT(*) AS n FROM staff_appointments WHERE federation_id=? AND role='FEDERATION_PRESIDENT' AND employment_status='ACTIVE'").get(federationId)).toEqual({ n: 1 });
    const before = new FederationPoliticsRepository(db).results(federationId).length;
    expect(forTarget(ensureFederationLeadershipContinuity(db, { date: "2036-02-28", seed: "federation-succession" }))).toHaveLength(0);
    expect(new FederationPoliticsRepository(db).results(federationId)).toHaveLength(before);
    db.close();
    const reloaded = openGameDatabase(path);
    expect(new FederationPoliticsRepository(reloaded).results(federationId)).toHaveLength(3);
    reloaded.close();
  });
});
