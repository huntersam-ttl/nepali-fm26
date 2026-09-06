import { createStableEntityId, type EntityId, type NationDevelopmentCategory, type NationDevelopmentScorecard } from "@nepal-football-sim/shared-types";
import { FederationGovernanceRepository, FederationScorecardRepository, type GameDatabase } from "@nepal-football-sim/database";

/** Financial health is a band, not a number — this maps it onto the same
 * 0-100 scale as every other dimension so it can sit in one scorecard,
 * without pretending the band itself is more granular than it is. */
const FINANCIAL_HEALTH_SCORE: Record<string, number> = {
  EXCELLENT: 95,
  HEALTHY: 80,
  STABLE: 60,
  TIGHT: 40,
  DISTRESSED: 20,
  INSOLVENT: 5,
};

/**
 * Every category here is a direct read of a FederationSimulationProfile
 * dimension the game already computes — never an invented FIFA-style
 * rating. "International standing" is the only composite (reputation +
 * internationalRelations averaged), because the profile tracks both as
 * separate but closely related signals.
 */
const buildCategories = (
  profile: ReturnType<FederationGovernanceRepository["profile"]>,
): NationDevelopmentCategory[] => {
  if (!profile) return [];
  return [
    { key: "domesticCompetitions", label: "Domestic competitions", score: Math.round(profile.competitionOrganisation) },
    { key: "grassrootsYouth", label: "Grassroots & youth", score: Math.round(profile.grassrootsDevelopment) },
    { key: "playerDevelopment", label: "Player development", score: Math.round(profile.youthDevelopment) },
    { key: "coachingQuality", label: "Coaching quality", score: Math.round(profile.coachEducation) },
    { key: "refereeQuality", label: "Referee quality", score: Math.round(profile.refereeDevelopment) },
    { key: "infrastructure", label: "Infrastructure", score: Math.round(profile.infrastructureLevel) },
    { key: "commercialStrength", label: "Commercial strength", score: Math.round(profile.commercialStrength) },
    { key: "federationFinances", label: "Federation finances", score: FINANCIAL_HEALTH_SCORE[profile.financialHealth] ?? 50 },
    { key: "internationalStanding", label: "International standing", score: Math.round((profile.reputation + profile.internationalRelations) / 2) },
    { key: "governance", label: "Governance", score: Math.round(profile.governanceStability) },
  ];
};

/**
 * Builds the Build-a-Nation scorecard from real, already-persisted
 * FederationSimulationProfile state, plus the persisted annual snapshot
 * history for a trend line. Never invents a factual real-world FIFA
 * ranking — every figure is SIMULATION_ONLY and traceable to a dimension
 * the game itself already tracks.
 */
export const buildNationDevelopmentScorecard = (
  db: GameDatabase,
  federationId: EntityId,
  asOfDate: string,
): NationDevelopmentScorecard | undefined => {
  const profile = new FederationGovernanceRepository(db).profile(federationId);
  if (!profile) return undefined;
  const categories = buildCategories(profile);
  const overallScore = Math.round(categories.reduce((total, item) => total + item.score, 0) / categories.length);
  const strongest = categories.reduce((best, item) => (item.score > best.score ? item : best));
  const weakest = categories.reduce((worst, item) => (item.score < worst.score ? item : worst));
  const history = new FederationScorecardRepository(db).snapshots(federationId);
  const previous = history[history.length - 1];
  const trend: NationDevelopmentScorecard["trend"] = previous
    ? overallScore > previous.overallScore + 1
      ? "IMPROVING"
      : overallScore < previous.overallScore - 1
        ? "DECLINING"
        : "STABLE"
    : undefined;
  const belowThreshold = categories.filter((item) => item.score < 50).sort((a, b) => a.score - b.score);
  return {
    federationId,
    asOfDate,
    overallScore,
    categories,
    strongest,
    weakest,
    keyDrivers: [
      `${strongest.label} is the federation's strongest area (${strongest.score}/100).`,
      `${weakest.label} is holding overall development back (${weakest.score}/100).`,
    ],
    nextOpportunities: belowThreshold
      .slice(0, 3)
      .map((item) => `${item.label} is below halfway (${item.score}/100) — a project or programme here would move the needle.`),
    trend,
    history,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * Records one annual snapshot for the development-history trend line.
 * UNIQUE(federation_id, season_label) on the table itself is the real
 * dedupe guard — this can be called every month without ever producing
 * more than one row per federation per season.
 */
export const recordFederationDevelopmentSnapshot = (
  db: GameDatabase,
  federationId: EntityId,
  worldDate: string,
): void => {
  const scorecard = buildNationDevelopmentScorecard(db, federationId, worldDate);
  if (!scorecard) return;
  const seasonLabel = worldDate.slice(0, 4);
  new FederationScorecardRepository(db).upsertSnapshot({
    id: createStableEntityId("federation-snapshot", `${federationId}:${seasonLabel}`),
    federationId,
    seasonLabel,
    asOfDate: worldDate,
    overallScore: scorecard.overallScore,
    categories: Object.fromEntries(scorecard.categories.map((item) => [item.key, item.score])),
    provenanceStatus: "SIMULATION_ONLY",
  });
};
