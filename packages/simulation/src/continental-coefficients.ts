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
): { coefficient: number; resultPoints: number; participatingClubs: number } => {
  const current = results.filter((result) => result.seasonLabel === seasonLabel);
  const clubs = new Set(current.map((result) => result.clubId));
  const points = current.reduce((sum, result) => sum + clamp(result.resultPoints, 0, 12), 0);
  return {
    coefficient: Number((points / Math.max(1, clubs.size)).toFixed(3)),
    resultPoints: points,
    participatingClubs: clubs.size,
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
