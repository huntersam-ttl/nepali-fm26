import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, migrateDatabase } from "@nepal-football-sim/database";
import { DesktopApplicationService, heldCareerRoles } from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const WORLD_DATASET = resolve("data/nepal/2026-08/club-registry.json");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("career role switching", () => {
  it("switches only among held roles, persists control, and reconciles role loss", () => {
    const savesDirectory = mkdtempSync(join(tmpdir(), "career-role-switching-"));
    tempDirs.push(savesDirectory);
    const service = new DesktopApplicationService({ savesDirectory, worldDatasetPath: WORLD_DATASET });
    const created = service.createCareer({
      saveName: "Role Switching",
      character: {
        fullName: "Maya Adhikari",
        preferredDisplayName: "Maya",
        dateOfBirth: "1993-05-12",
        startingAge: 33,
        languages: ["ne", "en"],
        footballBackground: "COMMUNITY_COACHING",
        education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER",
        coachingExperience: "YOUTH_COACH",
        businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const saveId = created.data.save.id;
    const savePath = created.data.catalogEntry.filePath;
    service.closeCareer();

    const db = openGameDatabase(savePath);
    migrateDatabase(db);
    const personId = (
      db.prepare("SELECT person_id FROM career_characters WHERE id = ?").get(created.data.save.playerCharacterId!) as {
        person_id: EntityId;
      }
    ).person_id;
    const managerClub = db.prepare("SELECT club_id FROM manager_contracts WHERE person_id = ? AND status = 'ACTIVE'").get(personId) as { club_id: EntityId };
    const federation = db.prepare("SELECT f.id FROM federations f JOIN clubs c ON c.country_id = f.country_id WHERE c.id = ? LIMIT 1").get(managerClub.club_id) as { id: EntityId };
    const now = created.data.save.worldDate;
    db.prepare(`INSERT INTO club_ownership_stakes
      (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,end_date,status,ownership_model,provenance_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "role-switch-owner" as EntityId, managerClub.club_id, "PERSON", personId, "Maya Adhikari",
      "MAJORITY_OWNER", 75, 75, now, null, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY",
    );
    db.prepare(`INSERT INTO federation_leadership_tenures
      (id,person_id,federation_id,role,term_start,term_end,status,provenance_status)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      "role-switch-president" as EntityId, personId, federation.id, "FEDERATION_PRESIDENT", now,
      "2030-01-01", "ACTIVE", "SIMULATION_ONLY",
    );
    const beforeRoles = db.prepare("SELECT COUNT(*) AS count FROM person_roles WHERE person_id = ?").get(personId) as { count: number };
    const beforeOwnership = db.prepare("SELECT percentage FROM club_ownership_stakes WHERE id = ?").get("role-switch-owner") as { percentage: number };
    const beforeCash = db.prepare("SELECT cash FROM personal_financial_profiles WHERE person_id = ?").get(personId) as { cash: number } | undefined;
    db.close();

    expect(service.loadCareer(saveId).ok).toBe(true);
    expect(service.getCareerRoles()).toMatchObject({ ok: true, data: { activeRole: "MANAGER", heldRoles: ["MANAGER", "CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"] } });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true, data: { activeRole: "CHAIRMAN_OWNER" } });
    expect(service.getSquad()).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true, data: { activeRole: "CHAIRMAN_OWNER" } });
    expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT")).toMatchObject({ ok: true, data: { activeRole: "FEDERATION_PRESIDENT" } });
    expect(service.switchActiveCareerRole("MANAGER")).toMatchObject({ ok: true, data: { activeRole: "MANAGER" } });
    expect(service.getSquad().ok).toBe(true);

    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    expect(service.saveCareer().ok).toBe(true);
    service.closeCareer();
    expect(service.loadCareer(saveId)).toMatchObject({ ok: true, data: { header: { activeRole: "CHAIRMAN_OWNER" } } });

    const reloaded = openGameDatabase(savePath);
    migrateDatabase(reloaded);
    expect(heldCareerRoles(reloaded, personId).map((entry) => entry.role)).toEqual(["MANAGER", "CHAIRMAN_OWNER", "FEDERATION_PRESIDENT"]);
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM person_roles WHERE person_id = ?").get(personId) as { count: number }).count).toBe(beforeRoles.count);
    expect((reloaded.prepare("SELECT percentage FROM club_ownership_stakes WHERE id = ?").get("role-switch-owner") as { percentage: number }).percentage).toBe(beforeOwnership.percentage);
    expect((reloaded.prepare("SELECT cash FROM personal_financial_profiles WHERE person_id = ?").get(personId) as { cash: number } | undefined)?.cash).toBe(beforeCash?.cash);
    reloaded.prepare("UPDATE club_ownership_stakes SET status = 'ENDED', end_date = ? WHERE id = ?").run("2028-01-01", "role-switch-owner");
    reloaded.prepare("UPDATE federation_leadership_tenures SET status = 'FORMER', term_end = ? WHERE id = ?").run("2028-01-01", "role-switch-president");
    reloaded.close();
    expect(service.getCareerRoles()).toMatchObject({ ok: true, data: { activeRole: "MANAGER", heldRoles: ["MANAGER"] } });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    service.closeCareer();
  }, 180_000);
});
