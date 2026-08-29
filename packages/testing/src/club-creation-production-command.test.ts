import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];

const character = {
  fullName: "Maya Adhikari", preferredDisplayName: "Maya", dateOfBirth: "1993-05-12", startingAge: 33,
  languages: ["ne", "en"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER", coachingExperience: "YOUTH_COACH", businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("club creation production command", () => {
  it("founds a controlled playable club atomically and survives reload without league insertion", () => {
    const dir = mkdtempSync(join(tmpdir(), "club-creation-production-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Found club", character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const path = created.data.catalogEntry.filePath;
    service.closeCareer();
    const db = openGameDatabase(path);
    const save = db.prepare("SELECT player_character_id, world_date FROM saves LIMIT 1").get() as { player_character_id: EntityId; world_date: string };
    const person = db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId };
    const manager = db.prepare("SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE'").get(person.person_id) as { club_id: EntityId };
    const location = db.prepare("SELECT l.name FROM locations l JOIN countries co ON co.id=l.country_id WHERE co.iso_code IN ('NP','NPL') AND l.kind IN ('district','municipality','city') ORDER BY l.id LIMIT 1").get() as { name: string };
    db.prepare("INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("founder-context", manager.club_id, "PERSON", person.person_id, "Maya", "MAJORITY_OWNER", 75, 75, save.world_date, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
    db.close();

    expect(service.loadCareerByPath(path)).toMatchObject({ ok: true });
    expect(service.foundClub("Himalayan Founders FC", location.name)).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    const founded = service.foundClub("Himalayan Founders FC", location.name);
    expect(founded).toMatchObject({ ok: true, data: { admissionStatus: "PENDING", provenanceStatus: "SIMULATION_ONLY" } });
    if (!founded.ok) return;
    expect(service.foundClub("Himalayan Founders FC", location.name)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.saveCareer()).toMatchObject({ ok: true });
    service.closeCareer();

    const reloaded = openGameDatabase(path);
    const club = reloaded.prepare("SELECT id, country_id, location_id FROM clubs WHERE name=?").get("Himalayan Founders FC") as { id: EntityId; country_id: EntityId; location_id: EntityId };
    expect(club).toBeDefined();
    expect(reloaded.prepare("SELECT 1 FROM external_club_context WHERE club_id=?").get(club.id)).toBeUndefined();
    expect(reloaded.prepare("SELECT percentage, voting_percentage, holder_id, provenance_status FROM club_ownership_stakes WHERE club_id=? AND holder_id=?").get(club.id, person.person_id)).toMatchObject({ percentage: 100, voting_percentage: 100, holder_id: person.person_id, provenance_status: "SIMULATION_ONLY" });
    expect(reloaded.prepare("SELECT cash_balance, status FROM club_financial_accounts WHERE club_id=?").get(club.id)).toMatchObject({ cash_balance: 350000, status: "SIMULATION_ONLY" });
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM teams WHERE club_id=? AND level='senior' AND gender='men'").get(club.id) as { count: number }).count).toBe(1);
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE club_id=?").get(club.id) as { count: number }).count).toBe(0);
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM federation_grant_distributions WHERE club_id=?").get(club.id) as { count: number }).count).toBe(0);
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM youth_player_statuses WHERE club_id=?").get(club.id) as { count: number }).count).toBe(0);
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM simulation_club_records WHERE club_id=?").get(club.id) as { count: number }).count).toBe(1);
    reloaded.close();
  }, 300_000);

  it("rejects non-Nepal locations before creating any state", () => {
    const dir = mkdtempSync(join(tmpdir(), "club-creation-context-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
    const created = service.createCareer({ saveName: "Context club", character });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const path = created.data.catalogEntry.filePath;
    service.closeCareer();
    const db = openGameDatabase(path);
    const save = db.prepare("SELECT player_character_id FROM saves LIMIT 1").get() as { player_character_id: EntityId };
    const person = db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId };
    const manager = db.prepare("SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE'").get(person.person_id) as { club_id: EntityId };
    db.prepare("INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("founder-context-2", manager.club_id, "PERSON", person.person_id, "Maya", "MAJORITY_OWNER", 75, 75, "2026-08-01", "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
    db.close();
    expect(service.loadCareerByPath(path)).toMatchObject({ ok: true });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    expect(service.foundClub("Foreign Founders FC", "London")).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    service.closeCareer();
    const reloaded = openGameDatabase(path);
    expect((reloaded.prepare("SELECT COUNT(*) AS count FROM clubs WHERE name=?").get("Foreign Founders FC") as { count: number }).count).toBe(0);
    reloaded.close();
  }, 300_000);
});
