import type {
  ClubBoardPolicy,
  ClubCulture,
  ClubCultureLabel,
  CoachingIdentity,
  EntityId,
  ManagerProfile,
  PlayerCareerPhase,
  SupporterCultureProfile,
} from "@nepal-football-sim/shared-types";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const deriveClubCulture = (input: {
  clubId: EntityId;
  date: string;
  policy: ClubBoardPolicy;
  managerIdentity?: CoachingIdentity;
  supporters?: SupporterCultureProfile;
  historicalSuccess?: number;
}): ClubCulture => {
  const scores: Array<[ClubCultureLabel, number]> = [
    ["YOUTH_DEVELOPMENT", input.policy.youthPriority * 100],
    [
      "COMMUNITY_FOCUSED",
      (input.supporters?.localIdentity ?? 50) * 0.65 + input.policy.youthPriority * 35,
    ],
    [
      "TRANSFER_TRADING",
      input.policy.transferPhilosophy === "PLAYER_TRADING"
        ? 90
        : input.policy.transferPhilosophy === "AGGRESSIVE"
          ? 65
          : 35,
    ],
    [
      "WIN_NOW",
      input.policy.strategicObjective === "TITLE_CHALLENGE"
        ? 95
        : (input.historicalSuccess ?? 0) * 0.4,
    ],
    ["STABILITY", input.policy.financialRiskTolerance === "LOW" ? 80 : 45],
    [
      "ATTACKING",
      input.managerIdentity?.strengths.some((item) => item.includes("attacking")) ? 75 : 42,
    ],
    [
      "HIGH_PRESSURE",
      (input.supporters?.expectations ?? 50) * 0.7 + (input.historicalSuccess ?? 0) * 0.3,
    ],
    ["PRAGMATIC", input.policy.financialRiskTolerance === "LOW" ? 72 : 45],
  ];
  return {
    clubId: input.clubId,
    labels: scores
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label),
    seasonStrength: clamp(scores[0]?.[1] ?? 0),
    updatedOn: input.date,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/** Culture follows a new target gradually; callers should persist the returned season snapshot if desired. */
export const evolveClubCulture = (
  previous: ClubCulture | undefined,
  target: ClubCulture,
  seasonsElapsed = 1,
): ClubCulture => {
  if (!previous) return target;
  const adoption = Math.min(0.35, Math.max(0.08, seasonsElapsed * 0.12));
  const labels = [...previous.labels];
  for (const label of target.labels)
    if (!labels.includes(label) && adoption >= 0.2) labels[labels.length - 1] = label;
  return {
    ...target,
    labels: labels.slice(0, 3),
    seasonStrength: clamp(
      previous.seasonStrength + (target.seasonStrength - previous.seasonStrength) * adoption,
    ),
  };
};

export const playerClubFit = (input: {
  culture: ClubCulture;
  personality: { professionalism: number; ambition: number; adaptability: number };
  phase: PlayerCareerPhase;
  expectedRole: "YOUTH" | "SQUAD" | "REGULAR" | "STAR";
}): { label: "STRONG" | "GOOD" | "MIXED" | "WEAK"; rationale: string[] } => {
  let score = 50;
  const rationale: string[] = [];
  if (input.culture.labels.includes("YOUTH_DEVELOPMENT") && input.phase === "EMERGING") {
    score += 18;
    rationale.push("development pathway suits current career stage");
  }
  if (input.culture.labels.includes("WIN_NOW") && input.expectedRole === "STAR") {
    score += 12;
    rationale.push("role matches win-now expectations");
  }
  if (input.culture.labels.includes("STABILITY") && input.personality.professionalism >= 65) {
    score += 10;
    rationale.push("professional habits suit a stable environment");
  }
  if (input.personality.adaptability < 40) score -= 10;
  return {
    label: score >= 75 ? "STRONG" : score >= 60 ? "GOOD" : score >= 40 ? "MIXED" : "WEAK",
    rationale,
  };
};

export const managerClubFit = (input: {
  culture: ClubCulture;
  manager: ManagerProfile;
  identity?: CoachingIdentity;
}): { label: "STRONG" | "GOOD" | "MIXED" | "WEAK"; rationale: string[] } => {
  let score = 50;
  const rationale: string[] = [];
  if (input.culture.labels.includes("YOUTH_DEVELOPMENT"))
    score += input.manager.attributes.coaching.youthDevelopment - 10;
  if (input.culture.labels.includes("HIGH_PRESSURE"))
    score += input.manager.attributes.tactical.matchManagement - 10;
  if (input.culture.labels.includes("STABILITY"))
    score += input.manager.attributes.personality.professionalism - 10;
  if (input.identity?.strengths.length)
    rationale.push(
      `coaching identity offers ${input.identity.strengths.slice(0, 2).join(" and ")}`,
    );
  if (score >= 70) rationale.push("manager profile aligns with club culture");
  return {
    label: score >= 75 ? "STRONG" : score >= 60 ? "GOOD" : score >= 40 ? "MIXED" : "WEAK",
    rationale,
  };
};
