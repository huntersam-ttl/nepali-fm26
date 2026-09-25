import { homeCountryId } from "./home-context.js";
import { ContinentalCareerRepository, type GameDatabase } from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type ContinentalCoefficientSnapshot,
  type ContinentalResult,
  type EntityId,
} from "@nepal-football-sim/shared-types";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Five-season coefficient window. Older seasons retain context but cannot dominate current form. */
export const calculateContinentalCoefficient = (
  results: ContinentalResult[],
  seasonLabel: string,
): {
  coefficient: number;
  resultPoints: number;
  participatingClubs: number;
  clubContributions: Record<EntityId, number>;
} => {
  const current = results.filter((result) => result.seasonLabel === seasonLabel);
  const clubs = new Set(current.map((result) => result.clubId));
  const points = current.reduce((sum, result) => sum + clamp(result.resultPoints, 0, 100), 0);
  const clubContributions = Object.fromEntries(
    [...clubs]
      .sort()
      .map((clubId) => [
        clubId,
        current
          .filter((result) => result.clubId === clubId)
          .reduce((sum, result) => sum + clamp(result.resultPoints, 0, 100), 0),
      ]),
  ) as Record<EntityId, number>;
  return {
    coefficient: Number((points / Math.max(1, clubs.size)).toFixed(3)),
    resultPoints: points,
    participatingClubs: clubs.size,
    clubContributions,
  };
};

export const rollingContinentalCoefficient = (seasonValues: number[], window = 5): number => {
  const values = seasonValues.slice(-window).reverse();
  const weights = [1, 0.8, 0.6, 0.4, 0.2];
  const totalWeight = values.reduce((sum, _, index) => sum + (weights[index] ?? 0.2), 0);
  return totalWeight === 0
    ? 0
    : Number(
        (
          values.reduce(
            (sum, value, index) => sum + clamp(value, 0, 20) * (weights[index] ?? 0.2),
            0,
          ) / totalWeight
        ).toFixed(3),
      );
};

export const persistContinentalCoefficient = (
  db: GameDatabase,
  input: {
    associationId: EntityId;
    seasonLabel: string;
    results: ContinentalResult[];
    calculatedOn: string;
  },
): ContinentalCoefficientSnapshot => {
  const repository = new ContinentalCareerRepository(db);
  const current = calculateContinentalCoefficient(input.results, input.seasonLabel);
  const prior = repository
    .snapshots(input.associationId)
    .filter((item) => item.seasonLabel !== input.seasonLabel)
    .map((item) => item.coefficient);
  const snapshot: ContinentalCoefficientSnapshot = {
    id: createStableEntityId(
      "continental-coefficient",
      `${input.associationId}:${input.seasonLabel}`,
    ),
    associationId: input.associationId,
    seasonLabel: input.seasonLabel,
    coefficient: rollingContinentalCoefficient([...prior, current.coefficient]),
    resultPoints: current.resultPoints,
    participatingClubs: current.participatingClubs,
    clubContributions: current.clubContributions,
    rollingWindow: [...prior, current.coefficient].slice(-5),
    calculatedOn: input.calculatedOn,
    provenanceStatus: "SIMULATION_ONLY",
  };
  repository.upsert(snapshot);
  return snapshot;
};

export const continentalCoefficientReadModel = (
  db: GameDatabase,
  associationId: EntityId,
): ContinentalCoefficientSnapshot[] => new ContinentalCareerRepository(db).snapshots(associationId);

/** Ingests only completed, persisted fixtures in a continental competition. */
export const processCompletedContinentalSeason = (
  db: GameDatabase,
  input: { competitionSeasonId: EntityId; calculatedOn: string },
): ContinentalCoefficientSnapshot | undefined => {
  const rows = db
    .prepare(
      `SELECT c.federation_id AS association_id, cs.start_date, f.id AS fixture_id,
      m.home_goals, m.away_goals, m.played_date, hc.id AS home_club_id, ac.id AS away_club_id,
      hcountry.id AS home_country_id, acountry.id AS away_country_id
    FROM fixtures f JOIN matches m ON m.fixture_id=f.id
    JOIN competition_seasons cs ON cs.id=f.competition_season_id
    JOIN competitions c ON c.id=cs.competition_id
    JOIN teams ht ON ht.id=f.home_team_id JOIN teams at ON at.id=f.away_team_id
    JOIN clubs hc ON hc.id=ht.club_id JOIN clubs ac ON ac.id=at.club_id
    JOIN countries hcountry ON hcountry.id=hc.country_id JOIN countries acountry ON acountry.id=ac.country_id
    WHERE f.competition_season_id=? AND c.scope='continental'
      AND (hcountry.id = (SELECT country_id FROM home_football_country LIMIT 1) OR acountry.id = (SELECT country_id FROM home_football_country LIMIT 1))
    ORDER BY f.id`,
    )
    .all(input.competitionSeasonId) as Array<Record<string, unknown>>;
  if (rows.length === 0 || !rows[0]!.association_id) return undefined;
  const homeCountry = homeCountryId(db);
  const associationId = rows[0]!.association_id as EntityId;
  const seasonLabel = String(rows[0]!.start_date).slice(0, 4);
  const byClub = new Map<EntityId, ContinentalResult>();
  for (const row of rows) {
    const homeGoals = Number(row.home_goals ?? 0);
    const awayGoals = Number(row.away_goals ?? 0);
    const homeNepal = row.home_country_id === homeCountry;
    const awayNepal = row.away_country_id === homeCountry;
    const date = String(row.played_date ?? input.calculatedOn);
    const add = (clubId: EntityId, points: number) => {
      const previous = byClub.get(clubId);
      byClub.set(
        clubId,
        previous
          ? {
              ...previous,
              resultPoints: previous.resultPoints + points,
              matches: previous.matches + 1,
            }
          : {
              associationId,
              clubId,
              seasonLabel,
              resultPoints: points,
              matches: 1,
              completedOn: date,
              provenanceStatus: "SIMULATION_ONLY",
            },
      );
    };
    if (homeGoals === awayGoals) {
      if (homeNepal) add(row.home_club_id as EntityId, 1);
      if (awayNepal) add(row.away_club_id as EntityId, 1);
    } else if (homeGoals > awayGoals) {
      if (homeNepal) add(row.home_club_id as EntityId, 3);
      if (awayNepal) add(row.away_club_id as EntityId, 0);
    } else {
      if (homeNepal) add(row.home_club_id as EntityId, 0);
      if (awayNepal) add(row.away_club_id as EntityId, 3);
    }
  }
  return byClub.size === 0
    ? undefined
    : persistContinentalCoefficient(db, {
        associationId,
        seasonLabel,
        results: [...byClub.values()],
        calculatedOn: input.calculatedOn,
      });
};
