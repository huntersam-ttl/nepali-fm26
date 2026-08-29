import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CompetitionDistributionRepository, CompetitionRepository, FederationGovernanceRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { createDistributionPolicy, createNepalSave, initializeClubEconomyForSave, initializeFederationGovernanceForSave, settleApprovedCompetitionDistributions } from "@nepal-football-sim/simulation";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
const policyValues = { version: 1, poolAmount: 1000000, championPrize: .2, runnerUpPrize: .1, placementPrizes: .1, participationPayments: .3, equalSharePayments: .2, performanceSharePayments: 0, audienceShare: 0, youthDevelopmentIncentives: 0, womensFootballIncentives: 0, infrastructureGrants: 0 };

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("competition distribution production settlement", () => {
  it("settles an approved season policy once for domestic finishers and survives reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "competition-distribution-production-")); dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: "distribution", gameVersion: "test", randomSeed: "distribution" });
    let db = openGameDatabase(path); initializeClubEconomyForSave({ db, worldDate: "2026-08-01", seed: "distribution" }); initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "distribution" });
    const season = db.prepare("SELECT id FROM competition_seasons ORDER BY start_date, id LIMIT 1").get() as { id: EntityId };
    const federation = db.prepare("SELECT federation_id AS id FROM competitions WHERE id=(SELECT competition_id FROM competition_seasons WHERE id=?)").get(season.id) as { id: EntityId };
    const teams = db.prepare("SELECT team_id AS id FROM club_memberships WHERE competition_season_id=? AND status='ACTIVE' ORDER BY team_id LIMIT 3").all(season.id) as Array<{ id: EntityId }>;
    expect(teams).toHaveLength(3);
    const competition = new CompetitionRepository(db);
    for (const [index, team] of teams.entries()) competition.upsertStanding({ competitionSeasonId: season.id, teamId: team.id, played: 2, won: index === 0 ? 2 : 0, drawn: index === 1 ? 1 : 0, lost: index === 2 ? 2 : 0, goalsFor: 4 - index, goalsAgainst: index, goalDifference: 4 - index * 2, points: 6 - index * 2 });
    const proposed = createDistributionPolicy(db, { ...policyValues, federationId: federation.id, competitionSeasonId: season.id });
    const repository = new CompetitionDistributionRepository(db); repository.upsertPolicy({ ...proposed, status: "APPROVED" });
    const before = new FederationGovernanceRepository(db).financialAccount(federation.id)!.cashBalance;
    const first = settleApprovedCompetitionDistributions(db, { competitionSeasonId: season.id, date: "2027-07-31" });
    expect(first.length).toBeGreaterThan(0); expect(new FederationGovernanceRepository(db).financialAccount(federation.id)!.cashBalance).toBe(before - first.reduce((sum, payment) => sum + payment.amount, 0));
    expect(settleApprovedCompetitionDistributions(db, { competitionSeasonId: season.id, date: "2027-07-31" })).toEqual([]);
    db.close(); db = openGameDatabase(path);
    expect(new CompetitionDistributionRepository(db).payments(proposed.id)).toEqual(first);
    expect(new CompetitionDistributionRepository(db).policy(proposed.id)?.status).toBe("APPLIED");
    const expensive = createDistributionPolicy(db, { ...policyValues, version: 2, poolAmount: 100000000, federationId: federation.id, competitionSeasonId: season.id });
    new CompetitionDistributionRepository(db).upsertPolicy({ ...expensive, status: "APPROVED" });
    expect(() => settleApprovedCompetitionDistributions(db, { competitionSeasonId: season.id, date: "2027-07-31" })).toThrow("cannot afford");
    expect(new CompetitionDistributionRepository(db).payments(expensive.id)).toHaveLength(0);
    db.close();
  });
});
