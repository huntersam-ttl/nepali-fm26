import {
  createEntityId,
  createStableEntityId,
  type ClubMembership,
  type CompetitionMovement,
  type CompetitionMovementType,
  type CompetitionRelationship,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type EntityId,
  type HistoricalEvent,
  type LeagueStanding,
} from "@nepal-football-sim/shared-types";
import {
  CompetitionRepository,
  EventRepository,
  WorldRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";

export type CompletedCompetitionSeason = {
  season: CompetitionSeason;
  ruleSet: CompetitionRuleSet;
  standings: readonly LeagueStanding[];
  memberships: readonly ClubMembership[];
};

export type PyramidProgressionInput = {
  completedSeasons: readonly CompletedCompetitionSeason[];
  nextSeasons: ReadonlyMap<EntityId, CompetitionSeason>;
  relationships: readonly CompetitionRelationship[];
  eligibleClubIds?: ReadonlySet<EntityId>;
};

export type PyramidProgressionResult = {
  nextMemberships: ClubMembership[];
  movements: CompetitionMovement[];
  historicalEvents: HistoricalEvent[];
};

export const progressPyramidSeason = (input: PyramidProgressionInput): PyramidProgressionResult => {
  const movements: CompetitionMovement[] = [];
  const historicalEvents: HistoricalEvent[] = [];
  const outgoingClubsByCompetition = new Map<EntityId, Set<EntityId>>();
  const movementRanks = new Map<EntityId, number>();
  const movementSeasons = new Map<EntityId, CompetitionSeason>();
  const promotionSlotsByTarget = new Map<EntityId, number>();
  const byCompetition = new Map(
    input.completedSeasons.map((completed) => [completed.season.competitionId, completed]),
  );

  for (const completed of input.completedSeasons) {
    const relationships = input.relationships.filter(
      (relationship) => relationship.fromCompetitionId === completed.season.competitionId,
    );
    for (const movementType of ["PROMOTION", "RELEGATION", "QUALIFICATION"] as const) {
      const movementRelationships = relationships.filter(
        (relationship) => relationship.movementType === movementType,
      );
      if (movementRelationships.length === 0) {
        continue;
      }
      if (isMovementSuspended(completed.ruleSet, movementType)) {
        historicalEvents.push(suspendedHistory(completed.season, movementType));
        continue;
      }
      for (const relationship of movementRelationships) {
        const slots = movementSlots(completed.ruleSet, relationship);
        const targetSeason = input.nextSeasons.get(relationship.toCompetitionId);
        if (slots === 0 || targetSeason === undefined) {
          continue;
        }
        if (movementType === "PROMOTION") {
          promotionSlotsByTarget.set(
            relationship.toCompetitionId,
            (promotionSlotsByTarget.get(relationship.toCompetitionId) ?? 0) + slots,
          );
        }
        const sportingSelection = selectedMemberships(completed, relationship, slots);
        /*
         * Backfilling with the next eligible club only makes sense upward: it
         * replaces a promotion that licensing blocked. Applied to relegation it
         * demoted more clubs than the rule set has relegation slots.
         */
        const fallbackSelection =
          input.eligibleClubIds === undefined || movementType === "RELEGATION"
            ? []
            : rankedMemberships(completed, relationship)
                .filter((membership) => input.eligibleClubIds!.has(membership.clubId))
                .filter(
                  (membership) =>
                    !sportingSelection.some((selected) => selected.clubId === membership.clubId),
                )
                .slice(
                  0,
                  Math.max(
                    0,
                    slots -
                      sportingSelection.filter((membership) =>
                        input.eligibleClubIds!.has(membership.clubId),
                      ).length,
                  ),
                );
        const selected = [...sportingSelection, ...fallbackSelection];
        selected.forEach((membership, rank) => {
          /*
           * Licensing decides whether a club may enter a competition, so it gates
           * upward movement only. A club that finishes in a relegation place is
           * demoted on sporting merit; failing a licence must never protect it.
           */
          const eligible =
            movementType === "RELEGATION" ||
            input.eligibleClubIds === undefined ||
            input.eligibleClubIds.has(membership.clubId);
          const movement: CompetitionMovement = {
            id: createEntityId(),
            clubId: membership.clubId,
            teamId: membership.teamId,
            fromCompetitionId: completed.season.competitionId,
            toCompetitionId: relationship.toCompetitionId,
            fromCompetitionSeasonId: completed.season.id,
            toCompetitionSeasonId: targetSeason.id,
            movementType,
            status: eligible ? "APPLIED" : "INELIGIBLE",
            reason: eligible ? undefined : "Club eligibility requirements were not met",
          };
          movements.push(movement);
          // `selected` runs worst-placed first, so a higher rank index is a better finish.
          movementRanks.set(movement.id, rank);
          movementSeasons.set(movement.id, completed.season);
        });
      }
    }
  }

  /*
   * A division keeps its size because the clubs leaving it are replaced by the
   * clubs entering it. When the division below cannot supply an eligible
   * promotion, enforcing the demotion anyway would shrink the league, so the
   * unfilled promotion slots are reconciled into reprieves instead. The slot
   * count comes from the competition rule set, so no league size is assumed here.
   */
  for (const [targetCompetitionId, slots] of promotionSlotsByTarget) {
    const promoted = movements.filter(
      (movement) =>
        movement.movementType === "PROMOTION" &&
        movement.toCompetitionId === targetCompetitionId &&
        movement.status === "APPLIED",
    ).length;
    let deficit = Math.max(0, slots - promoted);
    if (deficit === 0) continue;
    // Best finish first: the club that only just fell into a relegation place.
    const reprievable = movements
      .filter(
        (movement) =>
          movement.movementType === "RELEGATION" &&
          movement.fromCompetitionId === targetCompetitionId &&
          movement.status === "APPLIED",
      )
      .sort(
        (a, b) =>
          (movementRanks.get(b.id) ?? 0) - (movementRanks.get(a.id) ?? 0) ||
          a.clubId.localeCompare(b.clubId),
      );
    for (const movement of reprievable) {
      if (deficit === 0) break;
      movement.status = "REPRIEVED";
      movement.reason = "Relegation reprieved because no eligible club could be promoted";
      deficit -= 1;
    }
  }

  /*
   * Outgoing clubs and history are derived after reconciliation so that a
   * reprieved club is never recorded as having left its division.
   */
  for (const movement of movements) {
    const season = movementSeasons.get(movement.id);
    if (season === undefined || movement.status !== "APPLIED") continue;
    historicalEvents.push(movementHistory(movement, season));
    if (movement.movementType !== "QUALIFICATION") {
      const outgoing = outgoingClubsByCompetition.get(movement.fromCompetitionId) ?? new Set();
      outgoing.add(movement.clubId);
      outgoingClubsByCompetition.set(movement.fromCompetitionId, outgoing);
    }
  }

  const nextMemberships = new Map<string, ClubMembership>();
  for (const completed of input.completedSeasons) {
    const nextSeason = input.nextSeasons.get(completed.season.competitionId);
    if (nextSeason === undefined) {
      continue;
    }
    const outgoing = outgoingClubsByCompetition.get(completed.season.competitionId) ?? new Set();
    for (const membership of completed.memberships) {
      if (membership.status === "WITHDRAWN" || membership.status === "SUSPENDED") {
        continue;
      }
      if (outgoing.has(membership.clubId)) {
        continue;
      }
      addMembership(nextMemberships, {
        ...membership,
        id: stableMembershipId(membership.clubId, nextSeason.id),
        competitionSeasonId: nextSeason.id,
        status: "ACTIVE",
      });
    }
  }

  for (const movement of movements.filter((item) => item.status === "APPLIED")) {
    addMembership(nextMemberships, {
      id: stableMembershipId(movement.clubId, movement.toCompetitionSeasonId),
      clubId: movement.clubId,
      teamId: movement.teamId,
      competitionId: movement.toCompetitionId,
      competitionSeasonId: movement.toCompetitionSeasonId,
      membershipType: "LEAGUE_MEMBER",
      status: membershipStatusForMovement(movement.movementType),
    });
  }

  for (const [competitionId, completed] of byCompetition) {
    if (completed.ruleSet.specialRules?.temporaryExpandedLeague) {
      const nextSeason = input.nextSeasons.get(competitionId);
      if (nextSeason) {
        historicalEvents.push(expansionHistory(nextSeason));
      }
    }
  }

  return {
    nextMemberships: [...nextMemberships.values()],
    movements,
    historicalEvents,
  };
};

export const persistPyramidProgression = (
  db: GameDatabase,
  result: PyramidProgressionResult,
): void => {
  const world = new WorldRepository(db);
  const competitions = new CompetitionRepository(db);
  const events = new EventRepository(db);
  for (const membership of result.nextMemberships) {
    world.insertClubMembership(membership);
  }
  for (const movement of result.movements) {
    competitions.insertMovement(movement);
  }
  for (const event of result.historicalEvents) {
    if (!db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(event.id)) {
      events.insertHistoricalEvent(event);
    }
  }
};

const selectedMemberships = (
  completed: CompletedCompetitionSeason,
  relationship: CompetitionRelationship,
  slots: number,
): ClubMembership[] => {
  return rankedMemberships(completed, relationship).slice(0, slots);
};

const rankedMemberships = (
  completed: CompletedCompetitionSeason,
  relationship: CompetitionRelationship,
): ClubMembership[] => {
  const membershipsByTeam = new Map(
    completed.memberships
      .filter((membership) => membership.teamId !== undefined)
      .map((membership) => [membership.teamId!, membership]),
  );
  const ordered =
    relationship.selectionMethod === "BOTTOM_TABLE"
      ? [...completed.standings].reverse()
      : [...completed.standings];
  return ordered
    .map((standing) => membershipsByTeam.get(standing.teamId))
    .filter((membership): membership is ClubMembership => membership !== undefined);
};

const movementSlots = (
  ruleSet: CompetitionRuleSet,
  relationship: CompetitionRelationship,
): number => {
  const configured =
    relationship.movementType === "PROMOTION"
      ? ruleSet.promotionSlots
      : relationship.movementType === "RELEGATION"
        ? ruleSet.relegationSlots
        : relationship.numberOfTeams;
  return Math.min(configured, relationship.numberOfTeams);
};

const isMovementSuspended = (
  ruleSet: CompetitionRuleSet,
  movementType: CompetitionMovementType,
): boolean => {
  if (movementType === "PROMOTION") {
    return ruleSet.promotionEnabled === false || ruleSet.specialRules?.promotionSuspended === true;
  }
  if (movementType === "RELEGATION") {
    return (
      ruleSet.relegationEnabled === false || ruleSet.specialRules?.relegationSuspended === true
    );
  }
  return ruleSet.specialRules?.competitionSuspended === true;
};

const addMembership = (
  memberships: Map<string, ClubMembership>,
  membership: ClubMembership,
): void => {
  if (membership.competitionSeasonId === undefined) {
    return;
  }
  memberships.set(`${membership.clubId}:${membership.competitionSeasonId}`, membership);
};

const stableMembershipId = (clubId: EntityId, seasonId: EntityId): EntityId =>
  createStableEntityId("club-membership", `${clubId}:${seasonId}`);

const membershipStatusForMovement = (
  movementType: CompetitionMovementType,
): ClubMembership["status"] => {
  switch (movementType) {
    case "PROMOTION":
      return "PROMOTED";
    case "RELEGATION":
      return "RELEGATED";
    case "QUALIFICATION":
      return "QUALIFIED";
  }
};

const movementHistory = (
  movement: CompetitionMovement,
  completedSeason: CompetitionSeason,
): HistoricalEvent => ({
  id: createStableEntityId(
    "history",
    `MOVEMENT:${movement.movementType}:${movement.clubId}:${movement.fromCompetitionSeasonId}:${movement.toCompetitionSeasonId}`,
  ),
  occurredOn: completedSeason.endDate,
  eventType:
    movement.movementType === "PROMOTION"
      ? "CLUB_PROMOTED"
      : movement.movementType === "RELEGATION"
        ? "CLUB_RELEGATED"
        : "CLUB_QUALIFIED",
  involvedEntities: [
    { type: "club", id: movement.clubId },
    { type: "competitionSeason", id: movement.fromCompetitionSeasonId },
    { type: "competitionSeason", id: movement.toCompetitionSeasonId },
  ],
  title: `Club ${movement.movementType.toLowerCase()} after ${completedSeason.name}`,
  data: {
    clubId: movement.clubId,
    teamId: movement.teamId,
    fromCompetitionId: movement.fromCompetitionId,
    toCompetitionId: movement.toCompetitionId,
    status: movement.status,
    reason: movement.reason,
  },
  importance: movement.status === "APPLIED" ? "medium" : "low",
  scope: "club",
});

const suspendedHistory = (
  season: CompetitionSeason,
  movementType: CompetitionMovementType,
): HistoricalEvent => ({
  id: createStableEntityId("history", `MOVEMENT_SUSPENDED:${movementType}:${season.id}`),
  occurredOn: season.endDate,
  eventType: movementType === "PROMOTION" ? "PROMOTION_SUSPENDED" : "RELEGATION_SUSPENDED",
  involvedEntities: [{ type: "competitionSeason", id: season.id }],
  title: `${movementType.toLowerCase()} suspended for ${season.name}`,
  data: { competitionId: season.competitionId, movementType },
  importance: "medium",
  scope: "federation",
});

const expansionHistory = (season: CompetitionSeason): HistoricalEvent => ({
  id: createStableEntityId("history", `COMPETITION_EXPANDED:${season.id}`),
  occurredOn: season.startDate,
  eventType: "COMPETITION_EXPANDED",
  involvedEntities: [{ type: "competitionSeason", id: season.id }],
  title: `Competition expanded for ${season.name}`,
  data: { competitionId: season.competitionId },
  importance: "medium",
  scope: "federation",
});
