import {
  EventRepository,
  PlayerRepository,
  SquadDynamicsRepository,
  TransferMarketRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { evaluateMoveAmbition } from "./foreign-move-ambition.js";
import { evaluateTeamMeetingContext } from "./team-meeting-context.js";
import { requestPlayerTransfer } from "./transfer-market.js";
import {
  createEntityId,
  createStableEntityId,
  type CaptainInfluence,
  type ClubSatisfactionLevel,
  type ConcernResponseAction,
  type ConcernResponseOutcome,
  type EntityId,
  type EntityRef,
  type ManagerConcernResponse,
  type ManagerPlayerRelationship,
  type ManagerPlayerRelationshipLevel,
  type ManagerPromise,
  type ManagerPromiseType,
  type PlayerAttributeSet,
  type PlayerConcern,
  type PlayerConcernType,
  type PlayerContractRecord,
  type PlayerDemand,
  type PlayerDemandManagerResponse,
  type PlayerDemandStatus,
  type PlayerDemandType,
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
  type TeamMeetingContext,
  type TeamMeetingMessageId,
} from "@nepal-football-sim/shared-types";
import { SeededRandom } from "./rng.js";

type SqlRow = Record<string, any>;

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

/** Concern notes are free-standing UI-facing prose, not raw enum dumps. */
const band = (value: string): string => value.replaceAll("_", " ").toLowerCase();

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

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

/**
 * Recomputes captain/vice-captain/influence for a squad from real attributes.
 * Idempotent, and honours a manager's explicit captaincy override (see
 * `SquadCaptaincyOverride`) instead of always handing the armband to whoever
 * currently ranks highest by raw influence — the same real football
 * situation as a manager deliberately captaining a trusted senior player
 * over a marginally higher-influence teammate. An override for a player no
 * longer in this squad is simply ignored (falls back to influence rank);
 * it is not cleared here, since that is a save-mutation decision that
 * belongs to whoever changes the squad, not to a read/recompute path.
 */
export const computeSquadHierarchy = (
  db: GameDatabase,
  teamId: EntityId,
  worldDate: string,
): SquadHierarchyEntry[] => {
  const players = new PlayerRepository(db).attributesForTeam(teamId);
  const ranked = players
    .map((player) => ({ personId: player.personId, influence: influenceScore(player) }))
    .sort((a, b) => b.influence - a.influence);
  const rosterIds = new Set(ranked.map((player) => player.personId));

  const dynamics = new SquadDynamicsRepository(db);
  const override = dynamics.captaincyOverride(teamId);
  const overrideCaptainId =
    override?.captainPersonId && rosterIds.has(override.captainPersonId)
      ? override.captainPersonId
      : undefined;
  const overrideViceId =
    override?.viceCaptainPersonId &&
    rosterIds.has(override.viceCaptainPersonId) &&
    override.viceCaptainPersonId !== overrideCaptainId
      ? override.viceCaptainPersonId
      : undefined;

  const roleFor = (personId: EntityId, rankAmongRemaining: number): SquadHierarchyRole => {
    if (personId === overrideCaptainId) return "CAPTAIN";
    if (personId === overrideViceId) return "VICE_CAPTAIN";
    // Ranks 0/1 are reserved for captain/vice-captain in hierarchyRoleFor's
    // thresholds; once either is pinned by override, the remaining players
    // are ranked starting past those reserved slots so the senior/squad/
    // fringe proportions stay based on the real squad size.
    const reserved = (overrideCaptainId ? 1 : 0) + (overrideViceId ? 1 : 0);
    return hierarchyRoleFor(rankAmongRemaining + reserved, ranked.length);
  };

  let remainingRank = 0;
  const entries = ranked.map((player) => {
    const isOverridden = player.personId === overrideCaptainId || player.personId === overrideViceId;
    const role = roleFor(player.personId, isOverridden ? -1 : remainingRank);
    if (!isOverridden) remainingRank += 1;
    const entry: SquadHierarchyEntry = {
      id: createEntityId(),
      teamId,
      personId: player.personId,
      influence: player.influence,
      role,
      updatedOn: worldDate,
    };
    dynamics.upsertHierarchyEntry(entry);
    return entry;
  });
  return entries;
};

export class CaptaincyActionError extends Error {
  constructor(
    readonly code: "NOT_ON_SQUAD" | "SAME_PLAYER",
    message: string,
  ) {
    super(message);
  }
}

/**
 * The manager's explicit captaincy appointment. Both slots are optional so a
 * manager can set a captain without touching the vice-captain (or vice
 * versa); passing `null` for a slot clears that override and returns it to
 * influence-derived selection. Recomputes the hierarchy immediately so the
 * change is visible without waiting for the next evaluation tick.
 */
export const appointCaptaincy = (
  db: GameDatabase,
  worldDate: string,
  managerProfileId: EntityId,
  teamId: EntityId,
  command: {
    captainPersonId?: EntityId | null;
    viceCaptainPersonId?: EntityId | null;
  },
): SquadHierarchyEntry[] => {
  const rosterIds = new Set(
    new PlayerRepository(db).attributesForTeam(teamId).map((player) => player.personId),
  );
  for (const personId of [command.captainPersonId, command.viceCaptainPersonId]) {
    if (personId && !rosterIds.has(personId)) {
      throw new CaptaincyActionError("NOT_ON_SQUAD", "That player is not part of this squad.");
    }
  }

  const dynamics = new SquadDynamicsRepository(db);
  const existing = dynamics.captaincyOverride(teamId);
  const wasCaptainId = existing?.captainPersonId;
  // Merge against existing state before validating: an omitted slot keeps
  // its prior value, so the collision check must run on the FINAL merged
  // pair, not just whichever fields this particular call happened to pass —
  // otherwise appointing only a new captain while an old vice-captain
  // override silently survives could leave the same person in both roles.
  const mergedCaptainId =
    command.captainPersonId === undefined
      ? existing?.captainPersonId
      : (command.captainPersonId ?? undefined);
  const mergedViceCaptainId =
    command.viceCaptainPersonId === undefined
      ? existing?.viceCaptainPersonId
      : (command.viceCaptainPersonId ?? undefined);
  if (mergedCaptainId && mergedViceCaptainId && mergedCaptainId === mergedViceCaptainId) {
    throw new CaptaincyActionError(
      "SAME_PLAYER",
      "Captain and vice-captain must be different players.",
    );
  }
  dynamics.upsertCaptaincyOverride({
    teamId,
    captainPersonId: mergedCaptainId,
    viceCaptainPersonId: mergedViceCaptainId,
    setOn: worldDate,
    setByManagerProfileId: managerProfileId,
  });
  const entries = computeSquadHierarchy(db, teamId, worldDate);
  const newCaptainId = entries.find((entry) => entry.role === "CAPTAIN")?.personId;
  if (newCaptainId !== wasCaptainId) {
    dynamics.insertHistoryEvent({
      id: createEntityId(),
      personId: newCaptainId ?? wasCaptainId ?? teamId,
      teamId,
      managerProfileId,
      eventType: "CAPTAINCY_CHANGE",
      occurredOn: worldDate,
      data: { previousCaptainId: wasCaptainId, newCaptainId },
    });
    if (newCaptainId) {
      const club = db.prepare("SELECT club_id AS clubId FROM teams WHERE id = ?").get(teamId) as
        { clubId?: EntityId } | undefined;
      if (club?.clubId) {
        const historyId = createStableEntityId(
          "historical-event",
          `captaincy-change:${teamId}:${worldDate}:${newCaptainId}`,
        );
        if (!db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(historyId)) {
          new EventRepository(db).insertHistoricalEvent({
            id: historyId,
            occurredOn: worldDate,
            eventType: "CAPTAINCY_CHANGE",
            involvedEntities: [
              { id: newCaptainId, type: "person" },
              ...(club.clubId ? [{ id: club.clubId, type: "club" as const }] : []),
              ...(wasCaptainId ? [{ id: wasCaptainId, type: "person" as const }] : []),
            ],
            title: "New club captain appointed",
            data: { previousCaptainId: wasCaptainId, teamId, managerProfileId },
            importance: "medium",
            scope: "club",
          });
        }
      }
    }
    if (wasCaptainId) {
      reactToCaptaincyLoss(db, worldDate, managerProfileId, teamId, wasCaptainId, entries);
    }
  }
  return entries;
};

/**
 * A bounded human reaction to losing the captaincy — never a story for
 * every appointment, only for the demoted PREVIOUS captain, and only
 * escalating (a demand, wider spillover) when the demotion is severe: a
 * genuinely influential player dropped all the way out of the leadership
 * tier, not merely handed the armband to someone else while staying vice-
 * captain or a senior player.
 */
const reactToCaptaincyLoss = (
  db: GameDatabase,
  worldDate: string,
  managerProfileId: EntityId,
  teamId: EntityId,
  demotedPersonId: EntityId,
  entries: SquadHierarchyEntry[],
): void => {
  const demoted = entries.find((entry) => entry.personId === demotedPersonId);
  if (!demoted) return; // no longer on the squad at all
  const dynamics = new SquadDynamicsRepository(db);
  const hardDemotion = demoted.role === "SQUAD_PLAYER" || demoted.role === "FRINGE_PLAYER";
  const relationshipDelta = hardDemotion ? -10 : -3;
  adjustRelationship(db, managerProfileId, demotedPersonId, relationshipDelta, worldDate);

  if (!hardDemotion || demoted.influence < 60) return;

  logEvent(db, demotedPersonId, teamId, managerProfileId, "CAPTAINCY_REACTION", worldDate, {
    newRole: demoted.role,
    influence: demoted.influence,
  });

  // A genuinely influential player dropped entirely out of leadership can
  // unsettle a few teammates too — the same bounded spillover mechanism
  // already used for an escalated core-leader concern or broken promise.
  nudgeSquadMorale(db, teamId, -4, worldDate, [demotedPersonId]);

  // Very high influence + a hard demotion is a real grievance, not just a
  // mood dip — but this still only ever opens ONE demand (guarded by
  // openDemandFromConcern-style upsert semantics via the CAPTAINCY_CONCERN
  // type's own uniqueness), never a cascade.
  if (demoted.influence >= 75) {
    const existing = dynamics.demand(demotedPersonId, teamId, "CAPTAINCY_CONCERN");
    if (!existing || existing.status !== "OPEN") {
      const demand: PlayerDemand = {
        id: existing?.id ?? createEntityId(),
        personId: demotedPersonId,
        teamId,
        type: "CAPTAINCY_CONCERN",
        status: "OPEN",
        severity: 7,
        openedOn: worldDate,
        updatedOn: worldDate,
        reviewOn: addDays(worldDate, DEMAND_REVIEW_DAYS),
        trigger: "Lost the captaincy despite a strong standing in the squad.",
        requestedOutcome: requestedOutcomeFor("CAPTAINCY_CONCERN"),
      };
      dynamics.upsertDemand(demand);
      logEvent(db, demotedPersonId, teamId, managerProfileId, "DEMAND_OPENED", worldDate, {
        type: "CAPTAINCY_CONCERN",
      });
    }
  }
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

/** Exported alongside logEvent for transfer-market.ts's completion-resolution use. */
export const adjustRelationship = (
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
  const { contract, hierarchyRole, appearances, teamGamesPlayed, transferInterested, worldDate } =
    input;

  if (contract && teamGamesPlayed >= 5) {
    const weight = PLAYING_TIME_WEIGHT[contract.squadRole] ?? 0;
    const ratio = appearances / teamGamesPlayed;
    signals.push({
      type: "PLAYING_TIME",
      active: weight > 0 && ratio < 0.4,
      severity: weight > 0 ? clamp(Math.round(weight * (1 - ratio) * 3), 1, 10) : 0,
      note: `${band(contract.squadRole)} appearances ${appearances}/${teamGamesPlayed}`,
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
      note: `${band(hierarchyRole)} squad standing but registered as ${band(contract.squadRole)}`,
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
  createdPromises: ManagerPromise[];
  keptPromises: ManagerPromise[];
  atRiskPromises: ManagerPromise[];
  brokenPromises: ManagerPromise[];
  expiredPromises: ManagerPromise[];
  openedDemands: PlayerDemand[];
  expiredDemands: PlayerDemand[];
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
    createdPromises: [],
    keptPromises: [],
    atRiskPromises: [],
    brokenPromises: [],
    expiredPromises: [],
    openedDemands: [],
    expiredDemands: [],
  };

  for (const player of players.attributesForTeam(teamId)) {
    const personId = player.personId;
    const contract = clubId ? transfers.activeContract(personId, worldDate) : undefined;
    const transferStatus = transfers.transferStatus(personId);
    // A live, real bid — not a duplicate/unchanged offer, not mere scouting
    // interest. The most recent qualifying offer is what the player is
    // actually evaluating.
    const qualifyingOffer = offers
      .filter(
        (offer) =>
          offer.playerId === personId &&
          offer.sellingClubId === clubId &&
          ["SUBMITTED", "NEGOTIATING", "ACCEPTED"].includes(offer.status),
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    // A trivial bid or a clearly weaker destination never becomes a real
    // concern signal — only a genuinely strong opportunity (as judged by
    // evaluateMoveAmbition's global, destination-aware scoring) does. The
    // manager's own explicit transfer-listing action (INTERESTED_IN_MOVE)
    // is unrelated to ambition — that's a club decision, not the player's.
    const ambition =
      qualifyingOffer && clubId
        ? evaluateMoveAmbition(db, {
            personId,
            currentClubId: clubId,
            destinationClubId: qualifyingOffer.buyingClubId,
            managerProfileId,
            worldDate,
          })
        : undefined;
    const transferInterested =
      transferStatus?.status === "INTERESTED_IN_MOVE" ||
      (ambition !== undefined &&
        (ambition.classification === "STRONG_INTEREST" || ambition.classification === "DEMANDS_MOVE"));

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
        status: shouldEscalate
          ? "ESCALATED"
          : existing.status === "RAISED"
            ? "ACTIVE"
            : existing.status,
        severity: signal.severity,
        updatedOn: worldDate,
        note: signal.note,
      };
      dynamics.upsertConcern(updated);
      if (shouldEscalate) {
        // A TRANSFER_INTEREST escalation is meaningfully about a specific
        // real buying club (and its competition, when this engine tracks
        // one for it) — the story is far more useful with those referenced
        // directly than with just the player's own club.
        let transferInterestEntities: EntityRef[] = [];
        if (signal.type === "TRANSFER_INTEREST" && qualifyingOffer) {
          transferInterestEntities = [{ id: qualifyingOffer.buyingClubId, type: "club" }];
          const context = db
            .prepare("SELECT league_id AS leagueId FROM external_club_context WHERE club_id = ?")
            .get(qualifyingOffer.buyingClubId) as { leagueId?: EntityId } | undefined;
          if (context?.leagueId) transferInterestEntities.push({ id: context.leagueId, type: "competition" });
        }
        logEvent(
          db,
          personId,
          teamId,
          managerProfileId,
          "CONCERN_ESCALATED",
          worldDate,
          {
            type: signal.type,
            concernId: updated.id,
            buyingClubId: signal.type === "TRANSFER_INTEREST" ? qualifyingOffer?.buyingClubId : undefined,
            offerId: signal.type === "TRANSFER_INTEREST" ? qualifyingOffer?.id : undefined,
          },
          transferInterestEntities,
        );
        outcome.escalatedConcerns.push(updated);
        relationshipDelta -= 10;
        const demand = openDemandFromConcern(db, worldDate, managerProfileId, updated);
        if (demand) outcome.openedDemands.push(demand);

        // TRANSFER_INTEREST is the one concern type formalized through the
        // EXISTING transfer-request pipeline (requestPlayerTransfer /
        // player_transfer_requests) rather than the new player_demands
        // table — see foreign-move-ambition.ts's module comment. A real,
        // still-live, ambition-justified offer that has sat unresolved for
        // 30+ days (the same escalation threshold every other concern
        // uses) becomes a genuine transfer request — never duplicated
        // while one is already PENDING for this player.
        if (
          signal.type === "TRANSFER_INTEREST" &&
          qualifyingOffer &&
          ambition &&
          !transfers.transferRequests(personId).some((request) => request.status === "PENDING")
        ) {
          const isForeign = Boolean(
            db
              .prepare("SELECT 1 FROM external_club_context WHERE club_id = ?")
              .get(qualifyingOffer.buyingClubId),
          );
          const satisfactionScore = dynamics
            .satisfactionForTeam(teamId)
            .find((entry) => entry.personId === personId)?.score;
          requestPlayerTransfer(db, {
            playerId: personId,
            worldDate,
            reason: `A ${isForeign ? "foreign" : "domestic"} move the player finds genuinely appealing has gone unresolved.`,
            satisfaction: satisfactionScore,
            foreignInterest: isForeign,
          });
        }
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

  // Bounded, exactly like promises: a demand nobody ever answers must not
  // accumulate forever, and a demand for a player no longer on this squad
  // can never be meaningfully judged again.
  for (const demand of dynamics.demandsForTeam(teamId)) {
    if (demand.status !== "OPEN") continue;
    const overdue = demand.reviewOn !== undefined && worldDate > demand.reviewOn;
    if (rosterIds.has(demand.personId) && !overdue) continue;
    const expired: PlayerDemand = { ...demand, status: "EXPIRED", updatedOn: worldDate, resolvedOn: worldDate };
    dynamics.upsertDemand(expired);
    logEvent(db, demand.personId, teamId, managerProfileId, "DEMAND_EXPIRED", worldDate, {
      type: demand.type,
    });
    outcome.expiredDemands.push(expired);
  }

  evaluateTeamCohesion(db, save, teamId, managerProfileId, hierarchy, groupByPerson, outcome);

  return outcome;
};

/**
 * Gives an AI manager the same narrow promise entry point as a human manager.
 * This is deliberately event-driven: callers invoke it after a relevant AI
 * fixture, and it considers at most one highest-severity concern per event.
 * It never writes a terminal status; the canonical evaluator remains the only
 * authority for fulfilment, breakage, expiry and consequences.
 */
export const manageAiPromisesForTeam = (
  db: GameDatabase,
  save: SaveMetadata,
  teamId: EntityId,
  clubId: EntityId | undefined,
  managerProfileId: EntityId,
): SquadDynamicsOutcome => {
  const outcome = evaluateSquadDynamics(db, save, teamId, clubId, managerProfileId);
  const dynamics = new SquadDynamicsRepository(db);
  const transfers = new TransferMarketRepository(db);
  const concern = dynamics
    .concernsForTeam(teamId)
    .filter(
      (entry) =>
        entry.status !== "RESOLVED" && !dynamics.activePromiseForConcern(entry.id),
    )
    .sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))[0];
  if (!concern) return outcome;

  const contract = transfers.activeContract(concern.personId, save.worldDate);
  let action: ConcernResponseAction | undefined;
  if (concern.type === "PLAYING_TIME") {
    const currentlyUnavailable = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM injuries WHERE person_id = ? AND date_occurred <= ? AND expected_recovery_date > ?",
          )
          .get(concern.personId, save.worldDate, save.worldDate) as SqlRow | undefined
      )?.count ?? 0,
    );
    if (contract && currentlyUnavailable === 0 && contract.squadRole !== "YOUTH") {
      action = "PROMISE_PLAYING_TIME";
    }
  } else if (concern.type === "CONTRACT") {
    const daysLeft = contract ? daysBetween(save.worldDate, contract.endDate) : 0;
    if (contract && daysLeft > 0 && daysLeft <= 180) action = "PROMISE_CONTRACT_REVIEW";
  } else if (concern.type === "TRANSFER_INTEREST") {
    const status = transfers.transferStatus(concern.personId)?.status;
    if (status === "INTERESTED_IN_MOVE") {
      const alreadyOnLoan = transfers
        .activeLoans(save.worldDate)
        .some((loan) => loan.playerId === concern.personId);
      action = alreadyOnLoan ? "PROMISE_TRANSFER_STANCE" : "PROMISE_LOAN_CONSIDERATION";
    }
  } else if (concern.type === "ROLE_STATUS" && contract && clubId) {
    const squadSize = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM player_contracts WHERE club_id=? AND status='ACTIVE' AND start_date<=? AND (end_date IS NULL OR end_date>=?)",
          )
          .get(clubId, save.worldDate, save.worldDate) as SqlRow | undefined
      )?.count ?? 0,
    );
    // A thin squad gives the existing transfer planner a concrete
    // strengthening objective; otherwise answer the player's role concern.
    action = squadSize < 18 ? "PROMISE_SQUAD_STRENGTHENING" : "PROMISE_SQUAD_ROLE";
  }

  if (!action) return outcome;

  const promise = createPromise(
    db,
    save,
    managerProfileId,
    concern,
    PROMISE_TYPE_FOR_ACTION[action]!,
  );
  const response: ManagerConcernResponse = {
    id: createStableEntityId(
      "ai-promise-response",
      `${managerProfileId}:${concern.id}:${save.worldDate}:${action}`,
    ),
    concernId: concern.id,
    managerProfileId,
    personId: concern.personId,
    teamId,
    action,
    outcome: "ACCEPTED",
    promiseId: promise.id,
    occurredOn: save.worldDate,
  };
  dynamics.insertConcernResponse(response);
  logEvent(db, concern.personId, teamId, managerProfileId, "CONCERN_RESPONSE", save.worldDate, {
    action,
    outcome: response.outcome,
    ai: true,
  });
  dynamics.upsertConcern({ ...concern, status: "ACTIVE", updatedOn: save.worldDate });
  outcome.createdPromises.push(promise);
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
    const captainRelationship =
      dynamics.relationship(managerProfileId, captainEntry.personId)?.score ?? 0;
    const captainConcerns = dynamics
      .concernsForPerson(captainEntry.personId, teamId)
      .filter((concern) => concern.status !== "RESOLVED");
    if (
      captainConcerns.some((concern) => concern.status === "ESCALATED") ||
      captainRelationship <= -15
    ) {
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
      ...outcome.escalatedConcerns.filter(
        (concern) => groupByPerson.get(concern.personId) === "CORE_LEADERS",
      ),
      ...outcome.brokenPromises.filter(
        (promise) => groupByPerson.get(promise.personId) === "CORE_LEADERS",
      ),
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
    if (
      !dynamics.findDispute(teamId, "PLAYER_VS_PLAYER", first!.personId, second!.personId, type)
    ) {
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
      if (
        !dynamics.findDispute(
          teamId,
          "PLAYER_VS_MANAGER",
          managerDispute.personId,
          undefined,
          managerDispute.type,
        )
      ) {
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

const seasonStatsFor = (
  db: GameDatabase,
  teamId: EntityId,
): Map<EntityId, { appearances: number }> =>
  new Map(
    (
      db
        .prepare("SELECT person_id, appearances FROM player_season_stats WHERE team_id = ?")
        .all(teamId) as SqlRow[]
    ).map((row) => [row.person_id as EntityId, { appearances: row.appearances as number }]),
  );

/**
 * Exported so transfer-market.ts's completePermanentTransfer can resolve a
 * departing player's squad-dynamics state (their old club's TRANSFER_INTEREST
 * concern/TRANSFER_STANCE promise) through the exact same historical-event
 * vocabulary and Story-routing rules as every other relationship event —
 * never a second, parallel resolution/story path for the same concept.
 */
export const logEvent = (
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
    | "DISPUTE_UNRESOLVED"
    | "CAPTAINCY_REACTION"
    | "DEMAND_OPENED"
    | "DEMAND_ACCEPTED"
    | "DEMAND_REJECTED"
    | "DEMAND_DEFERRED"
    | "DEMAND_RESOLVED"
    | "DEMAND_WITHDRAWN"
    | "DEMAND_EXPIRED",
  worldDate: string,
  data: Record<string, unknown>,
  extraEntities: EntityRef[] = [],
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
  // Story Universe routing is deliberately narrow: a RAISED concern is
  // common and often resolves itself within a tick or two (see
  // CONCERN_ESCALATION_DAYS), so only an ESCALATED concern is material
  // enough to become a world story — same reasoning for demands: opening
  // one (a real formal ask reaching the manager) and an outright rejection
  // are the newsworthy moments; acceptance is already covered by the
  // resulting PROMISE_MADE/PROMISE_KEPT story, and deferral/withdrawal/
  // expiry are administrative, not story material.
  const STORY_ROUTED = new Set([
    "PROMISE_KEPT",
    "PROMISE_BROKEN",
    "CONCERN_ESCALATED",
    "DEMAND_OPENED",
    "DEMAND_REJECTED",
    "CAPTAINCY_REACTION",
  ]);
  if (STORY_ROUTED.has(eventType)) {
    const club = db
      .prepare("SELECT club_id AS clubId FROM teams WHERE id = ? LIMIT 1")
      .get(teamId) as { clubId?: EntityId } | undefined;
    if (club?.clubId) {
      const historyId = createStableEntityId(
        "historical-event",
        `${eventType.toLowerCase()}:${personId}:${teamId}:${worldDate}:${data.type ?? data.promiseId ?? "unknown"}`,
      );
      const title: Record<string, string> = {
        CONCERN_ESCALATED:
          eventType === "CONCERN_ESCALATED" && data.type === "TRANSFER_INTEREST"
            ? "Foreign interest is causing real concern"
            : "Player concern escalates",
        PROMISE_KEPT: "Manager promise fulfilled",
        PROMISE_BROKEN: "Manager promise broken",
        DEMAND_OPENED: "Player makes a formal request",
        DEMAND_REJECTED: "Manager rejects player's request",
        CAPTAINCY_REACTION: "Reaction to captaincy change",
      };
      const importance: Record<string, "medium" | "high"> = {
        CONCERN_ESCALATED: "medium",
        PROMISE_KEPT: "medium",
        PROMISE_BROKEN: "high",
        DEMAND_OPENED: "medium",
        DEMAND_REJECTED: "high",
        CAPTAINCY_REACTION: "medium",
      };
      if (!db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(historyId)) {
        new EventRepository(db).insertHistoricalEvent({
          id: historyId,
          occurredOn: worldDate,
          eventType,
          involvedEntities: [
            { id: personId, type: "person" },
            { id: club.clubId, type: "club" },
            ...extraEntities,
          ],
          title: title[eventType] ?? eventType,
          data: { ...data, teamId, managerProfileId },
          importance: importance[eventType] ?? "medium",
          scope: "club",
        });
      }
    }
  }
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
  extra: {
    personId?: EntityId;
    withPersonId?: EntityId;
    concernId?: EntityId;
    disputeId?: EntityId;
  } = {},
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
    logEvent(db, extra.personId, teamId, managerProfileId, "MEETING_HELD", worldDate, {
      type,
      outcome,
    });
  }
  return meeting;
};

export const holdSquadMeeting = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  teamId: EntityId,
  command: {
    type: SquadMeetingType;
    personId?: EntityId;
    disputeId?: EntityId;
    /** Only meaningful for SQUAD_MEETING — the manager's chosen message for
     * the real, currently-warranted context (see evaluateTeamMeetingContext).
     * Ignored for every other meeting type. */
    messageId?: TeamMeetingMessageId;
  },
): SquadMeeting => {
  const dynamics = new SquadDynamicsRepository(db);
  let personId = command.personId;
  let dispute = command.disputeId ? dynamics.disputeById(command.disputeId) : undefined;
  if (command.type === "MEDIATE_DISPUTE") {
    if (!dispute)
      throw new MeetingActionError("DISPUTE_NOT_FOUND", "That dispute no longer exists.");
    if (dispute.teamId !== teamId)
      throw new MeetingActionError("DISPUTE_NOT_FOUND", "That dispute is outside your squad.");
    if (dispute.status !== "OPEN")
      throw new MeetingActionError("DISPUTE_NOT_OPEN", "That dispute is already closed.");
    personId = dispute.personId;
  } else if (command.type === "ADDRESS_MANAGER_DISPUTE") {
    if (!personId) throw new MeetingActionError("NOTHING_TO_ADDRESS", "Select a player to meet.");
    dispute = dynamics
      .openDisputesForTeam(teamId)
      .find((entry) => entry.kind === "PLAYER_VS_MANAGER" && entry.personId === personId);
    if (!dispute)
      throw new MeetingActionError(
        "NOTHING_TO_ADDRESS",
        "That player has no open dispute with you.",
      );
  } else if (command.type === "CAPTAIN_CONSULTATION") {
    personId = dynamics
      .hierarchyForTeam(teamId)
      .find((entry) => entry.role === "CAPTAIN")?.personId;
    if (!personId)
      throw new MeetingActionError("NO_CAPTAIN", "This squad has no captain to consult.");
  } else if (command.type === "ONE_TO_ONE" && !personId) {
    throw new MeetingActionError("NOTHING_TO_ADDRESS", "Select a player to meet.");
  }
  let teamMeetingContext: TeamMeetingContext | undefined;
  if (command.type === "SQUAD_MEETING") {
    teamMeetingContext = evaluateTeamMeetingContext(db, save.worldDate, teamId);
    if (!teamMeetingContext) {
      throw new MeetingActionError(
        "NOTHING_TO_ADDRESS",
        "Nothing currently calls for a team meeting — no poor run, table pressure, big match, or dressing-room tension right now.",
      );
    }
  }
  assertMeetingAllowed(db, teamId, command.type, personId, save.worldDate);
  const cohesion = dynamics.cohesion(teamId)?.score ?? 70;
  const hierarchy = dynamics.hierarchyForTeam(teamId);
  const influenceOf = (id: EntityId | undefined) =>
    hierarchy.find((entry) => entry.personId === id)?.influence ?? 30;
  const relationshipOf = (id: EntityId | undefined) =>
    id ? (dynamics.relationship(managerProfileId, id)?.score ?? 0) : 0;

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
  // Message-context fit only ever applies to a real, evaluated team-meeting
  // context — a "GOOD" fit nudges the odds up, "POOR" nudges them down, but
  // neither overrides the underlying relationship/cohesion/reputation state
  // this score is already built from.
  const chosenMessage = teamMeetingContext?.messages.find((m) => m.id === command.messageId);
  const fitBonus = chosenMessage ? (chosenMessage.fit === "GOOD" ? 10 : chosenMessage.fit === "POOR" ? -10 : 0) : 0;
  const score = cohesion + avgRelationship - influenceDrag + roll + fitBonus;
  const outcome: SquadMeetingOutcome =
    score >= 70 ? "POSITIVE" : score >= 40 ? "NEUTRAL" : "NEGATIVE";
  const summary = teamMeetingContext
    ? `${chosenMessage ? `"${chosenMessage.label}" — ` : ""}${
        outcome === "POSITIVE"
          ? "The message landed well and the squad responded."
          : outcome === "NEUTRAL"
            ? "The meeting was heard, but the underlying situation remains."
            : "The message didn't land — the situation is unchanged or worse."
      }`
    : outcome === "POSITIVE"
      ? "The meeting brought clarity and steadied the dressing room."
      : outcome === "NEUTRAL"
        ? "The meeting was constructive, but tensions remain."
        : "The meeting failed to settle the underlying tension.";
  const meeting = recordMeeting(
    db,
    teamId,
    managerProfileId,
    command.type,
    outcome,
    summary,
    save.worldDate,
    {
      personId,
      withPersonId: dispute?.withPersonId,
      disputeId: dispute?.id,
      concernId: personId
        ? dynamics.concernsForPerson(personId, teamId).find((entry) => entry.status !== "RESOLVED")
            ?.id
        : undefined,
    },
  );
  if (teamMeetingContext) {
    const club = db.prepare("SELECT club_id AS clubId FROM teams WHERE id = ?").get(teamId) as
      { clubId?: EntityId } | undefined;
    if (club?.clubId) {
      const historyId = createStableEntityId("historical-event", `team-meeting:${meeting.id}`);
      if (!db.prepare("SELECT 1 FROM historical_events WHERE id = ?").get(historyId)) {
        new EventRepository(db).insertHistoricalEvent({
          id: historyId,
          occurredOn: save.worldDate,
          eventType: "TEAM_MEETING_RESULT",
          involvedEntities: [{ id: club.clubId, type: "club" }],
          title: "Team meeting held",
          data: { context: teamMeetingContext.type, messageId: command.messageId, outcome, teamId, managerProfileId },
          importance: outcome === "NEGATIVE" ? "medium" : "low",
          scope: "club",
        });
      }
    }
  }
  if (dispute) {
    const disputeStatus = outcome === "POSITIVE" ? "MEDIATED" : "UNRESOLVED";
    dynamics.updateDisputeStatus(dispute.id, disputeStatus, save.worldDate);
    logEvent(
      db,
      dispute.personId,
      teamId,
      managerProfileId,
      disputeStatus === "MEDIATED" ? "DISPUTE_MEDIATED" : "DISPUTE_UNRESOLVED",
      save.worldDate,
      { disputeId: dispute.id, meetingId: meeting.id },
    );
    // Easing or deepening whatever the dispute was actually about.
    for (const involvedId of dispute.withPersonId
      ? [dispute.personId, dispute.withPersonId]
      : [dispute.personId]) {
      const concern = dynamics.concern(involvedId, teamId, dispute.concernType);
      if (concern && concern.status !== "RESOLVED") {
        dynamics.upsertConcern({
          ...concern,
          severity: clamp(concern.severity + (outcome === "POSITIVE" ? -3 : 1), 1, 10),
          status:
            outcome === "POSITIVE" && concern.status === "ESCALATED" ? "ACTIVE" : concern.status,
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
      for (const concern of dynamics
        .concernsForTeam(teamId)
        .filter((entry) => entry.status !== "RESOLVED")) {
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
  ROLE_STATUS: ["REASSURE", "PROMISE_SQUAD_ROLE", "PROMISE_SQUAD_STRENGTHENING", "DISMISS"],
  TRANSFER_INTEREST: [
    "REASSURE",
    "PROMISE_TRANSFER_STANCE",
    "PROMISE_LOAN_CONSIDERATION",
    "DISMISS",
  ],
};

export const validActionsForConcern = (type: PlayerConcernType): ConcernResponseAction[] =>
  VALID_ACTIONS_FOR_CONCERN[type];

const PROMISE_TYPE_FOR_ACTION: Partial<Record<ConcernResponseAction, ManagerPromiseType>> = {
  PROMISE_PLAYING_TIME: "PLAYING_TIME",
  PROMISE_CONTRACT_REVIEW: "CONTRACT_REVIEW",
  PROMISE_SQUAD_ROLE: "SQUAD_ROLE",
  PROMISE_TRANSFER_STANCE: "TRANSFER_STANCE",
  PROMISE_LOAN_CONSIDERATION: "LOAN_CONSIDERATION",
  PROMISE_SQUAD_STRENGTHENING: "SQUAD_STRENGTHENING",
};

const CONCERN_TYPE_FOR_PROMISE: Partial<Record<ManagerPromiseType, PlayerConcernType>> = {
  PLAYING_TIME: "PLAYING_TIME",
  CONTRACT_REVIEW: "CONTRACT",
  SQUAD_ROLE: "ROLE_STATUS",
  TRANSFER_STANCE: "TRANSFER_INTEREST",
  LOAN_CONSIDERATION: "TRANSFER_INTEREST",
  SQUAD_STRENGTHENING: "ROLE_STATUS",
};

const PROMISE_DURATION_DAYS: Partial<Record<ManagerPromiseType, number>> = {
  PLAYING_TIME: 30,
  CONTRACT_REVIEW: 45,
  SQUAD_ROLE: 45,
  TRANSFER_STANCE: 60,
  LOAN_CONSIDERATION: 45,
  SQUAD_STRENGTHENING: 60,
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
    case "LOAN_CONSIDERATION":
      return "Promised to consider a suitable loan move.";
    case "SQUAD_STRENGTHENING":
      return "Promised to strengthen the squad around them.";
    case "PROMOTION_CHALLENGE":
      return "Promised to challenge for promotion or the title.";
    case "YOUTH_USAGE":
      return "Promised to give meaningful opportunities to youth players.";
    case "FINANCIAL_DISCIPLINE":
      return "Promised to maintain financial discipline.";
    case "FACILITY_PROJECT":
      return "Promised to deliver the agreed facility project.";
    case "TACTICAL_STYLE":
      return "Promised to use the agreed tactical style.";
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
  } else if (type === "SQUAD_STRENGTHENING") {
    const teamRow = db.prepare("SELECT club_id FROM teams WHERE id = ?").get(concern.teamId) as
      SqlRow | undefined;
    baselineMetric = teamRow?.club_id
      ? new TransferMarketRepository(db).activeContractsForClub(teamRow.club_id, worldDate).length
      : undefined;
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
    dueOn: addDays(worldDate, PROMISE_DURATION_DAYS[type] ?? 60),
    status: "ACTIVE",
    baselineMetric,
  };
  new SquadDynamicsRepository(db).upsertPromise(promise);
  logEvent(db, concern.personId, concern.teamId, managerProfileId, "PROMISE_MADE", worldDate, {
    type,
  });
  return promise;
};

// ---------------------------------------------------------------------------
// Player demands — a formal, player-initiated request the manager must
// actually answer, distinct from a concern (a system-detected unhappiness
// signal). TRANSFER_REQUEST/LOAN_REQUEST are deliberately NOT represented
// here — those already have a first-class mechanism in transfer-market.ts
// (requestPlayerTransfer / player_transfer_requests); duplicating that would
// create two competing transfer-request systems.
// ---------------------------------------------------------------------------

const DEMAND_TYPE_FOR_CONCERN: Partial<Record<PlayerConcernType, PlayerDemandType>> = {
  PLAYING_TIME: "PLAYING_TIME_REQUEST",
  CONTRACT: "CONTRACT_REQUEST",
  ROLE_STATUS: "ROLE_REQUEST",
};

const DEMAND_REVIEW_DAYS = 21;

const requestedOutcomeFor = (type: PlayerDemandType): string => {
  switch (type) {
    case "PLAYING_TIME_REQUEST":
      return "More regular playing time.";
    case "CONTRACT_REQUEST":
      return "A new or improved contract.";
    case "ROLE_REQUEST":
      return "A clearer, more senior squad role.";
    case "CAPTAINCY_CONCERN":
      return "Recognition of their standing in the leadership group.";
  }
};

/**
 * Formalizes a genuinely escalated concern into a demand the manager must
 * respond to — never invented from a merely RAISED/ACTIVE concern, and
 * never duplicated while one of this type is already OPEN for this player.
 * Concern types with no matching demand type (TRANSFER_INTEREST — handled
 * by the real transfer-request pipeline) are silently skipped.
 */
const openDemandFromConcern = (
  db: GameDatabase,
  worldDate: string,
  managerProfileId: EntityId,
  concern: PlayerConcern,
): PlayerDemand | undefined => {
  const type = DEMAND_TYPE_FOR_CONCERN[concern.type];
  if (!type) return undefined;
  const dynamics = new SquadDynamicsRepository(db);
  const existing = dynamics.demand(concern.personId, concern.teamId, type);
  if (existing && existing.status === "OPEN") return undefined;
  const demand: PlayerDemand = {
    id: existing?.id ?? createEntityId(),
    personId: concern.personId,
    teamId: concern.teamId,
    type,
    status: "OPEN",
    severity: concern.severity,
    openedOn: worldDate,
    updatedOn: worldDate,
    reviewOn: addDays(worldDate, DEMAND_REVIEW_DAYS),
    trigger: concern.note ?? `${band(concern.type)} concern escalated`,
    requestedOutcome: requestedOutcomeFor(type),
    concernId: concern.id,
  };
  dynamics.upsertDemand(demand);
  logEvent(db, concern.personId, concern.teamId, managerProfileId, "DEMAND_OPENED", worldDate, {
    type,
    demandId: demand.id,
  });
  return demand;
};

export class DemandActionError extends Error {
  constructor(
    readonly code: "DEMAND_NOT_FOUND" | "DEMAND_NOT_OPEN",
    message: string,
  ) {
    super(message);
  }
}

const PROMISE_TYPE_FOR_DEMAND: Record<PlayerDemandType, ManagerPromiseType | undefined> = {
  PLAYING_TIME_REQUEST: "PLAYING_TIME",
  CONTRACT_REQUEST: "CONTRACT_REVIEW",
  ROLE_REQUEST: "SQUAD_ROLE",
  CAPTAINCY_CONCERN: undefined,
};

/**
 * The manager's response to one OPEN demand. ACCEPT and ALTERNATIVE both
 * create a real, measurable promise (via the same createPromise the concern
 * pathway uses) rather than a fire-and-forget "yes" — so a manager who
 * accepts and then does nothing still breaks a promise, exactly like the
 * concern flow. REJECT and DEFER never fabricate a promise.
 */
export const respondToDemand = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  demandId: EntityId,
  response: PlayerDemandManagerResponse,
  responseNote?: string,
): { demand: PlayerDemand; promise?: ManagerPromise } => {
  const dynamics = new SquadDynamicsRepository(db);
  const demand = dynamics.demandById(demandId);
  if (!demand) throw new DemandActionError("DEMAND_NOT_FOUND", "That request no longer exists.");
  if (demand.status !== "OPEN") {
    throw new DemandActionError("DEMAND_NOT_OPEN", "This request has already been answered.");
  }
  const worldDate = save.worldDate;
  const concern = demand.concernId ? dynamics.concernById(demand.concernId) : undefined;

  let promise: ManagerPromise | undefined;
  let status: PlayerDemandStatus;
  let relationshipDelta: number;
  let eventType:
    | "DEMAND_ACCEPTED"
    | "DEMAND_REJECTED"
    | "DEMAND_DEFERRED"
    | "DEMAND_RESOLVED";

  if (response === "DEFER") {
    status = "DEFERRED";
    relationshipDelta = -1;
    eventType = "DEMAND_DEFERRED";
  } else if (response === "REJECT") {
    status = "REJECTED";
    relationshipDelta = -8;
    eventType = "DEMAND_REJECTED";
    if (concern && concern.status !== "RESOLVED") {
      dynamics.upsertConcern({ ...concern, status: "ESCALATED", updatedOn: worldDate });
    }
  } else {
    // ACCEPT or ALTERNATIVE
    const promiseType = PROMISE_TYPE_FOR_DEMAND[demand.type];
    if (promiseType && concern) {
      promise = createPromise(db, save, managerProfileId, concern, promiseType);
    }
    status = "ACCEPTED";
    relationshipDelta = response === "ACCEPT" ? 6 : 3;
    eventType = "DEMAND_ACCEPTED";
  }

  const updated: PlayerDemand = {
    ...demand,
    status,
    updatedOn: worldDate,
    managerResponse: response,
    responseNote,
    promiseId: promise?.id,
    resolvedOn: status === "DEFERRED" ? undefined : worldDate,
  };
  dynamics.upsertDemand(updated);
  if (relationshipDelta !== 0) {
    adjustRelationship(db, managerProfileId, demand.personId, relationshipDelta, worldDate);
  }
  logEvent(db, demand.personId, demand.teamId, managerProfileId, eventType, worldDate, {
    type: demand.type,
    response,
    demandId: demand.id,
  });
  return { demand: updated, promise };
};

/**
 * The AI manager's own narrow demand-handling entry point — deterministic,
 * driven by the real relationship score, never a flat always-accept or
 * always-reject policy. Considers at most one, highest-severity OPEN
 * demand per call, matching manageAiPromisesForTeam's event-driven shape.
 */
export const manageAiDemandsForTeam = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  teamId: EntityId,
): ReturnType<typeof respondToDemand> | undefined => {
  const dynamics = new SquadDynamicsRepository(db);
  const demand = dynamics
    .demandsForTeam(teamId)
    .filter((entry) => entry.status === "OPEN")
    .sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))[0];
  if (!demand) return undefined;
  const relationship = dynamics.relationship(managerProfileId, demand.personId)?.score ?? 0;
  const response: PlayerDemandManagerResponse =
    relationship >= 10 ? "ACCEPT" : relationship >= -20 ? "DEFER" : "REJECT";
  return respondToDemand(db, save, managerProfileId, demand.id, response);
};

/**
 * An AI manager's own, narrow entry point for the Team Meeting Context
 * Engine — mirrors manageAiPromisesForTeam/manageAiDemandsForTeam. Only
 * acts when evaluateTeamMeetingContext finds a genuine reason (the same
 * real derivation a human manager sees), always picks the message with a
 * GOOD fit for that context (falling back to the first offered message if
 * none is marked GOOD), and silently does nothing when the meeting cooldown
 * hasn't lifted yet — an AI team simply isn't due for a team talk that day,
 * which is a real, expected outcome rather than a failure.
 */
export const manageAiTeamMeetingsForTeam = (
  db: GameDatabase,
  save: SaveMetadata,
  managerProfileId: EntityId,
  teamId: EntityId,
): SquadMeeting | undefined => {
  const context = evaluateTeamMeetingContext(db, save.worldDate, teamId);
  if (!context) return undefined;
  const message = context.messages.find((m) => m.fit === "GOOD") ?? context.messages[0];
  try {
    return holdSquadMeeting(db, save, managerProfileId, teamId, {
      type: "SQUAD_MEETING",
      messageId: message?.id,
    });
  } catch (error) {
    if (error instanceof MeetingActionError) return undefined;
    throw error;
  }
};

const CONCERN_RESPONSE_MEETING_OUTCOME: Record<ConcernResponseOutcome, SquadMeetingOutcome> = {
  ACCEPTED: "POSITIVE",
  SKEPTICAL: "NEUTRAL",
  REJECTED: "NEGATIVE",
};

const concernResponseSummary = (action: ConcernResponseAction, outcome: ConcernResponseOutcome): string => {
  if (action === "DISMISS") return "The concern was dismissed outright.";
  if (outcome === "REJECTED") return "The conversation did not land — the concern remains unresolved.";
  if (action === "REASSURE") return "A reassuring conversation, without a firm commitment.";
  return outcome === "SKEPTICAL"
    ? "A real commitment was made, though it was received with some doubt."
    : "A real, measurable commitment was made and well received.";
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
  if (
    action === "REASSURE" &&
    hierarchyRole &&
    ["CAPTAIN", "VICE_CAPTAIN", "SENIOR_PLAYER"].includes(hierarchyRole)
  ) {
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
      promise = createPromise(
        db,
        save,
        managerProfileId,
        concern,
        PROMISE_TYPE_FOR_ACTION[action]!,
      );
      concernUpdate = { ...concern, status: "ACTIVE", updatedOn: worldDate };
    }
  }

  if (concernUpdate) dynamics.upsertConcern(concernUpdate);
  if (relationshipDelta !== 0) {
    adjustRelationship(db, managerProfileId, concern.personId, relationshipDelta, worldDate);
  }

  // Responding to a concern IS a real one-to-one meeting with this player —
  // recorded the same way holdSquadMeeting's own ONE_TO_ONE type is, so it
  // (a) actually shows up in the player's meeting history (PlayerRelationshipView.recentMeetings),
  // and (b) makes assertMeetingAllowed's shared ONE_TO_ONE cooldown above
  // genuinely effective against a second response to the same concern in
  // quick succession, not just against a separate generic check-in.
  recordMeeting(
    db,
    concern.teamId,
    managerProfileId,
    "ONE_TO_ONE",
    CONCERN_RESPONSE_MEETING_OUTCOME[outcome],
    concernResponseSummary(action, outcome),
    worldDate,
    { personId: concern.personId, concernId: concern.id },
  );

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
    .filter((entry) => entry.status === "ACTIVE" || entry.status === "AT_RISK")) {
    if (worldDate < promise.dueOn) {
      const daysLeft = daysBetween(worldDate, promise.dueOn);
      const transferStatus = new TransferMarketRepository(db).transferStatus(personId);
      const atRisk =
        (promise.type === "PLAYING_TIME" &&
          daysLeft <= 10 &&
          currentAppearances <= (promise.baselineMetric ?? 0)) ||
        (promise.type === "CONTRACT_REVIEW" &&
          daysLeft <= 14 &&
          (!contract || daysBetween(worldDate, contract.endDate) <= 30)) ||
        (promise.type === "SQUAD_ROLE" &&
          daysLeft <= 14 &&
          (!contract || ROLE_RANK[contract.squadRole] <= (promise.baselineMetric ?? 0))) ||
        (promise.type === "TRANSFER_STANCE" && transferStatus?.status === "TRANSFER_LISTED") ||
        (promise.type === "LOAN_CONSIDERATION" &&
          daysLeft <= 14 &&
          !new TransferMarketRepository(db)
            .activeLoans(worldDate)
            .some((loan) => loan.playerId === personId)) ||
        (promise.type === "SQUAD_STRENGTHENING" && daysLeft <= 14);
      const nextStatus = atRisk ? "AT_RISK" : "ACTIVE";
      if (promise.status !== nextStatus) {
        const updated = { ...promise, status: nextStatus as ManagerPromise["status"] };
        dynamics.upsertPromise(updated);
        if (atRisk) outcome.atRiskPromises.push(updated);
      }
      continue;
    }

    let evaluable = true;
    let kept = false;
    if (promise.type === "PLAYING_TIME") {
      evaluable = promise.baselineMetric !== undefined;
      const appearances = currentAppearances - (promise.baselineMetric ?? 0);
      // A player cannot honour a playing-time commitment while unavailable.
      // Scale the concrete appearance threshold by fixtures that were
      // actually available during the promise window, using only persisted
      // fixtures and injury records.
      const scheduledMatches = promiseWindowMatches(db, teamId, promise.madeOn, promise.dueOn);
      const unavailableMatches = promiseWindowUnavailableMatches(
        db,
        personId,
        teamId,
        promise.madeOn,
        promise.dueOn,
      );
      const availableMatches = Math.max(0, scheduledMatches - unavailableMatches);
      // Legacy/imported saves may not have fixture rows for the promise
      // window. Preserve the original measurable threshold in that case.
      const requiredAppearances = scheduledMatches > 0 ? Math.min(2, availableMatches) : 2;
      kept = evaluable && (requiredAppearances === 0 || appearances >= requiredAppearances);
    } else if (promise.type === "CONTRACT_REVIEW") {
      evaluable = contract !== undefined && promise.baselineMetric !== undefined;
      kept =
        evaluable && daysBetween("1970-01-01", contract!.endDate) > (promise.baselineMetric ?? 0);
    } else if (promise.type === "SQUAD_ROLE") {
      evaluable = contract !== undefined && promise.baselineMetric !== undefined;
      kept = evaluable && ROLE_RANK[contract!.squadRole] > (promise.baselineMetric ?? 0);
    } else if (promise.type === "SQUAD_STRENGTHENING") {
      const clubId = contract?.clubId;
      const currentSquadSize = clubId
        ? new TransferMarketRepository(db).activeContractsForClub(clubId, worldDate).length
        : 0;
      evaluable = clubId !== undefined && promise.baselineMetric !== undefined;
      kept = evaluable && currentSquadSize > (promise.baselineMetric ?? 0);
    } else if (promise.type === "LOAN_CONSIDERATION") {
      const activeLoan = new TransferMarketRepository(db)
        .activeLoans(worldDate)
        .some((loan) => loan.playerId === personId);
      kept = activeLoan;
    } else {
      kept =
        new TransferMarketRepository(db).transferStatus(personId)?.status !== "TRANSFER_LISTED";
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

    const resolved: ManagerPromise = {
      ...promise,
      status: kept ? "FULFILLED" : "BROKEN",
      resolvedOn: worldDate,
    };
    dynamics.upsertPromise(resolved);
    logEvent(
      db,
      personId,
      teamId,
      managerProfileId,
      kept ? "PROMISE_KEPT" : "PROMISE_BROKEN",
      worldDate,
      {
        type: promise.type,
        promiseId: promise.id,
      },
    );

    if (kept) {
      relationshipDelta += 12;
      outcome.keptPromises.push(resolved);
      const concern = promise.concernId ? dynamics.concernById(promise.concernId) : undefined;
      if (concern && concern.status !== "RESOLVED") {
        dynamics.upsertConcern({
          ...concern,
          status: "RESOLVED",
          updatedOn: worldDate,
          resolvedOn: worldDate,
        });
        outcome.resolvedConcerns.push({
          ...concern,
          status: "RESOLVED",
          updatedOn: worldDate,
          resolvedOn: worldDate,
        });
      }
      continue;
    }

    relationshipDelta -= 18;
    outcome.brokenPromises.push(resolved);
    const concernType = CONCERN_TYPE_FOR_PROMISE[promise.type];
    if (!concernType) continue;
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

const promiseWindowMatches = (
  db: GameDatabase,
  teamId: EntityId,
  from: string,
  to: string,
): number =>
  Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM fixtures
           WHERE status = 'played' AND scheduled_date > ? AND scheduled_date <= ?
           AND (home_team_id = ? OR away_team_id = ?)`,
        )
        .get(from, to, teamId, teamId) as SqlRow | undefined
    )?.count ?? 0,
  );

const promiseWindowUnavailableMatches = (
  db: GameDatabase,
  personId: EntityId,
  teamId: EntityId,
  from: string,
  to: string,
): number => {
  const fixtures = db
    .prepare(
      `SELECT scheduled_date FROM fixtures
       WHERE status = 'played' AND scheduled_date > ? AND scheduled_date <= ?
       AND (home_team_id = ? OR away_team_id = ?)
       ORDER BY scheduled_date`,
    )
    .all(from, to, teamId, teamId) as SqlRow[];
  const injuries = db
    .prepare(
      `SELECT date_occurred, expected_recovery_date FROM injuries
       WHERE person_id = ? AND date_occurred <= ? AND expected_recovery_date > ?`,
    )
    .all(personId, to, from) as SqlRow[];
  return fixtures.filter((fixture) =>
    injuries.some(
      (injury) =>
        fixture.scheduled_date >= injury.date_occurred &&
        fixture.scheduled_date <= injury.expected_recovery_date,
    ),
  ).length;
};
