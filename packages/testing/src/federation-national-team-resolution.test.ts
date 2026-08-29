import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import {
  createNepalSave,
  initializeFederationGovernanceForSave,
  processFederationMonth,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const seededDatabase = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `nepal-nt-resolution-${label}-`));
  tempDirs.push(directory);
  const databasePath = join(directory, "career.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `National team resolution ${label}`,
    gameVersion: "test",
    randomSeed: `national-team-resolution-${label}`,
  });
  return openGameDatabase(databasePath);
};

describe("federation national-team resolution", () => {
  it("never fields a club-backed team as a federation national team", () => {
    const db = seededDatabase("club-backed");
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "resolution" });

      // A club-backed senior men's team that sorts ahead of every real national
      // team is exactly the shape that previously hijacked federation selection.
      const federations = db
        .prepare("SELECT DISTINCT federation_id AS id FROM teams WHERE club_id IS NULL AND level = 'senior' AND gender = 'men'")
        .all() as Array<{ id: string }>;
      expect(federations.length).toBeGreaterThan(0);
      const club = db.prepare("SELECT id FROM clubs LIMIT 1").get() as { id: string };
      for (const federation of federations) {
        db.prepare(
          "INSERT INTO teams (id, club_id, federation_id, name, level, gender) VALUES (?, ?, ?, ?, 'senior', 'men')",
        ).run(`decoy-${federation.id}`, club.id, federation.id, `AAA Decoy Club Senior Men ${federation.id}`);
      }

      processFederationMonth(db, { date: "2026-11-28", seed: "resolution" });

      // Every appearance must belong to a genuine federation national team.
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM national_team_appearances a
             JOIN teams t ON t.id = a.national_team_id
             WHERE t.club_id IS NOT NULL`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM national_team_fixtures f
             JOIN teams t ON t.id = f.national_team_id
             WHERE t.club_id IS NOT NULL`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }, 180000);

  it("no-ops national-team planning for federations without a canonical national team", () => {
    const db = seededDatabase("no-team");
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "resolution" });

      // Strip one federation down to club-backed teams only.
      const target = db
        .prepare("SELECT federation_id AS id FROM teams WHERE club_id IS NULL AND level = 'senior' AND gender = 'men' LIMIT 1")
        .get() as { id: string };
      db.prepare("DELETE FROM national_team_callups WHERE national_team_id IN (SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL)").run(target.id);
      db.prepare("DELETE FROM teams WHERE federation_id = ? AND club_id IS NULL").run(target.id);
      const club = db.prepare("SELECT id FROM clubs LIMIT 1").get() as { id: string };
      db.prepare(
        "INSERT INTO teams (id, club_id, federation_id, name, level, gender) VALUES (?, ?, ?, ?, 'senior', 'men')",
      ).run(`orphan-${target.id}`, club.id, target.id, "Orphan Club Senior Men");

      expect(() => processFederationMonth(db, { date: "2026-11-28", seed: "resolution" })).not.toThrow();
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM national_team_fixtures WHERE national_team_id = ?")
          .get(`orphan-${target.id}`),
      ).toEqual({ count: 0 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }, 180000);

  it("keeps transient replacement players out of person-keyed history", () => {
    const db = seededDatabase("replacements");
    try {
      initializeFederationGovernanceForSave({ db, worldDate: "2026-08-01", seed: "resolution" });
      processFederationMonth(db, { date: "2026-11-28", seed: "resolution" });
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM national_team_appearances a
             LEFT JOIN persons p ON p.id = a.player_id
             WHERE p.id IS NULL OR a.player_id LIKE '%:replacement:%'`,
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }, 180000);
});
