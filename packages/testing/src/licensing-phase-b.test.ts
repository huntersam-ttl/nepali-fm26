import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ClubLicensingRepository, openGameDatabase } from "@nepal-football-sim/database";
import { assessClubLicence, appealClubLicence, closeClubLicenceCycle, createNepalSave, finaliseClubLicence, initializeClubEconomyForSave, openClubLicenceCycle } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

describe("club licensing phase B", () => {
  it("keeps a deterministic seasonal lifecycle and historical decisions", () => {
    const dir = mkdtempSync(join(tmpdir(), "licensing-phase-b-")); const path = join(dir, "save.sqlite");
    createNepalSave({ databasePath:path, dataset:JSON.parse(readFileSync(resolve(process.cwd(), "data/nepal/2026-08/club-registry.json"), "utf8")), saveName:"licensing-b", gameVersion:"test", randomSeed:"licensing-b" }); const db = openGameDatabase(path); initializeClubEconomyForSave({ db, worldDate:"2027-07-01", seed:"licensing-b" });
    const row = db.prepare("SELECT f.id AS federation_id, cm.club_id, cm.competition_season_id, cs.name AS season_label FROM club_memberships cm JOIN competition_seasons cs ON cs.id=cm.competition_season_id JOIN competitions c ON c.id=cs.competition_id JOIN federations f ON f.country_id=(SELECT country_id FROM clubs WHERE id=cm.club_id) WHERE cm.status='ACTIVE' ORDER BY cm.club_id LIMIT 1").get() as { federation_id:EntityId; club_id:EntityId; competition_season_id:EntityId; season_label:string };
    const pending = openClubLicenceCycle(db, { federationId:row.federation_id, clubId:row.club_id, competitionSeasonId:row.competition_season_id, seasonLabel:row.season_label, date:"2027-07-01" }); expect(pending.status).toBe("PENDING"); const assessed = assessClubLicence(db, { federationId:row.federation_id, clubId:row.club_id, competitionSeasonId:row.competition_season_id, seasonLabel:row.season_label, date:"2027-07-01" }); const final = finaliseClubLicence(db, { caseId:assessed.id, date:"2028-04-01" }); expect(final.status).toBe("FAILED"); const appealed = appealClubLicence(db, { caseId:final.id, date:"2028-04-02" }); const closed = closeClubLicenceCycle(db, { caseId:appealed.id, date:"2028-04-03" }); expect(closed.history.length).toBeGreaterThan(3); expect(new ClubLicensingRepository(db).get(closed.id)).toEqual(closed); db.close(); rmSync(dir, {recursive:true, force:true});
  });
});
