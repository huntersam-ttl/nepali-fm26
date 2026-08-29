import {
  createStableEntityId,
  type ClubRivalry,
  type EntityId,
  type FixtureRecord,
  type MatchResult,
} from "@nepal-football-sim/shared-types";
import {
  EventRepository,
  FootballHistoryRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";

export const recordFootballMatchHistory = (
  db: GameDatabase,
  fixture: FixtureRecord,
  result: MatchResult,
  playedDate: string,
  rivalry?: Pick<ClubRivalry, "id" | "intensity">,
): void => {
  const eventId = createStableEntityId("history", `MATCH:${result.match.id}`);
  if (!db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(eventId)) {
    const homeGoals = result.match.homeGoals ?? 0;
    const awayGoals = result.match.awayGoals ?? 0;
    new EventRepository(db).insertHistoricalEvent({
      id: eventId,
      occurredOn: playedDate,
      eventType: "MATCH_COMPLETED",
      involvedEntities: [
        { type: "team", id: fixture.homeTeamId },
        { type: "team", id: fixture.awayTeamId },
        { type: "competitionSeason", id: fixture.competitionSeasonId as EntityId },
      ],
      title: rivalry ? "Rivalry match completed" : "Competitive match completed",
      data: {
        fixtureId: fixture.id,
        homeGoals,
        awayGoals,
        winnerTeamId: result.match.winnerTeamId,
        ...(rivalry ? { rivalryId: rivalry.id, rivalryIntensity: rivalry.intensity } : {}),
      },
      importance: rivalry || fixture.round >= 20 ? "high" : "low",
      scope: "world",
    });
    const margin = Math.abs(homeGoals - awayGoals);
    const winner =
      homeGoals === awayGoals
        ? undefined
        : homeGoals > awayGoals
          ? fixture.homeTeamId
          : fixture.awayTeamId;
    if (winner && margin > 0) {
      new FootballHistoryRepository(db).record({
        recordType: "BIGGEST_WIN_MARGIN",
        scopeId: "world:simulated" as EntityId,
        holderId: winner,
        value: margin,
        achievedOn: playedDate,
        sourceId: result.match.id,
        provenanceStatus: "SIMULATION_ONLY",
      });
    }
  }
};

export const recordCompetitionSeasonHistory = (
  db: GameDatabase,
  input: {
    seasonId: EntityId;
    seasonName: string;
    championTeamId?: EntityId;
    championClubId?: EntityId;
    date: string;
  },
): void => {
  if (!input.championTeamId) return;
  const eventId = createStableEntityId("history", `COMPETITION_SEASON:${input.seasonId}`);
  if (db.prepare("SELECT 1 FROM historical_events WHERE id=?").get(eventId)) return;
  new EventRepository(db).insertHistoricalEvent({
    id: eventId,
    occurredOn: input.date,
    eventType: "COMPETITION_SEASON_COMPLETED",
    involvedEntities: [
      { type: "competitionSeason", id: input.seasonId },
      { type: "team", id: input.championTeamId },
      ...(input.championClubId ? [{ type: "club" as const, id: input.championClubId }] : []),
    ],
    title: `${input.seasonName} completed`,
    data: { championTeamId: input.championTeamId, championClubId: input.championClubId },
    importance: "high",
    scope: "world",
  });
};
