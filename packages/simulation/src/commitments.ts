import {
  CompetitionRepository,
  EventRepository,
  SquadDynamicsRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type EntityId,
  type ManagerPromise,
  type SaveMetadata,
} from "@nepal-football-sim/shared-types";

export type CommitmentSource = "BOARD_INTERVIEW" | "PRESS_CONFERENCE" | "FEDERATION";
export type CommitmentType =
  | "PROMOTION_CHALLENGE"
  | "YOUTH_USAGE"
  | "FINANCIAL_DISCIPLINE"
  | "SQUAD_STRENGTHENING"
  | "FACILITY_PROJECT"
  | "TACTICAL_STYLE"
  /** A press-made "we won't sell him" style commitment — targetCriteria
   * carries the player's personId, evaluated against whether they are still
   * contracted to the club by the due date. */
  | "TRANSFER_STANCE";

export type CommitmentInput = {
  source: CommitmentSource;
  managerProfileId: EntityId;
  managerPersonId: EntityId;
  teamId: EntityId;
  type: CommitmentType;
  targetCriteria: string;
  dueOn: string;
  description: string;
  originEventId: EntityId;
  importance?: number;
  recipientType?: "BOARD" | "SUPPORTERS" | "MEDIA" | "FEDERATION";
};

const measurableTypes = new Set<CommitmentType>([
  "PROMOTION_CHALLENGE",
  "YOUTH_USAGE",
  "FINANCIAL_DISCIPLINE",
  "SQUAD_STRENGTHENING",
  "FACILITY_PROJECT",
  "TACTICAL_STYLE",
  "TRANSFER_STANCE",
]);

/** Creates a canonical manager promise only for structured, measurable commitments. */
export const createStructuredCommitment = (
  db: GameDatabase,
  worldDate: string,
  input: CommitmentInput,
): ManagerPromise | undefined => {
  if (!measurableTypes.has(input.type) || !input.targetCriteria.trim()) return undefined;
  const id = createStableEntityId(
    "manager-commitment",
    `${input.originEventId}:${input.managerProfileId}:${input.type}`,
  );
  const promise: ManagerPromise = {
    id,
    managerProfileId: input.managerProfileId,
    personId: input.managerPersonId,
    teamId: input.teamId,
    type: input.type,
    description: input.description,
    madeOn: worldDate,
    dueOn: input.dueOn,
    status: "ACTIVE",
    commitmentSource: input.source,
    recipientType: input.recipientType ?? (input.source === "PRESS_CONFERENCE" ? "MEDIA" : "BOARD"),
    recipientId: input.recipientType === "SUPPORTERS" ? input.teamId : undefined,
    targetCriteria: input.targetCriteria,
    originEventId: input.originEventId,
    importance: Math.max(1, Math.min(10, input.importance ?? 6)),
  };
  const repo = new SquadDynamicsRepository(db);
  const existing = repo.promiseById(id);
  if (existing) return existing;
  repo.upsertPromise(promise);
  return promise;
};

/** Extracts only explicit structured promise tokens from a press response. */
export const commitmentFromPressResponse = (
  db: GameDatabase,
  worldDate: string,
  input: Omit<CommitmentInput, "source" | "type" | "targetCriteria" | "description"> & {
    response: string;
  },
): ManagerPromise | undefined => {
  const match = input.response.match(/\[PROMISE:(PROMOTION|YOUTH|SQUAD_STRENGTHENING)\]/i);
  if (!match) return undefined;
  const type: CommitmentType =
    match[1]!.toUpperCase() === "PROMOTION"
      ? "PROMOTION_CHALLENGE"
      : match[1]!.toUpperCase() === "YOUTH"
        ? "YOUTH_USAGE"
        : "SQUAD_STRENGTHENING";
  return createStructuredCommitment(db, worldDate, {
    ...input,
    source: "PRESS_CONFERENCE",
    type,
    targetCriteria: match[1]!.toUpperCase(),
    description: input.response.replace(match[0], "").trim(),
  });
};

export const commitmentsFromManagerInterview = (input: {
  db: GameDatabase;
  save: SaveMetadata;
  managerProfileId: EntityId;
  managerPersonId: EntityId;
  teamId: EntityId;
  vacancyId: EntityId;
  boardExpectation?: string;
  youthCommitment?: "PRIORITIZE" | "BALANCED" | "EXPERIENCE";
}): ManagerPromise[] => {
  const result: ManagerPromise[] = [];
  const typeByExpectation: Record<string, CommitmentType | undefined> = {
    PROMOTION: "PROMOTION_CHALLENGE",
    TITLE_CHALLENGE: "PROMOTION_CHALLENGE",
    YOUTH_DEVELOPMENT: "YOUTH_USAGE",
  };
  const type = typeByExpectation[input.boardExpectation ?? ""];
  if (type) {
    const commitment = createStructuredCommitment(input.db, input.save.worldDate, {
      source: "BOARD_INTERVIEW",
      managerProfileId: input.managerProfileId,
      managerPersonId: input.managerPersonId,
      teamId: input.teamId,
      type,
      targetCriteria: type === "YOUTH_USAGE" ? "YOUTH" : "TOP_THIRD_OR_PROMOTION",
      dueOn: `${Number(input.save.worldDate.slice(0, 4)) + 1}-05-31`,
      description:
        type === "YOUTH_USAGE"
          ? "Commitment to give meaningful opportunities to youth players."
          : "Commitment to challenge for promotion or the title.",
      originEventId: input.vacancyId,
      importance: 7,
    });
    if (commitment) result.push(commitment);
  }
  if (input.youthCommitment === "PRIORITIZE" && type !== "YOUTH_USAGE") {
    const commitment = createStructuredCommitment(input.db, input.save.worldDate, {
      source: "BOARD_INTERVIEW",
      managerProfileId: input.managerProfileId,
      managerPersonId: input.managerPersonId,
      teamId: input.teamId,
      type: "YOUTH_USAGE",
      targetCriteria: "YOUTH",
      dueOn: `${Number(input.save.worldDate.slice(0, 4)) + 1}-05-31`,
      description: "Commitment to give meaningful opportunities to youth players.",
      originEventId: input.vacancyId,
      importance: 6,
    });
    if (commitment) result.push(commitment);
  }
  return result;
};

