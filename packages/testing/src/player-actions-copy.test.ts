import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StaffMarketRepository, openGameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type SaveMetadata } from "@nepal-football-sim/shared-types";
import { buildActorPlayerActions, createNepalSave } from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "player-actions-copy-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({ databasePath: path, dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown, saveName: name, gameVersion: "test", randomSeed: name });
  return path;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const save: SaveMetadata = {
  id: "player-actions-copy-save" as EntityId,
  name: "Player Actions Copy",
  worldDate: "2026-08-16",
  databaseVersion: 1,
  gameVersion: "test",
  randomSeed: "player-actions-copy",
  createdAt: "2026-08-16T00:00:00.000Z",
  lastSavedAt: "2026-08-16T00:00:00.000Z",
};

describe("buildActorPlayerActions: actor-aware blocked-reason copy", () => {
  it("gives each non-Manager actor its own reason instead of Manager-specific wording, without changing what's authorized", () => {
    const db = openGameDatabase(makeSave("player-actions-copy"));
    const team = db
      .prepare(
        `SELECT t.id, t.club_id FROM teams t
         WHERE t.club_id IS NOT NULL AND t.level='senior'
           AND EXISTS (SELECT 1 FROM player_contracts pc WHERE pc.club_id=t.club_id AND pc.status='ACTIVE')
         ORDER BY t.id LIMIT 1`,
      )
      .get() as { id: EntityId; club_id: EntityId };
    const player = db.prepare("SELECT player_id FROM player_contracts WHERE club_id=? AND status='ACTIVE' ORDER BY player_id LIMIT 1").get(team.club_id) as { player_id: EntityId };
    const managerId = db.prepare("SELECT id FROM persons WHERE id NOT IN (SELECT player_id FROM player_contracts) ORDER BY id LIMIT 1").get() as { id: EntityId };
    const ownerId = db.prepare("SELECT id FROM persons WHERE id NOT IN (SELECT player_id FROM player_contracts) AND id<>? ORDER BY id DESC LIMIT 1").get(managerId.id) as { id: EntityId };
    const outsiderId = db.prepare("SELECT id FROM persons WHERE id NOT IN (SELECT player_id FROM player_contracts) AND id NOT IN (?,?) ORDER BY id LIMIT 1 OFFSET 5").get(managerId.id, ownerId.id) as { id: EntityId };

    db.prepare(
      `INSERT INTO manager_profiles (id,person_id,attributes_json,reputation_profile,created_on)
       VALUES (?,?,?,?,?)`,
    ).run("pac-manager-profile", managerId.id, "{}", "SIMULATION_ONLY", "2026-01-01");
    db.prepare(
      `INSERT INTO manager_contracts (id,manager_profile_id,person_id,team_id,club_id,job_title,contract_start,salary_amount_minor,currency,status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run("pac-manager-contract", "pac-manager-profile", managerId.id, team.id, team.club_id, "Head Coach", "2026-01-01", 100_000, "NPR", "ACTIVE");
    db.prepare(
      `INSERT INTO club_ownership_stakes (id,club_id,holder_type,holder_id,holder_name,role,percentage,voting_percentage,start_date,status,ownership_model,provenance_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("pac-owner-stake", team.club_id, "PERSON", ownerId.id, "Test Owner", "MAJORITY_OWNER", 60, 60, "2026-01-01", "ACTIVE", "SOLE_OWNER", "SIMULATION_ONLY");
    // Delegate transfer responsibility to the board (no approval window
    // granted) so the Manager is genuinely denied and exercises the
    // Manager-specific reason text this test is checking.
    new StaffMarketRepository(db).upsertResponsibility({
      id: createStableEntityId("staff-responsibility", `${team.club_id}:TRANSFERS`),
      clubId: team.club_id,
      domain: "TRANSFERS",
      ownerType: "BOARD",
      updatedOn: "2026-01-01",
    });

    const managerResult = buildActorPlayerActions(db, save, "MANAGER", managerId.id, player.player_id);
    const ownerResult = buildActorPlayerActions(db, save, "CHAIRMAN_OWNER", ownerId.id, player.player_id);
    const presidentResult = buildActorPlayerActions(db, save, "FEDERATION_PRESIDENT", outsiderId.id, player.player_id);
    const executiveResult = buildActorPlayerActions(db, save, "CEO", outsiderId.id, player.player_id);

    const transferOf = (result: ReturnType<typeof buildActorPlayerActions>) =>
      result.actions.find((action) => action.id === "TRANSFER_LIST")!;

    // Transfers are delegated to the board, so the Manager is genuinely
    // denied too — but their reason must name the Manager's own missing
    // responsibility, not a generic message.
    const managerReason = transferOf(managerResult).reason;
    expect(managerReason).toBe("Transfer responsibility is not currently available to the Manager.");

    // The Owner, President, and a delegated executive must each get their
    // own actor-specific reason — none of them should ever see the
    // Manager-specific "responsibility ... not available to the Manager"
    // copy, since that's not who they are and not why they're blocked.
    const ownerReason = transferOf(ownerResult).reason!;
    const presidentReason = transferOf(presidentResult).reason!;
    const executiveReason = transferOf(executiveResult).reason!;
    for (const reason of [ownerReason, presidentReason, executiveReason]) {
      expect(reason).not.toContain("not currently available to the Manager");
    }
    expect(ownerReason).toMatch(/Owner view is read-only/);
    expect(presidentReason).toMatch(/President/);
    expect(executiveReason).toMatch(/delegated/i);
    // The three non-Manager reasons must also be distinct from each other.
    expect(new Set([ownerReason, presidentReason, executiveReason]).size).toBe(3);

    // Authority itself is unchanged: transfer authority was delegated away
    // from the Manager, and no other actor here has any football authority
    // over this club at all — every actor is correctly denied every action.
    expect(managerResult.actions.every((action) => !action.available)).toBe(false);
    expect(transferOf(managerResult).available).toBe(false);
    expect(ownerResult.actions.every((action) => !action.available)).toBe(true);
    expect(presidentResult.actions.every((action) => !action.available)).toBe(true);
    expect(executiveResult.actions.every((action) => !action.available)).toBe(true);
    db.close();
  });
});
