import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

const savesDirectory = mkdtempSync(join(tmpdir(), "nepal-cross-division-audit-"));
const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: resolve("data/nepal/2026-08/club-registry.json") });

afterAll(() => { service.closeCareer(); rmSync(savesDirectory, { recursive: true, force: true }); });

describe("A/B/C cross-division functional audit", () => {
  it.each(["A", "B", "C"] as const)("audits %s Division with the shared manager-start path", (division) => {
    const option = service.listStartingClubs();
    expect(option.ok).toBe(true);
    if (!option.ok) return;
    const selected = option.data.find((item) => item.division === division);
    expect(selected).toBeDefined();
    if (!selected) return;
    const created = service.createCareer({
      saveName: `Cross Division ${division}`,
      careerMode: "MANAGER",
      joinTeamId: selected.teamId,
      character: { fullName: `${division} Audit Manager`, preferredDisplayName: `${division} Audit`, dateOfBirth: "1990-01-01", startingAge: 36, languages: ["en"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE", playingExperience: "AMATEUR_PLAYER", coachingExperience: "YOUTH_COACH", businessBackground: "SMALL_BUSINESS", startingReputationProfile: "LOCAL_RESPECTED" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const db = openGameDatabase(created.data.catalogEntry.filePath);
    try {
      const row = db.prepare("SELECT cm.competition_season_id AS season_id, t.id AS team_id FROM teams t JOIN club_memberships cm ON cm.team_id=t.id AND cm.status='ACTIVE' WHERE t.id=? LIMIT 1").get(selected.teamId) as { season_id?: string; team_id?: string } | undefined;
      expect(row?.season_id).toBeTruthy();
      if (!row?.season_id || !row.team_id) return;
      const teams = db.prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE competition_season_id=? AND status='ACTIVE'").get(row.season_id) as { count: number };
      const fixtures = db.prepare("SELECT COUNT(*) AS count FROM fixtures WHERE competition_season_id=?").get(row.season_id) as { count: number };
      expect(teams.count).toBeGreaterThan(1);
      expect(fixtures.count).toBe(teams.count * (teams.count - 1));
      expect((db.prepare("SELECT COUNT(*) AS count FROM team_person_assignments WHERE team_id=? AND role='PLAYER' AND ended_on IS NULL").get(row.team_id) as { count: number }).count).toBeGreaterThanOrEqual(18);
      expect((db.prepare("SELECT COUNT(*) AS count FROM venue_relationships WHERE club_id=(SELECT club_id FROM teams WHERE id=?) AND status!='CLOSED'").get(row.team_id) as { count: number }).count).toBeGreaterThan(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM fixtures WHERE competition_season_id=? AND (home_team_id=? OR away_team_id=?) AND lower(status)='scheduled'").get(row.season_id, selected.teamId, selected.teamId) as { count: number }).count).toBe(2 * (teams.count - 1));
    } finally { db.close(); }
  }, 240_000);
});
