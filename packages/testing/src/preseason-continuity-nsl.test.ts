import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerRepository, openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  hasStructuralPositionShortage,
  repairPreseasonContinuity,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/**
 * Release-hardening regression: `isCoreContinuityCompetition` (the allow-list
 * that gates which competitions get preseason squad repair — youth
 * promotion, free-agent signings, emergency player generation) was missing
 * "Nepal Super League", a real top-flight competition in the canonical
 * dataset. Its member clubs never got repaired, so ordinary season-to-season
 * attrition (transfers, contract expiry, retirement) drained several of them
 * to 0-1 registered senior players over an 8-season soak. This test proves
 * the fix directly against the actual repair behavior, not just string
 * membership in the allow-list.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const openSave = () => {
  const dir = mkdtempSync(join(tmpdir(), "nsl-continuity-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: "nsl-continuity",
    gameVersion: "test",
    randomSeed: "nsl-continuity",
  });
  return openGameDatabase(path);
};

const competitionSeasonId = (
  db: ReturnType<typeof openSave>,
  competitionName: string,
): { seasonId: EntityId; clubId: EntityId; teamId: EntityId } => {
  const season = db
    .prepare(
      `SELECT cs.id AS seasonId FROM competition_seasons cs
       JOIN competitions c ON c.id = cs.competition_id
       WHERE c.name = ? ORDER BY cs.start_date LIMIT 1`,
    )
    .get(competitionName) as { seasonId: EntityId } | undefined;
  if (!season) throw new Error(`No competition season found for "${competitionName}"`);
  const member = db
    .prepare(
      `SELECT cm.club_id AS clubId, t.id AS teamId FROM club_memberships cm
       JOIN teams t ON t.club_id = cm.club_id AND t.level = 'senior'
       WHERE cm.competition_season_id = ? AND cm.status NOT IN ('WITHDRAWN', 'SUSPENDED', 'INELIGIBLE')
       LIMIT 1`,
    )
    .get(season.seasonId) as { clubId: EntityId; teamId: EntityId } | undefined;
  if (!member) throw new Error(`No member club found for competition season "${competitionName}"`);
  return { seasonId: season.seasonId, clubId: member.clubId, teamId: member.teamId };
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("release: Nepal Super League preseason squad continuity", () => {
  it("repairs a depleted Nepal Super League club back to a viable squad", () => {
    const db = openSave();
    const { seasonId, teamId } = competitionSeasonId(db, "Nepal Super League");

    // Reproduce the exact failure mode found in the 8-season soak: a
    // member club whose senior roster has been drained to nothing by
    // attrition (every registered player's assignment ended).
    db.prepare(
      `UPDATE team_person_assignments SET ended_on = '2026-06-30'
       WHERE team_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
    ).run(teamId);
    const players = new PlayerRepository(db);
    expect(players.attributesForTeam(teamId)).toHaveLength(0);

    const reports = repairPreseasonContinuity({
      db,
      competitionSeasonIds: [seasonId],
      date: "2026-07-01",
      seed: "nsl-continuity-repair",
    });

    // The season must actually have been processed (not silently skipped as
    // a non-core competition) and must have repaired at least one club.
    expect(reports).toHaveLength(1);
    expect(reports[0].clubsRepaired).toBeGreaterThan(0);

    const repaired = players.attributesForTeam(teamId);
    expect(repaired.length).toBeGreaterThanOrEqual(11);
    expect(hasStructuralPositionShortage(repaired)).toBe(false);
    db.close();
  });

  it("does not pull a non-core competition (Martyr's Memorial C-Division League) into continuity repair", () => {
    const db = openSave();
    const { seasonId, teamId } = competitionSeasonId(db, "Martyr's Memorial C-Division League");

    db.prepare(
      `UPDATE team_person_assignments SET ended_on = '2026-06-30'
       WHERE team_id = ? AND role = 'PLAYER' AND ended_on IS NULL`,
    ).run(teamId);
    const players = new PlayerRepository(db);
    expect(players.attributesForTeam(teamId)).toHaveLength(0);

    const reports = repairPreseasonContinuity({
      db,
      competitionSeasonIds: [seasonId],
      date: "2026-07-01",
      seed: "nsl-continuity-context-only",
    });

    // A non-core competition must be skipped entirely — no report emitted,
    // and critically, no repair applied to its depleted club either.
    expect(reports).toHaveLength(0);
    expect(players.attributesForTeam(teamId)).toHaveLength(0);
    db.close();
  });
});
