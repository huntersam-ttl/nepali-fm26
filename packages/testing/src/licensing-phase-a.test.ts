import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubLicensingRepository, openGameDatabase } from "@nepal-football-sim/database";
import { assessClubLicence, createNepalSave, initializeClubEconomyForSave } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

describe("club licensing phase A", () => {
  it("assesses from persisted club state and reloads the same case", () => {
    const dir = mkdtempSync(join(tmpdir(), "licensing-phase-a-"));
    const path = join(dir, "save.sqlite");
    createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")), saveName: "licensing", gameVersion: "test", randomSeed: "licensing" });
    const db = openGameDatabase(path);
    initializeClubEconomyForSave({ db, worldDate: "2027-07-01", seed: "licensing" });
    const row = db.prepare("SELECT f.id AS federation_id, cm.club_id, cm.competition_season_id, cs.name AS season_label FROM club_memberships cm JOIN competition_seasons cs ON cs.id=cm.competition_season_id JOIN competitions c ON c.id=cs.competition_id JOIN federations f ON f.country_id=(SELECT country_id FROM clubs WHERE id=cm.club_id) WHERE cm.status='ACTIVE' ORDER BY cm.club_id LIMIT 1").get() as { federation_id: EntityId; club_id: EntityId; competition_season_id: EntityId; season_label: string };
    const first = assessClubLicence(db, { federationId: row.federation_id, clubId: row.club_id, competitionSeasonId: row.competition_season_id, seasonLabel: row.season_label, date: "2027-07-01" });
    expect(new ClubLicensingRepository(db).get(first.id)).toEqual(first);
    const second = assessClubLicence(db, { federationId: row.federation_id, clubId: row.club_id, competitionSeasonId: row.competition_season_id, seasonLabel: row.season_label, date: "2027-07-01" });
    expect(second).toEqual(first);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
