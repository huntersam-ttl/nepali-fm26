import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { buildClubProfile, buildCompetitionProfile, buildStaffProfile, createNepalSave } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "entity-profiles-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("entity profile read models", () => {
  it("buildClubProfile resolves the controlling owner via holder_id/holder_type, not the nonexistent person_id/controlling_owner columns", () => {
    const db = openGameDatabase(makeSave("club-profile-owner"));
    const club = db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId };
    const person = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId };
    db.prepare(
      `INSERT INTO club_ownership_stakes
        (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("entity-profile-owner-stake", club.id, "PERSON", person.id, "Test Owner", "MAJORITY_OWNER", 60, 60, "2026-01-01", null, "ACTIVE", "SOLE_OWNER", "SIMULATION_ONLY");
    const profile = buildClubProfile(db, club.id, "CHAIRMAN_OWNER");
    expect(profile.owner?.entityType).toBe("INVESTOR");
    expect(profile.owner?.id).toBe(person.id);
    db.close();
  });

  it("buildStaffProfile reads staff_appointments.end_date, not the nonexistent contract_end column", () => {
    const db = openGameDatabase(makeSave("staff-profile-end-date"));
    const club = db.prepare("SELECT id FROM clubs ORDER BY id LIMIT 1").get() as { id: EntityId };
    const person = db.prepare("SELECT id FROM persons ORDER BY id LIMIT 1").get() as { id: EntityId };
    db.prepare(
      `INSERT INTO staff_appointments
        (id,person_id,organisation_type,club_id,role,start_date,end_date,employment_status)
        VALUES (?,?,?,?,?,?,?,?)`,
    ).run("entity-profile-staff-appointment", person.id, "CLUB", club.id, "HEAD_COACH", "2026-01-01", "2028-01-01", "ACTIVE");
    const profile = buildStaffProfile(db, person.id, "CHAIRMAN_OWNER");
    expect(profile.role).toBe("HEAD_COACH");
    expect(profile.club?.id).toBe(club.id);
    expect(profile.contractEnd).toBe("2028-01-01");
    db.close();
  });

  it("buildCompetitionProfile resolves standings to real clubs.id via teams.club_id, not the raw teams.id", () => {
    const db = openGameDatabase(makeSave("competition-profile-standings"));
    const team = db
      .prepare("SELECT id, club_id FROM teams WHERE club_id IS NOT NULL AND level='senior' ORDER BY id LIMIT 1")
      .get() as { id: EntityId; club_id: EntityId };
    const season = db
      .prepare("SELECT cs.id, cs.competition_id FROM competition_seasons cs ORDER BY cs.end_date DESC, cs.id DESC LIMIT 1")
      .get() as { id: EntityId; competition_id: EntityId };
    db.prepare(
      `INSERT OR REPLACE INTO league_standings
        (competition_season_id,team_id,played,won,drawn,lost,goals_for,goals_against,goal_difference,points)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(season.id, team.id, 1, 1, 0, 0, 3, 0, 3, 3);
    const profile = buildCompetitionProfile(db, season.competition_id, "CHAIRMAN_OWNER");
    expect(profile.standings.length).toBeGreaterThan(0);
    const row = profile.standings.find((entry) => entry.points === 3);
    expect(row?.team.entityType).toBe("CLUB");
    expect(row?.team.id).toBe(team.club_id);
    expect(row?.team.id).not.toBe(team.id);
    db.close();
  });
});
