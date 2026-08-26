import {
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  createEntityId,
  type ClubSatisfactionLevel,
  type EntityId,
  type ManagerPlayerRelationship,
  type ManagerPlayerRelationshipLevel,
  type PlayerAttributeSet,
  type PlayerConcern,
  type PlayerConcernType,
  type PlayerContractRecord,
  type SaveMetadata,
  type SquadHierarchyEntry,
  type SquadHierarchyRole,
} from "@nepal-football-sim/shared-types";

type SqlRow = Record<string, any>;

const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

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

  const outcome: SquadDynamicsOutcome = { raisedConcerns: [], escalatedConcerns: [], resolvedConcerns: [] };

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
      const shouldEscalate = existing.status !== "ESCALATED" && unresolvedDays >= CONCERN_ESCALATION_DAYS;
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

    if (relationshipDelta !== 0) {
      adjustRelationship(db, managerProfileId, personId, relationshipDelta, worldDate);
    }

    const activeConcerns = dynamics
      .concernsForPerson(personId, teamId)
      .filter((concern) => concern.status !== "RESOLVED");
    applyMoraleImpact(db, personId, teamId, activeConcerns, worldDate);
    satisfactionFor(db, personId, teamId, activeConcerns, worldDate);
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
  eventType: "CONCERN_RAISED" | "CONCERN_ESCALATED" | "CONCERN_RESOLVED",
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
