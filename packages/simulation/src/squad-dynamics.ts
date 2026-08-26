import {
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  type CaptainInfluence,
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
  type SquadDispute,
  type SquadGroupMembership,
  type SquadGroupType,
  type SquadHierarchyEntry,
  type SquadHierarchyRole,
  type SquadMeeting,
  type SquadMeetingOutcome,
  type SquadMeetingType,
  type TeamCohesion,
  type TeamCohesionLevel,
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
// Dressing-room groups — derived from hierarchy, not a separate social graph
// ---------------------------------------------------------------------------

const GROUP_FOR_ROLE: Record<SquadHierarchyRole, SquadGroupType> = {
  CAPTAIN: "CORE_LEADERS",
  VICE_CAPTAIN: "CORE_LEADERS",
  SENIOR_PLAYER: "CORE_LEADERS",
  SQUAD_PLAYER: "MAIN_GROUP",
  FRINGE_PLAYER: "PERIPHERAL",
};

/** Core leaders / main group / peripheral, straight from real hierarchy standing. */
export const computeSquadGroups = (
  db: GameDatabase,
  teamId: EntityId,
  hierarchy: SquadHierarchyEntry[],
  worldDate: string,
): SquadGroupMembership[] => {
  const dynamics = new SquadDynamicsRepository(db);
  return hierarchy.map((entry) => {
    const membership: SquadGroupMembership = {
      id: createEntityId(),
      teamId,
      personId: entry.personId,
      groupType: GROUP_FOR_ROLE[entry.role],
      updatedOn: worldDate,
    };
    dynamics.upsertGroupMembership(membership);
    return membership;
  });
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
  const groups = computeSquadGroups(db, teamId, hierarchy, worldDate);
  const groupByPerson = new Map(groups.map((entry) => [entry.personId, entry.groupType]));

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

  evaluateTeamCohesion(db, save, teamId, managerProfileId, hierarchy, groupByPerson, outcome);

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
    // Ceiling of 5 (not 0) leaves room for a stabilizing captain to lift
    // spirits slightly above the "no concerns" baseline.
    moraleModifier: clamp(-penalty * 2, -30, 5),
    formModifier: existing?.formModifier ?? 0,
    availability: existing?.availability ?? "AVAILABLE",
    updatedOn: worldDate,
  });
};

// ---------------------------------------------------------------------------
// Team cohesion — dressing-room atmosphere, captain influence, spillover
// ---------------------------------------------------------------------------

const GROUP_INFLUENCE_WEIGHT: Record<SquadGroupType, number> = {
  CORE_LEADERS: 3,
  MAIN_GROUP: 1.5,
  PERIPHERAL: 1,
};

const cohesionLevelFor = (score: number): TeamCohesionLevel => {
  if (score >= 80) return "UNITED";
  if (score >= 60) return "STABLE";
  if (score >= 40) return "SHAKY";
  if (score >= 20) return "POOR";
  return "CRITICAL";
};

/** Adds `delta` to every roster player's morale except those excluded, clamped as usual. */
const nudgeSquadMorale = (
  db: GameDatabase,
  teamId: EntityId,
  delta: number,
  worldDate: string,
  excludePersonIds: EntityId[],
): void => {
  const players = new PlayerRepository(db);
  for (const state of players.availabilityStates(teamId)) {
    if (excludePersonIds.includes(state.personId)) continue;
    players.upsertAvailabilityState({
      personId: state.personId,
      teamId,
      fitness: state.fitness,
      moraleModifier: clamp(state.moraleModifier + delta, -30, 5),
      formModifier: state.formModifier,
      availability: state.availability,
      updatedOn: worldDate,
    });
  }
};

const CONCERN_TYPE_LABEL: Record<PlayerConcernType, string> = {
  PLAYING_TIME: "playing time",
  CONTRACT: "their contracts",
  ROLE_STATUS: "squad status",
  TRANSFER_INTEREST: "transfer speculation",
};

