import {
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  type ClubSatisfactionLevel,
  type ConcernResponseAction,
  type ConcernResponseOutcome,
  type EntityId,
  type ManagerConcernResponse,
  type ManagerPlayerRelationship,
  type ManagerPlayerRelationshipLevel,
  type ManagerPromise,
  type ManagerPromiseType,
  type PlayerAttributeSet,
  type PlayerConcern,
  type PlayerConcernType,
  type PlayerContractRecord,
  type PlayerSquadRole,
  type SaveMetadata,
  type SquadHierarchyEntry,
  type SquadHierarchyRole,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

type SqlRow = Record<string, any>;

const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

// ---------------------------------------------------------------------------
// Squad hierarchy — influence and leadership standing
// ---------------------------------------------------------------------------

const influenceScore = (attributes: PlayerAttributeSet): number => {
  const { leadership, professionalism, determination } = attributes.mental;
  // Attributes run 1-20; scale the leadership-led blend onto a 0-100 influence band.
  return clamp(Math.round(((leadership * 2 + professionalism + determination) / 4) * 5), 0, 100);
};

const hierarchyRoleFor = (rank: number, squadSize: number): SquadHierarchyRole => {
  if (rank === 0) return "CAPTAIN";
  if (rank === 1) return "VICE_CAPTAIN";
  if (rank < Math.ceil(squadSize * 0.3)) return "SENIOR_PLAYER";
  if (rank < Math.ceil(squadSize * 0.75)) return "SQUAD_PLAYER";
  return "FRINGE_PLAYER";
};

/** Recomputes captain/vice-captain/influence for a squad from real attributes. Idempotent. */
export const computeSquadHierarchy = (
  db: GameDatabase,
  teamId: EntityId,
  worldDate: string,
): SquadHierarchyEntry[] => {
  const players = new PlayerRepository(db).attributesForTeam(teamId);
  const ranked = players
    .map((player) => ({ personId: player.personId, influence: influenceScore(player) }))
    .sort((a, b) => b.influence - a.influence);

  const dynamics = new SquadDynamicsRepository(db);
  const entries = ranked.map((player, rank) => {
    const entry: SquadHierarchyEntry = {
      id: createEntityId(),
      teamId,
      personId: player.personId,
      influence: player.influence,
      role: hierarchyRoleFor(rank, ranked.length),
      updatedOn: worldDate,
    };
    dynamics.upsertHierarchyEntry(entry);
    return entry;
  });
  return entries;
};

// ---------------------------------------------------------------------------
// Manager <-> player relationship
// ---------------------------------------------------------------------------

const relationshipLevelFor = (score: number): ManagerPlayerRelationshipLevel => {
  if (score <= -50) return "POOR";
  if (score <= -15) return "COOL";
  if (score < 15) return "NEUTRAL";
  if (score < 50) return "GOOD";
  return "STRONG";
};

const adjustRelationship = (
  db: GameDatabase,
  managerProfileId: EntityId,
  personId: EntityId,
  delta: number,
  worldDate: string,
): ManagerPlayerRelationship => {
  const dynamics = new SquadDynamicsRepository(db);
  const existing = dynamics.relationship(managerProfileId, personId);
  const score = clamp((existing?.score ?? 0) + delta, -100, 100);
  const relationship: ManagerPlayerRelationship = {
    id: existing?.id ?? createEntityId(),
    managerProfileId,
    personId,
    score,
    level: relationshipLevelFor(score),
    updatedOn: worldDate,
  };
  dynamics.upsertRelationship(relationship);
  return relationship;
};

// ---------------------------------------------------------------------------
// Player <-> club satisfaction
// ---------------------------------------------------------------------------

const satisfactionLevelFor = (score: number): ClubSatisfactionLevel => {
  if (score < 20) return "VERY_UNHAPPY";
  if (score < 40) return "UNHAPPY";
  if (score < 65) return "CONTENT";
  if (score < 85) return "HAPPY";
  return "VERY_HAPPY";
};

const satisfactionFor = (
  db: GameDatabase,
  personId: EntityId,
  teamId: EntityId,
  activeConcerns: PlayerConcern[],
  worldDate: string,
): void => {
  const penalty = activeConcerns.reduce(
    (total, concern) => total + concern.severity * (concern.status === "ESCALATED" ? 2 : 1),
    0,
  );
  const score = clamp(70 - penalty * 4, 0, 100);
  new SquadDynamicsRepository(db).upsertSatisfaction({
    id: createEntityId(),
    personId,
    teamId,
    score,
    level: satisfactionLevelFor(score),
    updatedOn: worldDate,
  });
};

// ---------------------------------------------------------------------------
// Concern detection — driven by real contract/appearance/transfer state
// ---------------------------------------------------------------------------

const CONCERN_ESCALATION_DAYS = 30;

const PLAYING_TIME_WEIGHT: Partial<Record<PlayerContractRecord["squadRole"], number>> = {
  KEY_PLAYER: 3,
  IMPORTANT_PLAYER: 2,
  FIRST_TEAM: 1,
};

type ConcernSignal = { type: PlayerConcernType; active: boolean; severity: number; note: string };

const detectSignals = (input: {
  contract?: PlayerContractRecord;
  hierarchyRole?: SquadHierarchyRole;
  appearances: number;
  teamGamesPlayed: number;
  transferInterested: boolean;
  worldDate: string;
}): ConcernSignal[] => {
  const signals: ConcernSignal[] = [];
  const { contract, hierarchyRole, appearances, teamGamesPlayed, transferInterested, worldDate } = input;

  if (contract && teamGamesPlayed >= 5) {
    const weight = PLAYING_TIME_WEIGHT[contract.squadRole] ?? 0;
    const ratio = appearances / teamGamesPlayed;
    signals.push({
      type: "PLAYING_TIME",
      active: weight > 0 && ratio < 0.4,
      severity: weight > 0 ? clamp(Math.round(weight * (1 - ratio) * 3), 1, 10) : 0,
      note: `${contract.squadRole} appearances ${appearances}/${teamGamesPlayed}`,
    });
  }

  if (contract) {
    const daysLeft = daysBetween(worldDate, contract.endDate);
    const highValue = ["KEY_PLAYER", "IMPORTANT_PLAYER", "FIRST_TEAM"].includes(contract.squadRole);
    signals.push({
      type: "CONTRACT",
      active: highValue && daysLeft <= 180,
      severity: clamp(Math.round((180 - daysLeft) / 30), 1, 10),
      note: `${daysLeft} days remaining on contract`,
    });
  }

  if (contract && hierarchyRole) {
    const senior = ["CAPTAIN", "VICE_CAPTAIN", "SENIOR_PLAYER"].includes(hierarchyRole);
    const demoted = ["BACKUP", "PROSPECT", "YOUTH"].includes(contract.squadRole);
    signals.push({
      type: "ROLE_STATUS",
      active: senior && demoted,
      severity: senior && demoted ? 6 : 0,
      note: `${hierarchyRole} squad standing but registered as ${contract.squadRole}`,
    });
  }

  signals.push({
    type: "TRANSFER_INTEREST",
    active: transferInterested,
    severity: transferInterested ? 5 : 0,
    note: "External transfer interest on record",
  });

  return signals;
};

export type SquadDynamicsOutcome = {
  raisedConcerns: PlayerConcern[];
  escalatedConcerns: PlayerConcern[];
  resolvedConcerns: PlayerConcern[];
  keptPromises: ManagerPromise[];
  brokenPromises: ManagerPromise[];
  expiredPromises: ManagerPromise[];
};

/**
 * The squad-dynamics tick: recomputes hierarchy, then walks every squad
 * member's real contract/appearance/transfer state to raise, escalate or
 * resolve concerns, adjust the manager relationship, and update club
 * satisfaction. Morale is not a separate engine — unresolved concerns write
 * straight into the existing `player_availability_states.morale_modifier`.
 *
 * Scoped to one team per call (the manager's own squad): this is what
 * surfaces in that manager's inbox, so there is no value in paying the cost
 * of running it for every AI club too.
 */
export const evaluateSquadDynamics = (
  db: GameDatabase,
  save: SaveMetadata,
  teamId: EntityId,
  clubId: EntityId | undefined,
  managerProfileId: EntityId,
): SquadDynamicsOutcome => {
  const players = new PlayerRepository(db);
  const dynamics = new SquadDynamicsRepository(db);
  const transfers = new TransferMarketRepository(db);
  const worldDate = save.worldDate;

  const hierarchy = computeSquadHierarchy(db, teamId, worldDate);
  const hierarchyByPerson = new Map(hierarchy.map((entry) => [entry.personId, entry.role]));

  const teamGamesPlayed = clubId ? gamesPlayedFor(db, teamId) : 0;
  const seasonStats = seasonStatsFor(db, teamId);
  const offers = transfers.transferOffers();

  const outcome: SquadDynamicsOutcome = {
    raisedConcerns: [],
    escalatedConcerns: [],
    resolvedConcerns: [],
    keptPromises: [],
    brokenPromises: [],
    expiredPromises: [],
  };

  for (const player of players.attributesForTeam(teamId)) {
    const personId = player.personId;
    const contract = clubId ? transfers.activeContract(personId, worldDate) : undefined;
    const transferStatus = transfers.transferStatus(personId);
    const inboundInterest = offers.some(
      (offer) =>
        offer.playerId === personId &&
        offer.sellingClubId === clubId &&
        ["SUBMITTED", "NEGOTIATING", "ACCEPTED"].includes(offer.status),
    );
    const transferInterested = transferStatus?.status === "INTERESTED_IN_MOVE" || inboundInterest;

    const signals = detectSignals({
      contract,
      hierarchyRole: hierarchyByPerson.get(personId),
      appearances: seasonStats.get(personId)?.appearances ?? 0,
      teamGamesPlayed,
      transferInterested,
      worldDate,
    });

    let relationshipDelta = 0;
    for (const signal of signals) {
      const existing = dynamics.concern(personId, teamId, signal.type);
      if (!signal.active) {
        if (existing && existing.status !== "RESOLVED") {
          const resolved: PlayerConcern = {
            ...existing,
            status: "RESOLVED",
            updatedOn: worldDate,
            resolvedOn: worldDate,
          };
          dynamics.upsertConcern(resolved);
          logEvent(db, personId, teamId, managerProfileId, "CONCERN_RESOLVED", worldDate, {
            type: signal.type,
          });
          outcome.resolvedConcerns.push(resolved);
          relationshipDelta += 8;
        }
        continue;
      }

      if (!existing || existing.status === "RESOLVED") {
        const raised: PlayerConcern = {
          id: existing?.id ?? createEntityId(),
          personId,
          teamId,
          type: signal.type,
          status: "RAISED",
          severity: signal.severity,
          raisedOn: worldDate,
          updatedOn: worldDate,
          note: signal.note,
        };
        dynamics.upsertConcern(raised);
        logEvent(db, personId, teamId, managerProfileId, "CONCERN_RAISED", worldDate, {
          type: signal.type,
          severity: signal.severity,
        });
        outcome.raisedConcerns.push(raised);
        relationshipDelta -= 5;
        continue;
      }

      const unresolvedDays = daysBetween(existing.raisedOn, worldDate);
      const shouldEscalate =
        existing.status !== "ESCALATED" &&
        unresolvedDays >= CONCERN_ESCALATION_DAYS &&
        !dynamics.activePromiseForConcern(existing.id);
      const updated: PlayerConcern = {
        ...existing,
        status: shouldEscalate ? "ESCALATED" : existing.status === "RAISED" ? "ACTIVE" : existing.status,
        severity: signal.severity,
        updatedOn: worldDate,
        note: signal.note,
      };
      dynamics.upsertConcern(updated);
      if (shouldEscalate) {
        logEvent(db, personId, teamId, managerProfileId, "CONCERN_ESCALATED", worldDate, {
          type: signal.type,
        });
        outcome.escalatedConcerns.push(updated);
        relationshipDelta -= 10;
      }
    }

    relationshipDelta += resolvePromisesForPlayer(
      db,
      save,
      personId,
      teamId,
      managerProfileId,
      contract,
      seasonStats.get(personId)?.appearances ?? 0,
      outcome,
    );

    if (relationshipDelta !== 0) {
      adjustRelationship(db, managerProfileId, personId, relationshipDelta, worldDate);
    }

    const activeConcerns = dynamics
      .concernsForPerson(personId, teamId)
      .filter((concern) => concern.status !== "RESOLVED");
    applyMoraleImpact(db, personId, teamId, activeConcerns, worldDate);
    satisfactionFor(db, personId, teamId, activeConcerns, worldDate);
  }

  // Promises for players who have since left this squad can never be judged
  // against real state again — close them out rather than leaving them stuck.
  const rosterIds = new Set(players.attributesForTeam(teamId).map((p) => p.personId));
  for (const promise of dynamics.activePromisesForTeam(teamId)) {
    if (rosterIds.has(promise.personId)) continue;
    const expired: ManagerPromise = { ...promise, status: "EXPIRED", resolvedOn: worldDate };
    dynamics.upsertPromise(expired);
    logEvent(db, promise.personId, teamId, managerProfileId, "PROMISE_EXPIRED", worldDate, {
      type: promise.type,
    });
    outcome.expiredPromises.push(expired);
  }

  return outcome;
};

const applyMoraleImpact = (
  db: GameDatabase,
  personId: EntityId,
  teamId: EntityId,
  activeConcerns: PlayerConcern[],
  worldDate: string,
): void => {
  const penalty = activeConcerns.reduce(
    (total, concern) => total + concern.severity * (concern.status === "ESCALATED" ? 2 : 1),
    0,
  );
  const players = new PlayerRepository(db);
  const existing = players.availabilityStates(teamId).find((state) => state.personId === personId);
  players.upsertAvailabilityState({
    personId,
    teamId,
    fitness: existing?.fitness ?? 82,
    moraleModifier: clamp(-penalty * 2, -30, 0),
    formModifier: existing?.formModifier ?? 0,
    availability: existing?.availability ?? "AVAILABLE",
    updatedOn: worldDate,
  });
};

const gamesPlayedFor = (db: GameDatabase, teamId: EntityId): number => {
  const row = db
    .prepare(
      `SELECT ls.played AS played FROM league_standings ls WHERE ls.team_id = ?
      ORDER BY ls.played DESC LIMIT 1`,
    )
    .get(teamId) as SqlRow | undefined;
  return row?.played ?? 0;
};

const seasonStatsFor = (db: GameDatabase, teamId: EntityId): Map<EntityId, { appearances: number }> =>
  new Map(
    (db.prepare("SELECT person_id, appearances FROM player_season_stats WHERE team_id = ?").all(teamId) as SqlRow[]).map(
      (row) => [row.person_id as EntityId, { appearances: row.appearances as number }],
    ),
  );

const logEvent = (
  db: GameDatabase,
  personId: EntityId,
  teamId: EntityId,
  managerProfileId: EntityId,
  eventType:
    | "CONCERN_RAISED"
    | "CONCERN_ESCALATED"
    | "CONCERN_RESOLVED"
    | "CONCERN_RESPONSE"
    | "PROMISE_MADE"
    | "PROMISE_KEPT"
    | "PROMISE_BROKEN"
    | "PROMISE_EXPIRED",
  worldDate: string,
  data: Record<string, unknown>,
): void => {
  new SquadDynamicsRepository(db).insertHistoryEvent({
    id: createEntityId(),
    personId,
    teamId,
    managerProfileId,
    eventType,
    occurredOn: worldDate,
    data,
  });
};

export const activeConcernCount = (db: GameDatabase, teamId: EntityId): number =>
  new SquadDynamicsRepository(db)
    .concernsForTeam(teamId)
    .filter((concern) => concern.status !== "RESOLVED").length;

// ---------------------------------------------------------------------------
// Phase B — manager responses and promises
// ---------------------------------------------------------------------------

export class ConcernActionError extends Error {
  constructor(
    readonly code: "CONCERN_NOT_FOUND" | "CONCERN_ALREADY_RESOLVED" | "INVALID_ACTION",
    message: string,
  ) {
    super(message);
  }
}

const VALID_ACTIONS_FOR_CONCERN: Record<PlayerConcernType, ConcernResponseAction[]> = {
  PLAYING_TIME: ["REASSURE", "PROMISE_PLAYING_TIME", "DISMISS"],
  CONTRACT: ["REASSURE", "PROMISE_CONTRACT_REVIEW", "DISMISS"],
  ROLE_STATUS: ["REASSURE", "PROMISE_SQUAD_ROLE", "DISMISS"],
  TRANSFER_INTEREST: ["REASSURE", "PROMISE_TRANSFER_STANCE", "DISMISS"],
};

export const validActionsForConcern = (type: PlayerConcernType): ConcernResponseAction[] =>
  VALID_ACTIONS_FOR_CONCERN[type];

const PROMISE_TYPE_FOR_ACTION: Partial<Record<ConcernResponseAction, ManagerPromiseType>> = {
  PROMISE_PLAYING_TIME: "PLAYING_TIME",
  PROMISE_CONTRACT_REVIEW: "CONTRACT_REVIEW",
  PROMISE_SQUAD_ROLE: "SQUAD_ROLE",
  PROMISE_TRANSFER_STANCE: "TRANSFER_STANCE",
};

const CONCERN_TYPE_FOR_PROMISE: Record<ManagerPromiseType, PlayerConcernType> = {
  PLAYING_TIME: "PLAYING_TIME",
  CONTRACT_REVIEW: "CONTRACT",
  SQUAD_ROLE: "ROLE_STATUS",
  TRANSFER_STANCE: "TRANSFER_INTEREST",
};

const PROMISE_DURATION_DAYS: Record<ManagerPromiseType, number> = {
  PLAYING_TIME: 30,
  CONTRACT_REVIEW: 45,
  SQUAD_ROLE: 45,
  TRANSFER_STANCE: 60,
};

const ROLE_RANK: Record<PlayerSquadRole, number> = {
  KEY_PLAYER: 6,
  IMPORTANT_PLAYER: 5,
  FIRST_TEAM: 4,
  ROTATION: 3,
  BACKUP: 2,
  PROSPECT: 1,
  YOUTH: 0,
};

const promiseDescription = (type: ManagerPromiseType): string => {
  switch (type) {
    case "PLAYING_TIME":
      return "Promised more regular playing time.";
    case "CONTRACT_REVIEW":
      return "Promised to review their contract.";
    case "SQUAD_ROLE":
      return "Promised to reconsider their squad status.";
    case "TRANSFER_STANCE":
      return "Promised not to sanction a transfer away.";
  }
};

const createPromise = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  concern: PlayerConcern,
  type: ManagerPromiseType,
): ManagerPromise => {
  const worldDate = save.worldDate;
  const contract = new TransferMarketRepository(db).activeContract(concern.personId, worldDate);
  let baselineMetric: number | undefined;
  if (type === "PLAYING_TIME") {
    baselineMetric = seasonStatsFor(db, concern.teamId).get(concern.personId)?.appearances ?? 0;
  } else if (type === "CONTRACT_REVIEW") {
    baselineMetric = contract ? daysBetween("1970-01-01", contract.endDate) : undefined;
  } else if (type === "SQUAD_ROLE") {
    baselineMetric = contract ? ROLE_RANK[contract.squadRole] : undefined;
  }

  const promise: ManagerPromise = {
    id: createEntityId(),
    managerProfileId,
    personId: concern.personId,
    teamId: concern.teamId,
    concernId: concern.id,
    type,
    description: promiseDescription(type),
    madeOn: worldDate,
    dueOn: addDays(worldDate, PROMISE_DURATION_DAYS[type]),
    status: "ACTIVE",
    baselineMetric,
  };
  new SquadDynamicsRepository(db).upsertPromise(promise);
  logEvent(db, concern.personId, concern.teamId, managerProfileId, "PROMISE_MADE", worldDate, { type });
  return promise;
};

