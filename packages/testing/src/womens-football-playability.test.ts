import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createNepalSave,
  ensureWomensFootballWorldForSave,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "womens-football-playability-"));
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

describe("women's football production playability", () => {
  it("initializes a persistent competition and viable gender-correct squads idempotently", () => {
    const db = openGameDatabase(makeSave("womens-production-init"));
    const first = ensureWomensFootballWorldForSave(db, { worldDate: "2026-08-01" });
    const second = ensureWomensFootballWorldForSave(db, { worldDate: "2026-08-01" });

    simulateNepalCareer({
      db,
      seasons: 0,
      seed: "womens-production-init",
      competitionSeasonId: first.competitionSeason.id,
    });

    expect(second.competitionSeason.id).toBe(first.competitionSeason.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM competitions WHERE category = 'WOMENS_LEAGUE'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE competition_season_id = ?").get(first.competitionSeason.id)).toEqual({ count: 10 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM teams WHERE level = 'senior' AND gender = 'women' AND club_id IS NOT NULL").get()).toEqual({ count: first.teamIds.length });
    const squads = db.prepare("SELECT t.id, COUNT(DISTINCT tpa.person_id) AS players, SUM(CASE WHEN pa.primary_position = 'GK' THEN 1 ELSE 0 END) AS goalkeepers, SUM(CASE WHEN pa.primary_position IN ('CB','RB','LB') THEN 1 ELSE 0 END) AS defenders, SUM(CASE WHEN pa.primary_position IN ('DM','CM','AM') THEN 1 ELSE 0 END) AS midfielders, SUM(CASE WHEN pa.primary_position IN ('RW','LW','ST') THEN 1 ELSE 0 END) AS attackers, SUM(CASE WHEN p.gender_presentation = 'female' THEN 1 ELSE 0 END) AS women FROM teams t JOIN team_person_assignments tpa ON tpa.team_id = t.id AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL JOIN player_attributes pa ON pa.person_id = tpa.person_id JOIN persons p ON p.id = tpa.person_id WHERE t.level = 'senior' AND t.gender = 'women' GROUP BY t.id ORDER BY t.id").all() as Array<{ id: EntityId; players: number; goalkeepers: number; defenders: number; midfielders: number; attackers: number; women: number }>;
    expect(squads).toHaveLength(10);
    expect(squads.every((squad) => squad.players >= 11 && squad.goalkeepers > 0 && squad.defenders > 0 && squad.midfielders > 0 && squad.attackers > 0 && squad.women === squad.players)).toBe(true);
    db.close();
  });

  it("runs the women's competition through the normal season simulator", () => {
    const db = openGameDatabase(makeSave("womens-production-season"));
    const season = ensureWomensFootballWorldForSave(db, { worldDate: "2026-08-01" });
    const report = simulateNepalCareer({
      db,
      seasons: 1,
      seed: "womens-production-season",
      competitionSeasonId: season.competitionSeason.id,
    });

    expect(report.seasons).toHaveLength(1);
    expect(report.seasons[0]?.matchesPlayed).toBe(report.seasons[0]?.fixturesGenerated);
    expect(db.prepare("SELECT COUNT(*) AS count FROM fixtures WHERE competition_season_id = ?").get(season.competitionSeason.id)).toEqual({ count: 90 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM competition_winners WHERE competition_season_id = ?").get(season.competitionSeason.id)).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM historical_events WHERE event_type = 'COMPETITION_SEASON_COMPLETED'").get()).toEqual({ count: 1 });
    db.close();
  });
});
