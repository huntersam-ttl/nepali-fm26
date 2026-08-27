import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClubLicensingRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { ClubMembership, CompetitionRelationship, CompetitionRuleSet, CompetitionSeason, EntityId, LeagueStanding } from "@nepal-football-sim/shared-types";
import { createNepalSave, processClubLicensingForSeason, progressPyramidSeason, simulateNepalCareer } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "licensing-production-"));
  dirs.push(dir);
  const path = join(dir, "save.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("club licensing production activation", () => {
  it("runs from normal career rollover and is idempotent per season", () => {
    const db = openGameDatabase(makeSave("licensing-production"));
    const season = db.prepare("SELECT cs.id FROM competition_seasons cs JOIN competitions c ON c.id = cs.competition_id WHERE c.name = 'Martyr''s Memorial A-Division League' ORDER BY cs.start_date LIMIT 1").get() as { id: EntityId };
    const report = simulateNepalCareer({ db, seasons: 1, seed: "licensing-production", competitionSeasonId: season.id });
    expect(report.seasons).toHaveLength(1);
    const first = new ClubLicensingRepository(db).cases(season.id);
    expect(first.length).toBe(14);
    expect(first.every((item) => item.history.some((event) => event.action === "ASSESSED"))).toBe(true);
    const second = processClubLicensingForSeason(db, { competitionSeasonId: season.id, date: "2027-07-31", seasonLabel: "2026" });
    expect(second.cases).toEqual(first);
    expect(new ClubLicensingRepository(db).cases(season.id)).toHaveLength(14);
    db.close();
  });

  it("keeps a target division full when a sporting promotion fails licensing", () => {
    const source = { id: "source-season" as EntityId, competitionId: "source" as EntityId, name: "Source", startDate: "2026-01-01", endDate: "2026-12-31" };
    const target = { id: "target-season" as EntityId, competitionId: "target" as EntityId, name: "Target", startDate: "2027-01-01", endDate: "2027-12-31" };
    const rule = { id: "rule" as EntityId, competitionSeasonId: source.id, competitionType: "ROUND_ROBIN", pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tiebreakers: ["points"], numberOfRounds: 1, homeAwayStructure: "single", seasonStartDate: source.startDate, seasonEndDate: source.endDate, roundSpacingDays: 7, promotionSlots: 1, relegationSlots: 0, continentalQualificationSlots: 0 };
    const membership = (clubId: string, teamId: string): ClubMembership => ({ id: `${clubId}-membership` as EntityId, clubId: clubId as EntityId, teamId: teamId as EntityId, competitionId: source.competitionId, competitionSeasonId: source.id, membershipType: "LEAGUE_MEMBER", status: "ACTIVE" });
    const result = progressPyramidSeason({ completedSeasons: [{ season: source as CompetitionSeason, ruleSet: rule as CompetitionRuleSet, standings: [{ teamId: "blocked-team" as EntityId, position: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 1, goalsAgainst: 0, goalDifference: 1, points: 3 }, { teamId: "eligible-team" as EntityId, position: 2, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 1, goalsAgainst: 0, goalDifference: 1, points: 3 }] as LeagueStanding[], memberships: [membership("blocked", "blocked-team"), membership("eligible", "eligible-team")] }], nextSeasons: new Map([[target.competitionId, target as CompetitionSeason]]), relationships: [{ id: "promotion" as EntityId, fromCompetitionId: source.competitionId, toCompetitionId: target.competitionId, movementType: "PROMOTION", numberOfTeams: 1, selectionMethod: "TOP_TABLE" } as CompetitionRelationship], eligibleClubIds: new Set(["eligible" as EntityId]) });
    expect(result.movements.map((movement) => movement.status)).toEqual(["INELIGIBLE", "APPLIED"]);
    expect(result.nextMemberships.map((item) => item.clubId)).toEqual(["eligible"]);
  });
});
