import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import { DesktopApplicationService } from "@nepal-football-sim/simulation";

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("chairman budget production command", () => {
  it("sets a controlled club budget only for the active chairman and persists it", () => {
    const dir = mkdtempSync(join(tmpdir(), "chairman-budget-command-"));
    dirs.push(dir);
    const service = new DesktopApplicationService({ savesDirectory: dir, worldDatasetPath: registryPath });
    const created = service.createCareer({
      saveName: "Chairman budget",
      character: {
        fullName: "Maya Adhikari", preferredDisplayName: "Maya", dateOfBirth: "1993-05-12", startingAge: 33,
        languages: ["ne", "en"], footballBackground: "COMMUNITY_COACHING", education: "SPORTS_RELATED_DEGREE",
        playingExperience: "AMATEUR_PLAYER", coachingExperience: "YOUTH_COACH", businessBackground: "SMALL_BUSINESS",
        startingReputationProfile: "LOCAL_RESPECTED",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const path = created.data.catalogEntry.filePath;
    service.closeCareer();
    const db = openGameDatabase(path);
    const save = db.prepare("SELECT player_character_id, world_date FROM saves LIMIT 1").get() as { player_character_id: EntityId; world_date: string };
    const person = db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId };
    const manager = db.prepare("SELECT t.club_id FROM manager_contracts mc JOIN teams t ON t.id=mc.team_id WHERE mc.person_id=? AND mc.status='ACTIVE'").get(person.person_id) as { club_id: EntityId };
    db.prepare("INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("chairman-budget-owner", manager.club_id, "PERSON", person.person_id, "Maya Adhikari", "MAJORITY_OWNER", 75, 75, save.world_date, "ACTIVE", "PARTIALLY_BUYABLE", "SIMULATION_ONLY");
    db.close();

    expect(service.loadCareerByPath(path).ok).toBe(true);
    expect(service.setClubBudget(manager.club_id, "2026", "ACADEMY_BUDGET", 250000)).toMatchObject({ ok: false, error: { code: "ROLE_NOT_AUTHORIZED" } });
    expect(service.switchActiveCareerRole("CHAIRMAN_OWNER")).toMatchObject({ ok: true });
    expect(service.setClubBudget("wrong-club" as EntityId, "2026", "ACADEMY_BUDGET", 250000)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.setClubBudget(manager.club_id, "2026", "ACADEMY_BUDGET", 250000)).toMatchObject({ ok: true, data: { amount: 250000, category: "ACADEMY_BUDGET" } });
    expect(service.setClubBudget(manager.club_id, "2026", "ACADEMY_BUDGET", -1)).toMatchObject({ ok: false, error: { code: "INVALID_SELECTION" } });
    expect(service.saveCareer().ok).toBe(true);
    service.closeCareer();

    const reloaded = openGameDatabase(path);
    const budget = reloaded.prepare("SELECT amount, category FROM club_budgets WHERE club_id=? AND season_label=? AND category=?").get(manager.club_id, "2026", "ACADEMY_BUDGET") as { amount: number; category: string };
    expect(budget).toEqual({ amount: 250000, category: "ACADEMY_BUDGET" });
    reloaded.close();
  }, 300_000);
});