/**
 * The manager's response to one active concern. Outcome odds come from the
 * player's relationship with the manager, the concern's own severity, their
 * standing in the squad hierarchy (senior players see through empty
 * reassurance), and professionalism — never a flat coin flip.
 */
export const respondToConcern = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  concernId: EntityId,
  action: ConcernResponseAction,
): ManagerConcernResponse => {
  const dynamics = new SquadDynamicsRepository(db);
  const concern = dynamics.concernById(concernId);
  if (!concern) {
    throw new ConcernActionError("CONCERN_NOT_FOUND", "That concern no longer exists.");
  }
  if (concern.status === "RESOLVED") {
    throw new ConcernActionError(
      "CONCERN_ALREADY_RESOLVED",
      "This concern has already been resolved.",
    );
  }
  if (!VALID_ACTIONS_FOR_CONCERN[concern.type].includes(action)) {
    throw new ConcernActionError(
      "INVALID_ACTION",
      `${action} is not a valid response to a ${concern.type} concern.`,
    );
  }

  const worldDate = save.worldDate;
  const attributes = new PlayerRepository(db)
    .attributesForTeam(concern.teamId)
    .find((player) => player.personId === concern.personId);
  const hierarchyRole = dynamics
    .hierarchyForTeam(concern.teamId)
    .find((entry) => entry.personId === concern.personId)?.role;
  const relationshipScore = dynamics.relationship(managerProfileId, concern.personId)?.score ?? 0;
  const professionalism = attributes?.mental.professionalism ?? 10;

  let successChance = clamp(
    0.5 + relationshipScore / 200 - concern.severity / 30 + (professionalism - 10) / 100,
    0.1,
    0.9,
  );
  if (action === "REASSURE" && hierarchyRole && ["CAPTAIN", "VICE_CAPTAIN", "SENIOR_PLAYER"].includes(hierarchyRole)) {
    // Senior players want concrete commitments, not just words.
    successChance -= 0.15;
  }

  const rng = new SeededRandom(`concern-response:${concernId}:${action}:${worldDate}`);
  const roll = rng.next();

  let outcome: ConcernResponseOutcome;
  let promise: ManagerPromise | undefined;
  let relationshipDelta = 0;
  let concernUpdate: PlayerConcern | undefined;

  if (action === "DISMISS") {
    outcome = "REJECTED";
    relationshipDelta = -8;
    concernUpdate = { ...concern, status: "ESCALATED", updatedOn: worldDate };
  } else if (action === "REASSURE") {
    outcome = roll < successChance ? "ACCEPTED" : "REJECTED";
    relationshipDelta = outcome === "ACCEPTED" ? 4 : -3;
    if (outcome === "ACCEPTED") {
      concernUpdate = {
        ...concern,
        status: concern.status === "RAISED" ? "ACTIVE" : concern.status,
        severity: clamp(concern.severity - 2, 1, 10),
        updatedOn: worldDate,
      };
    }
  } else {
    if (roll < successChance) {
      outcome = "ACCEPTED";
      relationshipDelta = 3;
    } else if (roll < successChance + 0.25) {
      outcome = "SKEPTICAL";
      relationshipDelta = 1;
    } else {
      outcome = "REJECTED";
      relationshipDelta = -5;
    }
    if (outcome !== "REJECTED") {
      promise = createPromise(db, save, managerProfileId, concern, PROMISE_TYPE_FOR_ACTION[action]!);
      concernUpdate = { ...concern, status: "ACTIVE", updatedOn: worldDate };
    }
  }

  if (concernUpdate) dynamics.upsertConcern(concernUpdate);
  if (relationshipDelta !== 0) {
    adjustRelationship(db, managerProfileId, concern.personId, relationshipDelta, worldDate);
  }

  const response: ManagerConcernResponse = {
    id: createEntityId(),
    concernId,
    managerProfileId,
    personId: concern.personId,
    teamId: concern.teamId,
    action,
    outcome,
    promiseId: promise?.id,
    occurredOn: worldDate,
  };
  dynamics.insertConcernResponse(response);
  logEvent(db, concern.personId, concern.teamId, managerProfileId, "CONCERN_RESPONSE", worldDate, {
    action,
    outcome,
  });
  return response;
};

