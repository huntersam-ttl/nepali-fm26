import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecruitmentRepository, openGameDatabase } from "@nepal-football-sim/database";
import type { EntityId, KnowledgeRange } from "@nepal-football-sim/shared-types";
import {
  addPlayerToShortlist,
  createNepalSave,
  createScoutingAssignment,
  generateScoutReport,
  getPlayerKnowledge,
  initializeRecruitmentForSave,
  recordMatchObservation,
  runScoutingDiagnostic,
  searchPlayersForClub,
  simulateScoutingDay,
} from "@nepal-football-sim/simulation";

const tempDirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const tempDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "nepal-football-scouting-"));
  tempDirs.push(dir);
  return join(dir, "scouting.sqlite");
};

const createSave = (seed: string): string => {
  const databasePath = tempDbPath();
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: `Scouting ${seed}`,
    gameVersion: "0.2.0",
    randomSeed: seed,
    globalSeedPath: null,
  });
  return databasePath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scouting and player knowledge", () => {
  it("separates own squad knowledge from hidden player truth", () => {
    const db = openGameDatabase(createSave("own-squad-knowledge"));
    const clubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const playerId = playerForClub(db, clubId);

    initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed: "own-squad-knowledge" });

    const knowledge = getPlayerKnowledge(db, clubId, playerId);
    const result = searchPlayersForClub(db, clubId, {}, "2026-08-01").find(
      (item) => item.playerId === playerId,
    );

    expect(knowledge?.sourceType).toBe("OWN_PLAYER");
    expect(knowledge?.discoveryStatus).toBe("SCOUTED");
    expect(knowledge?.knowledgeLevel).toBe("EXTENSIVE");
    expect(result?.estimatedAbility).toEqual(
      expect.objectContaining({ min: expect.any(Number), max: expect.any(Number) }),
    );
    expect(result?.estimatedPotential).toEqual(expect.any(String));
    expect("currentAbility" in (result as object)).toBe(false);
    expect("potentialAbility" in (result as object)).toBe(false);
    db.close();
  });

  it("keeps players invisible until public exposure or scouting creates club knowledge", () => {
    const db = openGameDatabase(createSave("discovery-boundary"));
    const clubId = clubIdByCanonical(db, "NEP-DIVA-MAC");

    expect(searchPlayersForClub(db, clubId, {}, "2026-08-01")).toHaveLength(0);

    initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed: "discovery-boundary" });

    const discovered = searchPlayersForClub(db, clubId, {}, "2026-08-01");
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered.every((item) => item.discoveryStatus !== "UNDISCOVERED")).toBe(true);
    db.close();
  });

  it("narrows ability ranges through deterministic scouting reports without exact leaks", () => {
    const db = openGameDatabase(createSave("assignment-knowledge"));
    const clubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const targetId = playerOutsideClub(db, clubId);

    initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed: "assignment-knowledge" });
    const before = searchPlayersForClub(db, clubId, {}, "2026-08-01").find(
      (item) => item.playerId === targetId,
    )!;
    const assignment = createScoutingAssignment(db, {
      clubId,
      targetPlayerId: targetId,
      startedAt: "2026-08-01",
      priority: "HIGH",
    });

    const completed = simulateScoutingDay({
      db,
      worldDate: assignment.expectedCompletionAt,
      seed: "assignment-knowledge",
    });
    const after = searchPlayersForClub(db, clubId, {}, assignment.expectedCompletionAt).find(
      (item) => item.playerId === targetId,
    )!;
    const report = generateScoutReport(
      db,
      clubId,
      targetId,
      assignment.expectedCompletionAt,
      "assignment-knowledge",
    );

    expect(completed.assignmentsCompleted).toBe(1);
    expect(after.discoveryStatus).toBe("SCOUTED");
    expect(rangeWidth(after.estimatedAbility)).toBeLessThanOrEqual(
      rangeWidth(before.estimatedAbility),
    );
    expect(report.estimatedAbilityBand).toEqual(after.estimatedAbility);
    expect(report.recommendation).toEqual(expect.any(String));
    expect("currentAbility" in (report as object)).toBe(false);
    db.close();
  });

  it("decays stale knowledge and persists shortlist state after reload", () => {
    const databasePath = createSave("decay-shortlist");
    let db = openGameDatabase(databasePath);
    const clubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const targetId = playerOutsideClub(db, clubId);

    initializeRecruitmentForSave({ db, worldDate: "2026-08-01", seed: "decay-shortlist" });
    const fresh = searchPlayersForClub(db, clubId, {}, "2026-08-01").find(
      (item) => item.playerId === targetId,
    )!;
    addPlayerToShortlist(db, {
      clubId,
      playerId: targetId,
      addedAt: "2026-08-01",
      priority: "INTERESTED",
      notes: "Monitor via scouting reports",
    });
    db.close();

    db = openGameDatabase(databasePath);
    const stale = searchPlayersForClub(db, clubId, {}, "2028-09-01").find(
      (item) => item.playerId === targetId,
    )!;
    const shortlist = new RecruitmentRepository(db).shortlist(clubId);

    expect(stale.knowledgeLevel).not.toBe("EXTENSIVE");
    expect(rangeWidth(stale.estimatedAbility)).toBeGreaterThanOrEqual(
      rangeWidth(fresh.estimatedAbility),
    );
    expect(shortlist.map((item) => item.playerId)).toContain(targetId);
    db.close();
  });

  it("records match observation as imperfect club knowledge", () => {
    const db = openGameDatabase(createSave("match-observation"));
    const observerClubId = clubIdByCanonical(db, "NEP-DIVA-MAC");
    const targetId = playerOutsideClub(db, observerClubId);

    recordMatchObservation(db, observerClubId, [targetId], "2026-08-15", "match-observation");

    const knowledge = getPlayerKnowledge(db, observerClubId, targetId);
    expect(knowledge?.sourceType).toBe("MATCH_OBSERVATION");
    expect(knowledge?.knowledgeLevel).toBe("MINIMAL");
    expect(knowledge?.abilityKnowledge).toHaveProperty("estimatedAbility");
    expect(knowledge?.positionKnowledge.exactPosition).toBeUndefined();
    db.close();
  });

  it("produces deterministic diagnostics for the same save and seed", () => {
    const first = openGameDatabase(createSave("deterministic-scouting"));
    const second = openGameDatabase(createSave("deterministic-scouting"));

    const firstReport = runScoutingDiagnostic(first, {
      seed: "deterministic-scouting",
      worldDate: "2026-08-01",
    });
    const secondReport = runScoutingDiagnostic(second, {
      seed: "deterministic-scouting",
      worldDate: "2026-08-01",
    });

    expect(firstReport).toEqual(secondReport);
    first.close();
    second.close();
  });
});

function clubIdByCanonical(
  db: ReturnType<typeof openGameDatabase>,
  canonicalExternalId: string,
): EntityId {
  return (
    db.prepare("SELECT id FROM clubs WHERE canonical_external_id = ?").get(canonicalExternalId) as {
      id: EntityId;
    }
  ).id;
}

function playerForClub(db: ReturnType<typeof openGameDatabase>, clubId: EntityId): EntityId {
  return (
    db
      .prepare(
        "SELECT player_id AS id FROM player_factual_profiles WHERE current_club_id = ? LIMIT 1",
      )
      .get(clubId) as { id: EntityId }
  ).id;
}

function playerOutsideClub(db: ReturnType<typeof openGameDatabase>, clubId: EntityId): EntityId {
  return (
    db
      .prepare(
        `SELECT player_id AS id
        FROM player_factual_profiles
        WHERE current_club_id IS NOT NULL AND current_club_id <> ?
        ORDER BY player_id
        LIMIT 1`,
      )
      .get(clubId) as { id: EntityId }
  ).id;
}

function rangeWidth(range: KnowledgeRange | undefined): number {
  return range ? range.max - range.min : Number.POSITIVE_INFINITY;
}
