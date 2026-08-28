import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GlobalFootballContextRepository,
  InternationalTrialsRepository,
  TransferMarketRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import type { EntityId } from "@nepal-football-sim/shared-types";
import {
  createInternationalTrial,
  createInternationalTrialFromForeignScouting,
  createInternationalTrialFromScouting,
  createNepalSave,
  createTransferOfferAfterInternationalTrial,
  getPlayerKnowledge,
  initializeForeignFootballWorldForSave,
  initializeRecruitmentForSave,
  isContextOnlyClub,
  processInternationalTrials,
  respondToInternationalTrial,
  updateForeignScoutingInterest,
  createScoutingAssignment,
  simulateScoutingDay,
} from "@nepal-football-sim/simulation";

const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");
const fixturePath = resolve(process.cwd(), "data/global/football_world_import_v16_reconciled_fixture.json");
const directories: string[] = [];

const createWorld = (seed: string, globalSeedPath: string | null = null): string => {
  const directory = mkdtempSync(join(tmpdir(), `international-trials-${seed}-`));
  directories.push(directory);
  const databasePath = join(directory, "world.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `International trials ${seed}`,
    gameVersion: "test",
    randomSeed: seed,
    globalSeedPath,
  });
  const db = openGameDatabase(databasePath);
  initializeForeignFootballWorldForSave({ db, worldDate: "2026-08-01", seed });
  initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed });
  db.close();
  return databasePath;
};

const nepalClub = (db: ReturnType<typeof openGameDatabase>): EntityId =>
  (
    db
      .prepare(
        `SELECT c.id FROM clubs c JOIN countries co ON co.id = c.country_id
         WHERE co.iso_code IN ('NP','NPL') AND c.canonical_external_id LIKE 'NEP-NSL-%'
         ORDER BY c.id LIMIT 1`,
      )
      .get() as { id: EntityId }
  ).id;

const foreignPlayer = (
  db: ReturnType<typeof openGameDatabase>,
  isoCode: string,
): EntityId =>
  (
    db
      .prepare(
        `SELECT tpa.person_id AS player_id
         FROM team_person_assignments tpa
         JOIN teams t ON t.id = tpa.team_id
         JOIN clubs c ON c.id = t.club_id
         JOIN countries co ON co.id = c.country_id
         WHERE tpa.role = 'PLAYER' AND tpa.ended_on IS NULL AND co.iso_code = ?
         ORDER BY tpa.person_id LIMIT 1`,
      )
      .get(isoCode) as { player_id: EntityId }
  ).player_id;

const foreignClub = (db: ReturnType<typeof openGameDatabase>): EntityId =>
  (
    db
      .prepare("SELECT id FROM clubs WHERE canonical_external_id = 'SIM-FOREIGN-JP'")
      .get() as { id: EntityId }
  ).id;