/**
 * Judges every active promise for one player against real state once its
 * deadline passes. Kept promises resolve their originating concern; broken
 * ones escalate it (or reopen/create it) — never a fake auto-success.
 */
const resolvePromisesForPlayer = (
  db: GameDatabase,
  save: SaveMetadata,
  personId: EntityId,
  teamId: EntityId,
  managerProfileId: EntityId,
  contract: PlayerContractRecord | undefined,
  currentAppearances: number,
  outcome: SquadDynamicsOutcome,
): number => {
  const worldDate = save.worldDate;
  const dynamics = new SquadDynamicsRepository(db);
  let relationshipDelta = 0;

  for (const promise of dynamics
    .promisesForPerson(personId, teamId)
    .filter((entry) => entry.status === "ACTIVE")) {
    if (worldDate < promise.dueOn) continue;

    let evaluable = true;
    let kept = false;
    if (promise.type === "PLAYING_TIME") {
      evaluable = promise.baselineMetric !== undefined;
      kept = evaluable && currentAppearances - (promise.baselineMetric ?? 0) >= 2;
    } else if (promise.type === "CONTRACT_REVIEW") {
      evaluable = contract !== undefined && promise.baselineMetric !== undefined;
      kept = evaluable && daysBetween("1970-01-01", contract!.endDate) > (promise.baselineMetric ?? 0);
    } else if (promise.type === "SQUAD_ROLE") {
      evaluable = contract !== undefined && promise.baselineMetric !== undefined;
      kept = evaluable && ROLE_RANK[contract!.squadRole] > (promise.baselineMetric ?? 0);
    } else {
      kept = new TransferMarketRepository(db).transferStatus(personId)?.status !== "TRANSFER_LISTED";
    }

    if (!evaluable) {
      const expired: ManagerPromise = { ...promise, status: "EXPIRED", resolvedOn: worldDate };
      dynamics.upsertPromise(expired);
      logEvent(db, personId, teamId, managerProfileId, "PROMISE_EXPIRED", worldDate, {
        type: promise.type,
      });
      outcome.expiredPromises.push(expired);
      continue;
    }

    const resolved: ManagerPromise = { ...promise, status: kept ? "KEPT" : "BROKEN", resolvedOn: worldDate };
    dynamics.upsertPromise(resolved);
    logEvent(db, personId, teamId, managerProfileId, kept ? "PROMISE_KEPT" : "PROMISE_BROKEN", worldDate, {
      type: promise.type,
    });

    if (kept) {
      relationshipDelta += 12;
      outcome.keptPromises.push(resolved);
      const concern = promise.concernId ? dynamics.concernById(promise.concernId) : undefined;
      if (concern && concern.status !== "RESOLVED") {
        dynamics.upsertConcern({ ...concern, status: "RESOLVED", updatedOn: worldDate, resolvedOn: worldDate });
        outcome.resolvedConcerns.push({ ...concern, status: "RESOLVED", updatedOn: worldDate, resolvedOn: worldDate });
      }
      continue;
    }

    relationshipDelta -= 18;
    outcome.brokenPromises.push(resolved);
    const concernType = CONCERN_TYPE_FOR_PROMISE[promise.type];
    const existingConcern =
      (promise.concernId ? dynamics.concernById(promise.concernId) : undefined) ??
      dynamics.concern(personId, teamId, concernType);
    if (existingConcern && existingConcern.status !== "RESOLVED") {
      const escalated: PlayerConcern = {
        ...existingConcern,
        status: "ESCALATED",
        severity: clamp(existingConcern.severity + 2, 1, 10),
        updatedOn: worldDate,
      };
      dynamics.upsertConcern(escalated);
      outcome.escalatedConcerns.push(escalated);
    } else {
      const reopened: PlayerConcern = {
        id: existingConcern?.id ?? createEntityId(),
        personId,
        teamId,
        type: concernType,
        status: "RAISED",
        severity: 6,
        raisedOn: worldDate,
        updatedOn: worldDate,
        note: "A broken promise reopened this concern.",
      };
      dynamics.upsertConcern(reopened);
      outcome.raisedConcerns.push(reopened);
    }
  }

  return relationshipDelta;
};
