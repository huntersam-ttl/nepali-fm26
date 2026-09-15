import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

const character = {
  fullName: "Base Career President",
  preferredDisplayName: "President",
  dateOfBirth: "1990-01-01",
  startingAge: 36,
  languages: ["ne", "en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("temporary federation presidency", () => {
  it("returns an owner to the owner career when the presidential term ends", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "president-base-owner-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const clubs = service.listStartingClubs();
    if (!clubs.ok || !clubs.data[0]?.teamId) throw new Error("No starting club available");

    const created = service.createCareer({
      saveName: "Owner President Return",
      careerMode: "MANAGER",
      joinTeamId: clubs.data[0].teamId,
      character,
    });
    if (!created.ok) throw new Error(created.error.message);
    const saveId = created.data.save.id;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(created.data.save.playerCharacterId!) as {
        person_id: EntityId;
      }
    ).person_id;
    const managerClub = db
      .prepare("SELECT club_id FROM manager_contracts WHERE person_id=? AND status='ACTIVE' LIMIT 1")
      .get(personId) as { club_id: EntityId };
    const federation = db
      .prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id=f.country_id WHERE c.id=? LIMIT 1")
      .get(managerClub.club_id) as { id: EntityId };

    db.prepare(`INSERT INTO club_ownership_stakes
      (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "owner-president-base-stake",
      managerClub.club_id,
      "PERSON",
      personId,
      character.fullName,
      "MAJORITY_OWNER",
      75,
      75,
      created.data.save.worldDate,
      null,
      "ACTIVE",
      "PARTIALLY_BUYABLE",
      "SIMULATION_ONLY",
    );
    db.prepare(`INSERT INTO federation_leadership_tenures
      (id,person_id,federation_id,role,term_start,term_end,status,provenance_status)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      "owner-president-base-term",
      personId,
      federation.id,
      "FEDERATION_PRESIDENT",
      created.data.save.worldDate,
      "2030-01-01",
      "ACTIVE",
      "SIMULATION_ONLY",
    );
    db.close();

    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({
      ok: true,
      data: { activeRole: "CHAIRMAN_OWNER" },
    });
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({
      ok: true,
      data: { activeRole: "FEDERATION_PRESIDENT" },
    });

    const ended = openGameDatabase(savePath);
    migrateDatabase(ended);
    ended
      .prepare("UPDATE federation_leadership_tenures SET status='FORMER', term_end=? WHERE id=?")
      .run("2028-01-01", "owner-president-base-term");
    ended.close();

    expect(service.getCareerRoles()).toMatchObject({
      ok: true,
      data: { activeRole: "CHAIRMAN_OWNER" },
    });
    expect(service.getChairmanDashboard().ok).toBe(true);
    service.closeCareer();
  }, 180_000);
});