const activeTeamClub = (
  db: ReturnType<typeof openGameDatabase>,
  playerId: EntityId,
): EntityId | undefined =>
  (
    db
      .prepare(
        `SELECT t.club_id AS club_id FROM team_person_assignments tpa
         JOIN teams t ON t.id = tpa.team_id
         WHERE tpa.person_id = ? AND tpa.role = 'PLAYER' AND tpa.ended_on IS NULL
         ORDER BY t.club_id LIMIT 1`,
      )
      .get(playerId) as { club_id?: EntityId } | undefined
  )?.club_id;

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("international trials", () => {
  it("moves from normal scouting to a temporary foreign-player trial, reloads, expires once, and hands off to a normal offer", () => {
    const databasePath = createWorld("foreign-to-nepal");
    let db = openGameDatabase(databasePath);
    const hostClubId = nepalClub(db);
    const playerId = foreignPlayer(db, "NG");
    const market = new TransferMarketRepository(db);
    const parentContract = market.activeContract(playerId, "2026-08-01");
    const parentTeamClub = activeTeamClub(db, playerId);
    expect(parentContract?.clubId).toBeDefined();
    expect(parentTeamClub).toBe(parentContract?.clubId);

    const assignment = createScoutingAssignment(db, {
      clubId: hostClubId,
      targetPlayerId: playerId,
      startedAt: "2026-08-01",
      priority: "HIGH",
    });
    expect(simulateScoutingDay({ db, worldDate: assignment.expectedCompletionAt, seed: "foreign-to-nepal" }).assignmentsCompleted).toBe(1);
    const beforeTrial = getPlayerKnowledge(db, hostClubId, playerId)!;
    const trial = createInternationalTrialFromScouting(db, {
      playerId,
      hostClubId,
      invitedOn: assignment.expectedCompletionAt,
      startDate: assignment.expectedCompletionAt,
      endDate: "2026-08-22",
      parentClubPermissionGranted: true,
      reason: "High-priority uncertain regional scouting target",
    });
    expect(trial.state).toBe("INVITED");
    expect(new TransferMarketRepository(db).activeContract(playerId, "2026-08-08")?.clubId).toBe(parentContract?.clubId);

    const active = respondToInternationalTrial(db, {
      trialId: trial.id,
      response: "ACCEPTED",
      responseDate: "2026-08-08",
      seed: "foreign-to-nepal",
    });
    expect(active.state).toBe("ACTIVE");
    const afterTrial = getPlayerKnowledge(db, hostClubId, playerId)!;
    expect(afterTrial.sourceType).toBe("TRIAL");
    expect(afterTrial.observations).toBeGreaterThan(beforeTrial.observations);
    expect(afterTrial.confidence).toBe("HIGH");
    expect(afterTrial.knowledgeLevel).toBe("COMPLETE");
    expect(activeTeamClub(db, playerId)).toBe(parentTeamClub);
    expect(db.prepare("SELECT COUNT(*) AS count FROM transfers WHERE person_id = ?").get(playerId)).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM transfer_history_events WHERE player_id = ?").get(playerId)).toEqual({ count: 0 });
    db.close();

    db = openGameDatabase(databasePath);
    const reloadedActive = new InternationalTrialsRepository(db).get(trial.id)!;
    expect(reloadedActive).toMatchObject({ id: trial.id, playerId, hostClubId, state: "ACTIVE", startDate: "2026-08-08", endDate: "2026-08-22" });
    expect(processInternationalTrials(db, { worldDate: "2026-08-22" })).toEqual({ expired: 0, completed: 1 });
    expect(processInternationalTrials(db, { worldDate: "2026-08-22" })).toEqual({ expired: 0, completed: 0 });
    const completed = new InternationalTrialsRepository(db).get(trial.id)!;
    expect(completed.state).toBe("COMPLETED");
    expect(getPlayerKnowledge(db, hostClubId, playerId)?.sourceType).toBe("TRIAL");
    expect(new TransferMarketRepository(db).activeContract(playerId, "2026-08-22")?.clubId).toBe(parentContract?.clubId);
    expect(activeTeamClub(db, playerId)).toBe(parentTeamClub);

    const offer = createTransferOfferAfterInternationalTrial(db, {
      trialId: trial.id,
      submittedAt: "2026-08-23",
    });
    expect(offer.buyingClubId).toBe(hostClubId);
    expect(offer.sellingClubId).toBe(parentContract?.clubId);
    expect(offer.status).toBe("SUBMITTED");
    expect(new InternationalTrialsRepository(db).get(trial.id)?.state).toBe("COMPLETED");
    db.close();
  }, 300000);

  it("keeps rejection side-effect free and rejects duplicate active, missing permission, and invalid dates", () => {
    const databasePath = createWorld("trial-guards");
    const db = openGameDatabase(databasePath);
    const hostClubId = nepalClub(db);
    const rejectedPlayerId = foreignPlayer(db, "IN");
    const rejected = createInternationalTrial(db, {
      playerId: rejectedPlayerId,
      hostClubId,
      invitedOn: "2026-08-01",
      startDate: "2026-08-08",
      endDate: "2026-08-22",
      parentClubPermissionGranted: true,
    });
    expect(respondToInternationalTrial(db, { trialId: rejected.id, response: "REJECTED", responseDate: "2026-08-08", seed: "trial-guards" }).state).toBe("REJECTED");
    expect(getPlayerKnowledge(db, hostClubId, rejectedPlayerId)).toBeUndefined();

    const contractedPlayerId = foreignPlayer(db, "GH");
    expect(() => createInternationalTrial(db, {
      playerId: contractedPlayerId,
      hostClubId,
      invitedOn: "2026-08-01",
      startDate: "2026-08-08",
      endDate: "2026-08-22",
    })).toThrow("permission");

    const active = createInternationalTrial(db, {
      playerId: contractedPlayerId,
      hostClubId,
      invitedOn: "2026-08-01",
      startDate: "2026-08-08",
      endDate: "2026-08-22",
      parentClubPermissionGranted: true,
    });
    respondToInternationalTrial(db, { trialId: active.id, response: "ACCEPTED", responseDate: "2026-08-08", seed: "trial-guards" });
    expect(() => createInternationalTrial(db, {
      playerId: contractedPlayerId,
      hostClubId,
      invitedOn: "2026-08-09",
      startDate: "2026-08-09",
      endDate: "2026-08-23",
      parentClubPermissionGranted: true,
    })).toThrow("active trial");
    expect(() => createInternationalTrial(db, {
      playerId: rejectedPlayerId,
      hostClubId,
      invitedOn: "2026-08-10",
      startDate: "2026-08-10",
      endDate: "2026-08-09",
      parentClubPermissionGranted: true,
    })).toThrow("dates");
    db.close();
  }, 300000);

  it("supports a Nepal player going to a context-only foreign club through persisted foreign scouting interest", () => {
    const databasePath = createWorld("nepal-to-foreign");
    const db = openGameDatabase(databasePath);
    updateForeignScoutingInterest(db, { date: "2026-08-01", seed: "nepal-to-foreign" });
    const interest = new GlobalFootballContextRepository(db).interests().find((item) => item.level === "INTERESTED");
    expect(interest).toBeDefined();
    expect(isContextOnlyClub(db, interest!.externalClubId)).toBe(true);
    const parentClub = new TransferMarketRepository(db).activeContract(interest!.targetPlayerId, "2026-08-01")?.clubId;
    expect(parentClub).toBeDefined();
    const trial = createInternationalTrialFromForeignScouting(db, {
      interestId: interest!.id,
      playerId: interest!.targetPlayerId,
      invitedOn: "2026-08-01",
      startDate: "2026-08-08",
      endDate: "2026-08-22",
      parentClubPermissionGranted: true,
    });
    const active = respondToInternationalTrial(db, { trialId: trial.id, response: "ACCEPTED", responseDate: "2026-08-08", seed: "nepal-to-foreign" });
    expect(active.hostClubId).toBe(interest!.externalClubId);
    expect(active.state).toBe("ACTIVE");
    expect(new TransferMarketRepository(db).activeContract(interest!.targetPlayerId, "2026-08-08")?.clubId).toBe(parentClub);
    expect(activeTeamClub(db, interest!.targetPlayerId)).toBe(parentClub);
    expect(processInternationalTrials(db, { worldDate: "2026-08-22" })).toEqual({ expired: 0, completed: 1 });
    expect(new InternationalTrialsRepository(db).get(trial.id)?.state).toBe("COMPLETED");
    expect(isContextOnlyClub(db, interest!.externalClubId)).toBe(true);
    db.close();
  }, 300000);

  it("makes a dynamically selected imported Africa or South Asia candidate trial-eligible after real scouting cadence", () => {
    const databasePath = createWorld("imported-candidate", fixturePath);
    const db = openGameDatabase(databasePath);
    const hostClubId = nepalClub(db);
    const imported = db
      .prepare(
        `SELECT pfp.player_id AS player_id, co.iso_code AS iso_code
         FROM player_factual_profiles pfp
         JOIN clubs c ON c.id = pfp.current_club_id
         JOIN countries co ON co.id = c.country_id
         WHERE pfp.record_status = 'VERIFIED' AND co.iso_code IN ('NGA','IND','NG','IN')
         ORDER BY CASE WHEN co.iso_code IN ('NGA','NG') THEN 0 ELSE 1 END, pfp.player_id LIMIT 1`,
      )
      .get() as { player_id: EntityId; iso_code: string } | undefined;
    expect(imported).toBeDefined();
    const assignment = createScoutingAssignment(db, { clubId: hostClubId, targetPlayerId: imported!.player_id, startedAt: "2026-08-01", priority: "HIGH" });
    expect(simulateScoutingDay({ db, worldDate: assignment.expectedCompletionAt, seed: "imported-candidate" }).assignmentsCompleted).toBe(1);
    const trial = createInternationalTrialFromScouting(db, {
      playerId: imported!.player_id,
      hostClubId,
      invitedOn: assignment.expectedCompletionAt,
      startDate: assignment.expectedCompletionAt,
      endDate: "2026-08-22",
      parentClubPermissionGranted: true,
    });
    expect(trial.source).toBe("SCOUTING");
    expect(getPlayerKnowledge(db, hostClubId, imported!.player_id)?.discoveryStatus).toBe("SCOUTED");
    expect(respondToInternationalTrial(db, { trialId: trial.id, response: "ACCEPTED", responseDate: assignment.expectedCompletionAt, seed: "imported-candidate" }).state).toBe("ACTIVE");
    db.close();
  }, 300000);
});
