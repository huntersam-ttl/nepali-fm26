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
        const sportingSelection = selectedMemberships(completed, relationship, slots);
        const fallbackSelection =
          input.eligibleClubIds === undefined
            ? []
            : rankedMemberships(completed, relationship)
                .filter((membership) => input.eligibleClubIds!.has(membership.clubId))
                .filter((membership) => !sportingSelection.some((selected) => selected.clubId === membership.clubId))
                .slice(0, Math.max(0, slots - sportingSelection.filter((membership) => input.eligibleClubIds!.has(membership.clubId)).length));
        const selected = [...sportingSelection, ...fallbackSelection];
        for (const membership of selected) {
          const eligible =
            input.eligibleClubIds === undefined || input.eligibleClubIds.has(membership.clubId);
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
          historicalEvents.push(movementHistory(movement, completed.season));
          if (eligible && movementType !== "QUALIFICATION") {
            const outgoing =
              outgoingClubsByCompetition.get(completed.season.competitionId) ?? new Set();
            outgoing.add(membership.clubId);
            outgoingClubsByCompetition.set(completed.season.competitionId, outgoing);
          }
        }
      }
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
    events.insertHistoricalEvent(event);
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
  id: createEntityId(),
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
  id: createEntityId(),
  occurredOn: season.endDate,
  eventType: movementType === "PROMOTION" ? "PROMOTION_SUSPENDED" : "RELEGATION_SUSPENDED",
  involvedEntities: [{ type: "competitionSeason", id: season.id }],
  title: `${movementType.toLowerCase()} suspended for ${season.name}`,
  data: { competitionId: season.competitionId, movementType },
  importance: "medium",
  scope: "federation",
});

const expansionHistory = (season: CompetitionSeason): HistoricalEvent => ({
  id: createEntityId(),
  occurredOn: season.startDate,
  eventType: "COMPETITION_EXPANDED",
  involvedEntities: [{ type: "competitionSeason", id: season.id }],
  title: `Competition expanded for ${season.name}`,
  data: { competitionId: season.competitionId },
  importance: "medium",
  scope: "federation",
});