/**
 * The dressing-room read: weighted satisfaction (influential players count
 * more than peripheral ones), captain influence from their *real* relationship
 * and concern state, spillover from core leaders' concerns/broken promises
 * onto the rest of the squad, and dispute detection from concerns that are
 * genuinely shared or already adversarial. Every input already exists in
 * Phase A/B state — nothing here is randomly generated.
 */
const evaluateTeamCohesion = (
  db: GameDatabase,
  save: SaveMetadata,
  teamId: EntityId,
  managerProfileId: EntityId,
  hierarchy: SquadHierarchyEntry[],
  groupByPerson: Map<EntityId, SquadGroupType>,
  outcome: SquadDynamicsOutcome,
): TeamCohesion => {
  const worldDate = save.worldDate;
  const dynamics = new SquadDynamicsRepository(db);

  const satisfaction = dynamics.satisfactionForTeam(teamId);
  let weightedTotal = 0;
  let weightSum = 0;
  for (const entry of satisfaction) {
    const weight = GROUP_INFLUENCE_WEIGHT[groupByPerson.get(entry.personId) ?? "MAIN_GROUP"];
    weightedTotal += entry.score * weight;
    weightSum += weight;
  }
  let score = weightSum > 0 ? weightedTotal / weightSum : 70;

  const captainEntry = hierarchy.find((entry) => entry.role === "CAPTAIN");
  let captainInfluence: CaptainInfluence = "NEUTRAL";
  if (captainEntry) {
    const captainRelationship = dynamics.relationship(managerProfileId, captainEntry.personId)?.score ?? 0;
    const captainConcerns = dynamics
      .concernsForPerson(captainEntry.personId, teamId)
      .filter((concern) => concern.status !== "RESOLVED");
    if (captainConcerns.some((concern) => concern.status === "ESCALATED") || captainRelationship <= -15) {
      captainInfluence = "DESTABILIZING";
      score -= 10;
      nudgeSquadMorale(db, teamId, -6, worldDate, [captainEntry.personId]);
    } else if (captainRelationship >= 15 && captainConcerns.length === 0) {
      captainInfluence = "STABILIZING";
      score += 8;
      nudgeSquadMorale(db, teamId, 4, worldDate, [captainEntry.personId]);
    }
  }

  // Spillover: a core leader's concern escalating or promise breaking this
  // tick unsettles the rest of the squad, weighted by how many sources fired.
  const unsettlingSources = new Set(
    [
      ...outcome.escalatedConcerns.filter((concern) => groupByPerson.get(concern.personId) === "CORE_LEADERS"),
      ...outcome.brokenPromises.filter((promise) => groupByPerson.get(promise.personId) === "CORE_LEADERS"),
    ].map((entry) => entry.personId),
  );
  if (unsettlingSources.size > 0) {
    const penalty = clamp(unsettlingSources.size * 3, 3, 12);
    nudgeSquadMorale(db, teamId, -penalty, worldDate, [...unsettlingSources]);
    score -= penalty;
    for (const personId of unsettlingSources) {
      dynamics.insertHistoryEvent({
        id: createEntityId(),
        personId,
        teamId,
        managerProfileId,
        eventType: "SPILLOVER_APPLIED",
        occurredOn: worldDate,
        data: { affectedTeammates: true },
      });
    }
  }

  // Disputes: real, shared or adversarial state — not manufactured drama.
  let topIssue: string | undefined;
  const escalatedByType = new Map<PlayerConcernType, PlayerConcern[]>();
  for (const concern of outcome.escalatedConcerns) {
    const list = escalatedByType.get(concern.type) ?? [];
    list.push(concern);
    escalatedByType.set(concern.type, list);
  }
  for (const [type, concerns] of escalatedByType) {
    if (concerns.length < 2) continue;
    const [first, second] = concerns;
    if (!dynamics.findDispute(teamId, "PLAYER_VS_PLAYER", first!.personId, second!.personId, type)) {
      const dispute: SquadDispute = {
        id: createEntityId(),
        teamId,
        kind: "PLAYER_VS_PLAYER",
        personId: first!.personId,
        withPersonId: second!.personId,
        concernType: type,
        status: "OPEN",
        raisedOn: worldDate,
      };
      dynamics.insertDispute(dispute);
      dynamics.insertHistoryEvent({
        id: createEntityId(),
        personId: first!.personId,
        teamId,
        managerProfileId,
        eventType: "DISPUTE_FLARED",
        occurredOn: worldDate,
        data: { kind: "PLAYER_VS_PLAYER", withPersonId: second!.personId, type },
      });
    }
    topIssue = `Multiple players are unhappy about ${CONCERN_TYPE_LABEL[type]} at the same time.`;
    score -= 5;
    break;
  }
  if (!topIssue) {
    const managerDispute = outcome.escalatedConcerns.find((concern) => {
      if (groupByPerson.get(concern.personId) !== "CORE_LEADERS") return false;
      return (dynamics.relationship(managerProfileId, concern.personId)?.score ?? 0) <= -50;
    });
    if (managerDispute) {
      if (!dynamics.findDispute(teamId, "PLAYER_VS_MANAGER", managerDispute.personId, undefined, managerDispute.type)) {
        const dispute: SquadDispute = {
          id: createEntityId(),
          teamId,
          kind: "PLAYER_VS_MANAGER",
          personId: managerDispute.personId,
          concernType: managerDispute.type,
          status: "OPEN",
          raisedOn: worldDate,
        };
        dynamics.insertDispute(dispute);
        dynamics.insertHistoryEvent({
          id: createEntityId(),
          personId: managerDispute.personId,
          teamId,
          managerProfileId,
          eventType: "DISPUTE_FLARED",
          occurredOn: worldDate,
          data: { kind: "PLAYER_VS_MANAGER", type: managerDispute.type },
        });
      }
      topIssue = `A senior player is in open dispute with you over ${CONCERN_TYPE_LABEL[managerDispute.type]}.`;
    }
  }
  if (!topIssue) {
    const openDispute = dynamics.openDisputesForTeam(teamId)[0];
    if (openDispute) {
      topIssue =
        openDispute.kind === "PLAYER_VS_MANAGER"
          ? `A senior player is still in open dispute with you over ${CONCERN_TYPE_LABEL[openDispute.concernType]}.`
          : `Two players remain at odds over ${CONCERN_TYPE_LABEL[openDispute.concernType]}.`;
    }
  }

  score = clamp(Math.round(score), 0, 100);
  const cohesion: TeamCohesion = {
    teamId,
    score,
    level: cohesionLevelFor(score),
    captainInfluence,
    topIssue,
    updatedOn: worldDate,
  };
  dynamics.upsertCohesion(cohesion);
  return cohesion;
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
    | "PROMISE_EXPIRED"
    | "MEETING_HELD"
    | "DISPUTE_MEDIATED"
    | "DISPUTE_UNRESOLVED",
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

const MEETING_COOLDOWN_DAYS: Record<SquadMeetingType, number> = {
  ONE_TO_ONE: 14,
  MEDIATE_DISPUTE: 14,
  ADDRESS_MANAGER_DISPUTE: 14,
  CAPTAIN_CONSULTATION: 10,
  SQUAD_MEETING: 21,
};

export class MeetingActionError extends Error {
  constructor(
    readonly code:
      | "ON_COOLDOWN"
      | "DISPUTE_NOT_FOUND"
      | "DISPUTE_NOT_OPEN"
      | "NO_CAPTAIN"
      | "NOTHING_TO_ADDRESS",
    message: string,
  ) {
    super(message);
  }
}

/** Throws when the same kind of meeting was held too recently — no spamming a player or the squad. */
const assertMeetingAllowed = (
  db: GameDatabase,
  teamId: EntityId,
  type: SquadMeetingType,
  personId: EntityId | undefined,
  worldDate: string,
): void => {
  const recent = new SquadDynamicsRepository(db).lastMeeting(teamId, type, personId);
  if (!recent) return;
  const daysSince = daysBetween(recent.occurredOn, worldDate);
  const cooldown = MEETING_COOLDOWN_DAYS[type];
  if (daysSince < cooldown) {
    throw new MeetingActionError(
      "ON_COOLDOWN",
      `Wait ${cooldown - daysSince} more day(s) before doing that again.`,
    );
  }
};

const recordMeeting = (
  db: GameDatabase,
  teamId: EntityId,
  managerProfileId: EntityId,
  type: SquadMeetingType,
  outcome: SquadMeetingOutcome,
  summary: string,
  worldDate: string,
  extra: { personId?: EntityId; withPersonId?: EntityId; concernId?: EntityId; disputeId?: EntityId } = {},
): SquadMeeting => {
  const meeting: SquadMeeting = {
    id: createEntityId(),
    teamId,
    managerProfileId,
    type,
    outcome,
    summary,
    occurredOn: worldDate,
    ...extra,
  };
  new SquadDynamicsRepository(db).insertMeeting(meeting);
  // Team-wide meetings (no single subject player) aren't attached to any
  // one person's history — the squad_meetings row already records them.
  if (extra.personId) {
    logEvent(db, extra.personId, teamId, managerProfileId, "MEETING_HELD", worldDate, { type, outcome });
  }
  return meeting;
};

export const holdSquadMeeting = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  teamId: EntityId,
  command: { type: SquadMeetingType; personId?: EntityId; disputeId?: EntityId },
): SquadMeeting => {
  const dynamics = new SquadDynamicsRepository(db);
  let personId = command.personId;
  let dispute = command.disputeId ? dynamics.disputeById(command.disputeId) : undefined;
  if (command.type === "MEDIATE_DISPUTE") {
    if (!dispute) throw new MeetingActionError("DISPUTE_NOT_FOUND", "That dispute no longer exists.");
    if (dispute.teamId !== teamId) throw new MeetingActionError("DISPUTE_NOT_FOUND", "That dispute is outside your squad.");
    if (dispute.status !== "OPEN") throw new MeetingActionError("DISPUTE_NOT_OPEN", "That dispute is already closed.");
    personId = dispute.personId;
  } else if (command.type === "ADDRESS_MANAGER_DISPUTE") {
    if (!personId) throw new MeetingActionError("NOTHING_TO_ADDRESS", "Select a player to meet.");
    dispute = dynamics.openDisputesForTeam(teamId).find((entry) => entry.kind === "PLAYER_VS_MANAGER" && entry.personId === personId);
    if (!dispute) throw new MeetingActionError("NOTHING_TO_ADDRESS", "That player has no open dispute with you.");
  } else if (command.type === "CAPTAIN_CONSULTATION") {
    personId = dynamics.hierarchyForTeam(teamId).find((entry) => entry.role === "CAPTAIN")?.personId;
    if (!personId) throw new MeetingActionError("NO_CAPTAIN", "This squad has no captain to consult.");
  } else if (command.type === "ONE_TO_ONE" && !personId) {
    throw new MeetingActionError("NOTHING_TO_ADDRESS", "Select a player to meet.");
  } else if (command.type === "SQUAD_MEETING") {
    const cohesionRecord = dynamics.cohesion(teamId);
    const meaningful =
      cohesionRecord && (["SHAKY", "POOR", "CRITICAL"].includes(cohesionRecord.level) || cohesionRecord.topIssue);
    if (!meaningful) {
      throw new MeetingActionError(
        "NOTHING_TO_ADDRESS",
        "The dressing room is calm — there's nothing for a squad meeting to address right now.",
      );
    }
  }
  assertMeetingAllowed(db, teamId, command.type, personId, save.worldDate);
  const cohesion = dynamics.cohesion(teamId)?.score ?? 70;
  const hierarchy = dynamics.hierarchyForTeam(teamId);
  const influenceOf = (id: EntityId | undefined) =>
    hierarchy.find((entry) => entry.personId === id)?.influence ?? 30;
  const relationshipOf = (id: EntityId | undefined) =>
    id ? dynamics.relationship(managerProfileId, id)?.score ?? 0 : 0;

  const relationship = relationshipOf(personId);
  const avgRelationship = dispute?.withPersonId
    ? (relationship + relationshipOf(dispute.withPersonId)) / 2
    : relationship;
  const involvedInfluence = dispute?.withPersonId
    ? (influenceOf(personId) + influenceOf(dispute.withPersonId)) / 2
    : influenceOf(personId);
  // More influential players carry more dressing-room weight: their trust is
  // harder to win back, so high influence drags the odds down a little.
  const influenceDrag = (involvedInfluence - 50) / 4;
  // A seeded roll keeps this state-driven but never a guaranteed success.
  const rng = new SeededRandom(
    `squad-meeting:${command.type}:${personId ?? "team"}:${dispute?.id ?? "-"}:${save.worldDate}`,
  );
  const roll = (rng.next() - 0.5) * 20;
  const score = cohesion + avgRelationship - influenceDrag + roll;
  const outcome: SquadMeetingOutcome = score >= 70 ? "POSITIVE" : score >= 40 ? "NEUTRAL" : "NEGATIVE";
  const summary = outcome === "POSITIVE" ? "The meeting brought clarity and steadied the dressing room." : outcome === "NEUTRAL" ? "The meeting was constructive, but tensions remain." : "The meeting failed to settle the underlying tension.";
  const meeting = recordMeeting(db, teamId, managerProfileId, command.type, outcome, summary, save.worldDate, {
    personId, withPersonId: dispute?.withPersonId, disputeId: dispute?.id,
    concernId: personId ? dynamics.concernsForPerson(personId, teamId).find((entry) => entry.status !== "RESOLVED")?.id : undefined,
  });
  if (dispute) {
    const disputeStatus = outcome === "POSITIVE" ? "MEDIATED" : "UNRESOLVED";
    dynamics.updateDisputeStatus(dispute.id, disputeStatus, save.worldDate);
    logEvent(db, dispute.personId, teamId, managerProfileId, disputeStatus === "MEDIATED" ? "DISPUTE_MEDIATED" : "DISPUTE_UNRESOLVED", save.worldDate, { disputeId: dispute.id, meetingId: meeting.id });
    // Easing or deepening whatever the dispute was actually about.
    for (const involvedId of dispute.withPersonId ? [dispute.personId, dispute.withPersonId] : [dispute.personId]) {
      const concern = dynamics.concern(involvedId, teamId, dispute.concernType);
      if (concern && concern.status !== "RESOLVED") {
        dynamics.upsertConcern({
          ...concern,
          severity: clamp(concern.severity + (outcome === "POSITIVE" ? -3 : 1), 1, 10),
          status: outcome === "POSITIVE" && concern.status === "ESCALATED" ? "ACTIVE" : concern.status,
          updatedOn: save.worldDate,
        });
      }
    }
    if (dispute.withPersonId) {
      // Mediation changes both relationships, not just the primary subject's.
      adjustRelationship(
        db,
        managerProfileId,
        dispute.withPersonId,
        outcome === "POSITIVE" ? 6 : outcome === "NEUTRAL" ? 1 : -4,
        save.worldDate,
      );
    }
  }
  if (personId) {
    adjustRelationship(
      db,
      managerProfileId,
      personId,
      outcome === "POSITIVE" ? 6 : outcome === "NEUTRAL" ? 1 : -4,
      save.worldDate,
    );
  }
  if (command.type === "SQUAD_MEETING") {
    const severityDelta = outcome === "POSITIVE" ? -1 : outcome === "NEGATIVE" ? 1 : 0;
    if (severityDelta !== 0) {
      for (const concern of dynamics.concernsForTeam(teamId).filter((entry) => entry.status !== "RESOLVED")) {
        dynamics.upsertConcern({
          ...concern,
          severity: clamp(concern.severity + severityDelta, 1, 10),
          updatedOn: save.worldDate,
        });
      }
    }
    const moraleDelta = outcome === "POSITIVE" ? 3 : outcome === "NEGATIVE" ? -3 : 0;
    if (moraleDelta !== 0) nudgeSquadMorale(db, teamId, moraleDelta, save.worldDate, []);
  }
  return meeting;
};

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
  assertMeetingAllowed(db, concern.teamId, "ONE_TO_ONE", concern.personId, save.worldDate);

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