/** Resolves non-concern promises from real season/squad state at a safe tick. */
export const evaluateStructuredCommitments = (
  db: GameDatabase,
  save: SaveMetadata,
  teamId: EntityId,
): ManagerPromise[] => {
  const repo = new SquadDynamicsRepository(db);
  const terminal: ManagerPromise[] = [];
  for (const promise of repo
    .activePromisesForTeam(teamId)
    .filter((item) => item.commitmentSource && item.commitmentSource !== "PLAYER_CONCERN")) {
    if (save.worldDate < promise.dueOn) continue;
    let evaluable = true;
    let fulfilled = false;
    if (promise.type === "PROMOTION_CHALLENGE") {
      const season = db
        .prepare(
          "SELECT id FROM competition_seasons WHERE start_date <= ? AND end_date >= ? ORDER BY start_date DESC LIMIT 1",
        )
        .get(save.worldDate, save.worldDate) as { id?: EntityId } | undefined;
      const standings = season ? new CompetitionRepository(db).standings(season.id!) : [];
      const position = standings.findIndex((entry) => entry.teamId === teamId);
      evaluable = position >= 0 && standings.length > 0;
      fulfilled = evaluable && position < Math.ceil(standings.length / 3);
    } else if (promise.type === "SQUAD_STRENGTHENING") {
      const current = Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM player_contracts pc JOIN teams t ON t.club_id = pc.club_id WHERE t.id = ? AND pc.status = 'ACTIVE' AND pc.start_date <= ? AND (pc.end_date IS NULL OR pc.end_date >= ?)",
            )
            .get(teamId, save.worldDate, save.worldDate) as { count?: number } | undefined
        )?.count ?? 0,
      );
      evaluable = promise.baselineMetric !== undefined;
      fulfilled = evaluable && current > promise.baselineMetric!;
    } else if (promise.type === "YOUTH_USAGE") {
      const youthAppearances = Number(
        (
          db
            .prepare(
              `SELECT COALESCE(SUM(ps.appearances), 0) AS appearances
               FROM player_season_stats ps
               JOIN persons p ON p.id = ps.person_id
               WHERE ps.team_id = ? AND p.date_of_birth IS NOT NULL
                 AND CAST(strftime('%Y', ?) AS INTEGER) - CAST(strftime('%Y', p.date_of_birth) AS INTEGER) <= 21`,
            )
            .get(teamId, save.worldDate) as { appearances?: number } | undefined
        )?.appearances ?? 0,
      );
      evaluable = true;
      fulfilled = youthAppearances > 0;
    } else if (promise.type === "TRANSFER_STANCE" && promise.targetCriteria) {
      // targetCriteria carries the player's personId — "kept" means still
      // under an active contract at this club on the due date.
      const stillHere = db
        .prepare(
          `SELECT 1 FROM player_contracts pc
           WHERE pc.player_id = ? AND pc.club_id = (SELECT club_id FROM teams WHERE id = ?)
             AND pc.status = 'ACTIVE' AND pc.start_date <= ? AND (pc.end_date IS NULL OR pc.end_date >= ?)`,
        )
        .get(promise.targetCriteria, teamId, save.worldDate, save.worldDate);
      evaluable = true;
      fulfilled = Boolean(stillHere);
    } else {
      // Unsupported prose or unmodeled targets are never silently fulfilled.
      evaluable = false;
    }
    const next: ManagerPromise = {
      ...promise,
      status: evaluable ? (fulfilled ? "FULFILLED" : "BROKEN") : "EXPIRED",
      resolvedOn: save.worldDate,
    };
    repo.upsertPromise(next);
    const eventId = createStableEntityId(
      "historical-event",
      `commitment:${promise.id}:${next.status}`,
    );
    if (!db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(eventId)) {
      new EventRepository(db).insertHistoricalEvent({
        id: eventId,
        occurredOn: save.worldDate,
        eventType: next.status === "FULFILLED" ? "PROMISE_KEPT" : "PROMISE_BROKEN",
        involvedEntities: [
          { id: promise.personId, type: "person" },
          { id: teamId, type: "team" },
        ],
        title:
          next.status === "FULFILLED"
            ? "Manager commitment fulfilled"
            : "Manager commitment missed",
        importance: promise.importance && promise.importance >= 8 ? "high" : "medium",
        scope: "club",
      });
    }
    terminal.push(next);
  }
  return terminal;
};
