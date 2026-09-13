import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import { createNepalSave } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Follow-up from the test-triage audit: career-pyramid-cleanup.test.ts now
 * correctly scopes its squad-size check to Nepal-registry players alone,
 * since a real career's default global seed also places genuine foreign
 * players on Nepal teams. That test manually spot-checked a handful of those
 * imports were not duplicate identities of registry players; this makes that
 * check an explicit, permanent regression.
 *
 * global-football-import.ts's importPerson reconciles by (full name, date of
 * birth, nationality) before creating a new person row, so a global import
 * that happens to match an existing Nepal-registry person by identity is
 * correctly mapped onto the SAME person_id rather than creating a second one.
 * But this test found a REAL defect (not a hypothetical): two Nepal players
 * genuinely appear in both the Nepal registry and the global v16 dataset —
 * "Arik Bista" (NEP-CBU-006 / PLY-000223) and "Anjan Bista" (NEP-NRT-004 /
 * PLY-000220) — and while importPerson correctly resolved both to one
 * person_id each, player_factual_profiles.canonical_external_id is
 * independently unique, so the global import still inserted a SECOND,
 * competing profile row for each — asserting a different (here, wrong)
 * current_club_id than their real registry club. Their actual
 * team_person_assignments row stayed correct throughout (only ever one
 * team, matching the registry), so this was a factual-profile data-integrity
 * defect, not a roster/team-assignment duplication.
 *
 * Fixed in global-football-import.ts: when the resolved person already has a
 * factual profile under a different external identity, the global import
 * skips creating a competing one rather than fielding two contradictory
 * identities for one physical player. A dataset-wide scan before the fix
 * found exactly these 2 competing-profile players (of 2591 total profiles);
 * after the fix, 0.
 */

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const KNOWN_OVERLAPS = [
  { name: "Arik Bista", registryExternalId: "NEP-CBU-006", globalExternalId: "PLY-000223" },
  { name: "Anjan Bista", registryExternalId: "NEP-NRT-004", globalExternalId: "PLY-000220" },
] as const;

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("global import identity guard", () => {
  const buildSave = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "global-import-identity-"));
    dirs.push(dir);
    const path = join(dir, "career.sqlite");
    createNepalSave({
      databasePath: path,
      dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
      saveName: "global-import-identity",
      gameVersion: "test",
      randomSeed: "global-import-identity",
    });
    return path;
  };

  it("no person in the whole imported world has more than one factual profile", () => {
    const db = openGameDatabase(buildSave());
    try {
      const globalImportCount = (
        db.prepare("SELECT COUNT(*) AS n FROM global_dataset_imports").get() as { n: number }
      ).n;
      expect(globalImportCount).toBeGreaterThan(0); // the default seed genuinely ran

      // The real invariant, unscoped by team/gender/country: a physical
      // person may be known under several external identities across
      // datasets, but must resolve to exactly one canonical factual profile.
      const duplicated = db
        .prepare(
          `SELECT player_id AS playerId, GROUP_CONCAT(canonical_external_id) AS externalIds, COUNT(*) AS n
           FROM player_factual_profiles
           GROUP BY player_id
           HAVING COUNT(*) > 1`,
        )
        .all() as Array<{ playerId: EntityId; externalIds: string; n: number }>;
      expect(duplicated).toEqual([]);

      const totalProfiles = (
        db.prepare("SELECT COUNT(*) AS n FROM player_factual_profiles").get() as { n: number }
      ).n;
      expect(totalProfiles).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }, 300000);

  it("known registry/global overlaps resolve to one profile, one club, and one team assignment", () => {
    const db = openGameDatabase(buildSave());
    try {
      for (const overlap of KNOWN_OVERLAPS) {
        const registryProfile = db
          .prepare("SELECT player_id AS playerId, current_club_id AS currentClubId FROM player_factual_profiles WHERE canonical_external_id = ?")
          .get(overlap.registryExternalId) as { playerId: EntityId; currentClubId: EntityId | null } | undefined;
        expect(registryProfile, `${overlap.name}'s registry profile (${overlap.registryExternalId}) should exist`).toBeDefined();

        // The global identity must not exist as its own competing profile —
        // it was reconciled onto the registry person, not given a second row.
        const globalProfile = db
          .prepare("SELECT 1 FROM player_factual_profiles WHERE canonical_external_id = ?")
          .get(overlap.globalExternalId);
        expect(globalProfile, `${overlap.name}'s global identity (${overlap.globalExternalId}) must not have its own profile row`).toBeUndefined();

        // Exactly one active team assignment, matching the club the
        // authoritative (registry) profile itself points at.
        const assignments = db
          .prepare(
            `SELECT t.club_id AS clubId FROM team_person_assignments tpa
             JOIN teams t ON t.id = tpa.team_id
             WHERE tpa.person_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL`,
          )
          .all(registryProfile!.playerId) as Array<{ clubId: EntityId }>;
        expect(assignments, `${overlap.name} must have exactly one active team assignment`).toHaveLength(1);
        expect(assignments[0]!.clubId).toBe(registryProfile!.currentClubId);
      }
    } finally {
      db.close();
    }
  }, 300000);

  it("no Nepal senior-men team player is counted as both a registry identity and a global-import identity", () => {
    const db = openGameDatabase(buildSave());
    try {
      const rows = db
        .prepare(
          `SELECT tpa.person_id AS playerId, f.canonical_external_id AS externalId
           FROM team_person_assignments tpa
           JOIN teams t ON t.id = tpa.team_id
           JOIN clubs c ON c.id = t.club_id
           JOIN countries k ON k.id = c.country_id
           JOIN player_factual_profiles f ON f.player_id = tpa.person_id
           WHERE k.iso_code IN ('NP', 'NPL')
             AND t.level = 'senior' AND t.gender = 'men'
             AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM external_club_context e
               WHERE e.club_id = c.id AND e.simulation_depth = 'CONTEXT_ONLY'
             )`,
        )
        .all() as Array<{ playerId: EntityId; externalId: string }>;
      expect(rows.length).toBeGreaterThan(0);

      const registryPlayerIds = new Set(
        rows
          .filter((row) => !row.externalId.startsWith("PLY-") && !row.externalId.startsWith("bootstrap:"))
          .map((row) => row.playerId),
      );
      const importedPlayerIds = new Set(
        rows.filter((row) => row.externalId.startsWith("PLY-")).map((row) => row.playerId),
      );
      expect(registryPlayerIds.size).toBeGreaterThan(0);

      const overlap = [...importedPlayerIds].filter((id) => registryPlayerIds.has(id));
      expect(overlap).toEqual([]);
    } finally {
      db.close();
    }
  }, 300000);
});
