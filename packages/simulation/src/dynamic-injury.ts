import type {
  DynamicInjuryRiskInput,
  DynamicInjuryRiskResult,
  InjuryRecord,
  PlayerDevelopmentState,
  WorkloadLabel,
} from "@nepal-football-sim/shared-types";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
const round = (value: number): number => Math.round(value * 1000) / 1000;

export const workloadLabel = (load: number): WorkloadLabel => {
  if (load >= 85) return "VERY_HIGH";
  if (load >= 68) return "HIGH";
  if (load >= 35) return "OPTIMAL";
  return "LOW";
};

/** Adds real workload/history context to the existing training risk signal. */
export const dynamicInjuryRisk = (input: DynamicInjuryRiskInput): DynamicInjuryRiskResult => {
  const minutes = clamp(input.minutesLast30Days ?? 0, 0, 900);
  const intensity = clamp(input.trainingIntensity ?? 50, 0, 100);
  const condition = clamp(input.physicalCondition ?? 80, 0, 100);
  const recovery = clamp(input.recovery ?? 75, 0, 100);
  const discipline = clamp(input.trainingDiscipline ?? 60, 0, 100);
  const load = clamp(intensity * 0.55 + (minutes / 540) * 45, 0, 100);
  const ageLoad = Math.max(0, input.age - 29) * 0.004;
  const historyLoad = clamp(input.priorInjuriesLastYear ?? 0, 0, 8) * 0.012;
  const conditionLoad = Math.max(0, 65 - condition) * 0.0025;
  const recoveryLoad = Math.max(0, 65 - recovery) * 0.002;
  const disciplineLoad = Math.max(0, 55 - discipline) * 0.0015;
  const risk = round(
    clamp(
      input.baseRisk +
        load / 950 +
        ageLoad +
        historyLoad +
        conditionLoad +
        recoveryLoad +
        disciplineLoad,
      0.005,
      0.35,
    ),
  );
  const recurrenceRisk = round(
    clamp(historyLoad * 2 + recoveryLoad + (input.priorInjuriesLastYear ?? 0) * 0.01, 0, 0.8),
  );
  const factors: string[] = [];
  if (load >= 68) factors.push("high workload");
  if (input.age >= 30) factors.push("age-related load");
  if ((input.priorInjuriesLastYear ?? 0) > 0) factors.push("recent injury history");
  if (condition < 65 || recovery < 65) factors.push("recovery or condition below ideal");
  if (discipline < 55) factors.push("inconsistent training discipline");
  return { risk, recurrenceRisk, workload: workloadLabel(load), factors };
};

export const physicalDevelopmentTrend = (input: {
  age: number;
  state: PlayerDevelopmentState;
  trainingQuality?: number;
  professionalism?: number;
  majorOrRecurringInjuries?: number;
}): "IMPROVING" | "STABLE" | "DECLINING" => {
  const environment = (input.trainingQuality ?? 1) * (input.professionalism ?? 1);
  const setback = Math.min(2, input.majorOrRecurringInjuries ?? 0) * 0.08;
  const signal =
    input.state.developmentMomentum * 0.01 +
    environment -
    setback -
    Math.max(0, input.age - 29) * 0.08;
  if (signal > 0.25) return "IMPROVING";
  if (signal < -0.25) return "DECLINING";
  return "STABLE";
};

/** Broad medical clue for callers that only have the injury record, not hidden probabilities. */
export const recurrenceLabel = (injuries: InjuryRecord[]): "LOW" | "MODERATE" | "ELEVATED" => {
  const major = injuries.filter((injury) => injury.severity === "major").length;
  if (major > 0 || injuries.length >= 3) return "ELEVATED";
  if (injuries.length > 0) return "MODERATE";
  return "LOW";
};
