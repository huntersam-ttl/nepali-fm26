import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openGameDatabase, SquadDynamicsRepository, TransferMarketRepository } from "@nepal-football-sim/database";
import {
  answerPressQuestion,
  createNepalSave,
  startPressConference,
  structuredPressInboxItems,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const makeSave = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "press-inbox-"));
  dirs.push(dir);
  const path = join(dir, "career.sqlite");
  createNepalSave({
    databasePath: path,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: name,
    gameVersion: "test",
    randomSeed: name,
  });
  return path;
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const ensureManagerFor = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId => {
  const existing = db
    .prepare(`SELECT person_id AS personId FROM manager_contracts WHERE team_id = ? AND status = 'ACTIVE' LIMIT 1`)
    .get(teamId) as { personId: EntityId } | undefined;
  if (existing) return existing.personId;
  const person = db
    .prepare(`SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM manager_profiles) LIMIT 1`)
    .get() as { id: EntityId };
  const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as { club_id: EntityId }).club_id;
  const profileId = `test-manager-profile-${person.id}` as EntityId;
  db.prepare(
    `INSERT INTO manager_profiles (id, person_id, attributes_json, preferred_style, reputation_profile, created_on)
     VALUES (?, ?, '{}', 'BALANCED', 'UNKNOWN', '2026-01-01')`,
  ).run(profileId, person.id);
  db.prepare(
    `INSERT INTO manager_contracts (id, manager_profile_id, person_id, team_id, club_id, job_title, contract_start, salary_amount_minor, currency, status)
     VALUES (?, ?, ?, ?, ?, 'Head Coach', '2026-01-01', 100000, 'NPR', 'ACTIVE')`,
  ).run(`test-manager-contract-${person.id}`, profileId, person.id, teamId, clubId);
  return person.id;
};

const playerOnTeam = (db: ReturnType<typeof openGameDatabase>, teamId: EntityId): EntityId => {
  const clubId = (db.prepare("SELECT club_id FROM teams WHERE id = ?").get(teamId) as { club_id: EntityId }).club_id;
  const taken = db
    .prepare(
      `SELECT person_id FROM manager_profiles
       UNION SELECT player_id AS person_id FROM player_contracts WHERE status = 'ACTIVE'`,
    )
    .all() as Array<{ person_id: EntityId }>;
  const takenIds = new Set(taken.map((row) => row.person_id));
  const persons = db.prepare("SELECT id FROM persons").all() as Array<{ id: EntityId }>;
  const person = persons.find((row) => !takenIds.has(row.id));
  if (!person) throw new Error("no free person available to contract");
  new TransferMarketRepository(db).upsertPlayerContract({
    id: `test-player-contract-${person.id}` as EntityId,
    playerId: person.id,
    clubId,
    startDate: "2026-01-01",
    endDate: "2028-01-01",
    contractType: "PERMANENT",
    salary: 50000,
    appearanceFee: 0,
    goalBonus: 0,
    cleanSheetBonus: 0,
    signingBonus: 0,
    loyaltyBonus: 0,
    currency: "NPR",
    squadRole: "ROTATION",
    status: "ACTIVE",
    provenance: { sourceName: "SIMULATION_ONLY", confidence: 1 },
  });
  return person.id;
};

describe("structured press interviews — Inbox delivery", () => {
  it("delivers exactly one Inbox item for a pending interview, advances it to 'Continuing', and removes it on completion", () => {
    const db = openGameDatabase(makeSave("press-inbox-lifecycle"));
    const teamId = (db.prepare("SELECT id FROM teams LIMIT 1").get() as { id: EntityId }).id;
    const managerPersonId = ensureManagerFor(db, teamId);
    const player = playerOnTeam(db, teamId);
    new SquadDynamicsRepository(db).upsertConcern({
      id: "inbox-concern" as EntityId,
      personId: player,
      teamId,
      type: "TRANSFER_INTEREST",
      status: "ACTIVE",
      severity: 5,
      raisedOn: "2026-09-01",
      updatedOn: "2026-09-01",
    });

    // Nothing pending before any interview is opened.
    expect(structuredPressInboxItems(db, managerPersonId)).toHaveLength(0);

    const interview = startPressConference(db, {
      context: "TRANSFER",
      managerPersonId,
      teamId,
      date: "2026-09-05",
    });
    expect(interview.structuredQuestions!.length).toBeGreaterThan(0);

    const pending = structuredPressInboxItems(db, managerPersonId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.type).toBe("PRESS_INTERVIEW");
    expect(pending[0]!.title).toBe("Transfer interview available");
    expect(pending[0]!.relatedEntity).toEqual({ id: interview.id, type: "mediaInterview" });
    // Journalist + outlet + the real subject player are all resolved, real,
    // clickable references — never a raw id.
    expect(pending[0]!.entityReferences!.some((ref) => ref.entityType === "JOURNALIST" && ref.visible)).toBe(true);
    expect(pending[0]!.entityReferences!.some((ref) => ref.entityType === "MEDIA_OUTLET" && ref.visible)).toBe(true);
    expect(pending[0]!.entityReferences!.some((ref) => ref.id === player && ref.visible)).toBe(true);

    // Calling it again (as a duplicate publisher run would) never creates a
    // second delivery for the same interview — it's computed fresh from the
    // interview's own real state, not a separately persisted row.
    expect(structuredPressInboxItems(db, managerPersonId)).toHaveLength(1);

    const totalQuestions = interview.structuredQuestions!.length;
    const afterFirstAnswer = answerPressQuestion(db, {
      interviewId: interview.id,
      stance: interview.structuredQuestions![0]!.options[0]!.stance,
      teamId,
      date: "2026-09-05",
    });

    if (totalQuestions > 1) {
      const partial = structuredPressInboxItems(db, managerPersonId);
      expect(partial).toHaveLength(1);
      expect(partial[0]!.title).toBe("Continuing: Transfer interview");
      expect(afterFirstAnswer.status).toBe("OPEN");

      // Finish the rest.
      let current = afterFirstAnswer;
      while (current.status === "OPEN") {
        current = answerPressQuestion(db, {
          interviewId: interview.id,
          stance: current.structuredQuestions![current.currentQuestionIndex!]!.options[0]!.stance,
          teamId,
          date: "2026-09-05",
        });
      }
    }

    // Completed: no stale pending/continue action ever remains.
    expect(structuredPressInboxItems(db, managerPersonId)).toHaveLength(0);
    db.close();
  });

  it("never delivers an Inbox item for an interview with zero grounded questions", () => {
    const db = openGameDatabase(makeSave("press-inbox-empty"));
    const teamId = (db.prepare("SELECT id FROM teams LIMIT 1").get() as { id: EntityId }).id;
    const managerPersonId = ensureManagerFor(db, teamId);
    // No active concern/demand exists, so PLAYER_ISSUE grounds zero questions.
    startPressConference(db, { context: "PLAYER_ISSUE", managerPersonId, teamId, date: "2026-09-05" });
    expect(structuredPressInboxItems(db, managerPersonId)).toHaveLength(0);
    db.close();
  });
});
