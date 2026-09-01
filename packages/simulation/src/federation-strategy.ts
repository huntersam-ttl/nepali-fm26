import {
  type CompetitionRuleSet,
  type EntityId,
  type FixtureIntegritySummary,
  type FixtureRecord,
  type FederationProjectType,
  type InfrastructurePriority,
  type RefereeGovernanceSummary,
} from "@nepal-football-sim/shared-types";
import {
  FederationGovernanceRepository,
  FederationPolicyRepository,
  RefereeGovernanceRepository,
  RefereeDevelopmentRepository,
  TerritorialFootballRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { createStableEntityId } from "@nepal-football-sim/shared-types";

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));

export const validateLeagueFixtures = (input: {
  teamIds: readonly EntityId[];
  fixtures: readonly FixtureRecord[];
  ruleSet: CompetitionRuleSet;
}): FixtureIntegritySummary => {
  const teams = new Set(input.teamIds);
  const rounds = input.ruleSet.homeAwayStructure === "double" ? 2 : 1;
  const expectedMatches =
    (input.teamIds.length * Math.max(0, input.teamIds.length - 1) * rounds) / 2;
  const seen = new Set<string>();
  let duplicatePairings = 0;
  let reversedHomeAway = input.ruleSet.homeAwayStructure !== "double";
  for (const fixture of input.fixtures) {
    if (!teams.has(fixture.homeTeamId) || !teams.has(fixture.awayTeamId)) continue;
    const pair = [fixture.homeTeamId, fixture.awayTeamId].sort().join(":");
    if (seen.has(`${pair}:${fixture.homeTeamId}:${fixture.awayTeamId}`)) duplicatePairings += 1;
    seen.add(`${pair}:${fixture.homeTeamId}:${fixture.awayTeamId}`);
    if (input.ruleSet.homeAwayStructure === "double") {
      const reverse = `${pair}:${fixture.awayTeamId}:${fixture.homeTeamId}`;
      if (seen.has(reverse)) reversedHomeAway = true;
    }
  }
  const actualMatches = input.fixtures.filter(
    (fixture) => teams.has(fixture.homeTeamId) && teams.has(fixture.awayTeamId),
  ).length;
  const missingPairings = Math.max(0, expectedMatches - actualMatches + duplicatePairings);
  return {
    valid: actualMatches === expectedMatches && duplicatePairings === 0 && missingPairings === 0,
    teamCount: input.teamIds.length,
    expectedMatches,
    actualMatches,
    duplicatePairings,
    missingPairings,
    reversedHomeAway,
  };
};

export const reformCanApplyAtBoundary = (input: {
  effectiveSeason: string;
  currentDate: string;
  activeSeasonStart?: string;
  activeSeasonEnd?: string;
}): boolean => {
  if (input.currentDate.slice(0, 4) < input.effectiveSeason) return false;
  if (
    input.activeSeasonStart &&
    input.activeSeasonEnd &&
    input.currentDate >= input.activeSeasonStart &&
    input.currentDate <= input.activeSeasonEnd
  )
    return false;
  return true;
};

export const refereeGovernanceSummary = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
): RefereeGovernanceSummary => {
  const rows = db
    .prepare(
      `SELECT COUNT(*) AS count FROM fixture_official_assignments oa
       JOIN fixtures f ON f.id=oa.fixture_id
       JOIN competition_seasons cs ON cs.id=f.competition_season_id
       JOIN competitions c ON c.id=cs.competition_id
       WHERE oa.assigned_on >= date(?, '-90 day') AND oa.status='ASSIGNED' AND c.federation_id=?`,
    )
    .get(date, federationId) as { count?: number };
  const eventRows = db
    .prepare(
      `SELECT me.type AS type, COUNT(*) AS count FROM match_events me
       JOIN matches m ON m.id=me.match_id JOIN fixtures f ON f.id=m.fixture_id
       JOIN competition_seasons cs ON cs.id=f.competition_season_id
       JOIN competitions c ON c.id=cs.competition_id
       JOIN fixture_official_assignments oa ON oa.fixture_id=f.id
       WHERE oa.assigned_on >= date(?, '-90 day') AND c.federation_id=? GROUP BY me.type`,
    )
    .all(date, federationId) as Array<{ type: string; count: number }>;
  const cards = eventRows
    .filter((row) => row.type.includes("card"))
    .reduce((sum, row) => sum + Number(row.count), 0);
  const fouls = eventRows
    .filter((row) => row.type.includes("foul"))
    .reduce((sum, row) => sum + Number(row.count), 0);
  const varReviews = eventRows
    .filter((row) => row.type.includes("var") || row.type.includes("review"))
    .reduce((sum, row) => sum + Number(row.count), 0);
  new RefereeDevelopmentRepository(db);
  const profiles = db
    .prepare(
      "SELECT AVG(current_quality) AS quality, AVG(consistency) AS consistency FROM referee_development_profiles",
    )
    .get() as { quality?: number; consistency?: number } | undefined;
  const confidence =
    (profiles?.quality ?? 0) >= 70 && (profiles?.consistency ?? 0) >= 65
      ? "STRONG"
      : (profiles?.quality ?? 0) >= 40
        ? "WORKING"
        : "LIMITED";
  const developmentPriority =
    (profiles?.quality ?? 0) < 45
      ? "POOL_DEPTH"
      : (profiles?.consistency ?? 0) < 55
        ? "CONSISTENCY"
        : "MAINTENANCE";
  const trust =
    new FederationGovernanceRepository(db).profile(federationId)?.governanceStability ?? 0;
  const controversyPressure =
    Number(rows?.count ?? 0) === 0 || cards / Math.max(1, Number(rows?.count ?? 0)) < 1.5
      ? "LOW"
      : cards / Math.max(1, Number(rows?.count ?? 0)) < 2.5
        ? "MODERATE"
        : "HIGH";
  return {
    federationId,
    appointmentConfidence: confidence,
    developmentPriority,
    stakeholderTrust: trust >= 7 ? "STRONG" : trust >= 4 ? "WORKING" : "LIMITED",
    recentAssignments: Number(rows?.count ?? 0),
    recentMatchEvents: { cards, fouls, varReviews },
    controversyPressure,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * Closes one event-grounded federation referee review period. The stable
 * federation/date key makes season-boundary retries and save reloads safe.
 * No controversy is inferred from reputation or prose: only assigned fixtures
 * and their persisted match events contribute.
 */
export const recordRefereeGovernanceReview = (
  db: GameDatabase,
  input: { federationId: EntityId; reviewDate: string },
) => {
  const summary = refereeGovernanceSummary(db, input.federationId, input.reviewDate);
  const review = {
    id: createStableEntityId(
      "referee-governance-review",
      `${input.federationId}:${input.reviewDate}`,
    ),
    federationId: input.federationId,
    reviewDate: input.reviewDate,
    assignments: summary.recentAssignments,
    matchEvents: summary.recentMatchEvents,
    appointmentConfidence: summary.appointmentConfidence,
    controversyPressure: summary.controversyPressure ?? "LOW",
    developmentPriority: summary.developmentPriority,
    stakeholderTrust: summary.stakeholderTrust,
    status: "REVIEWED" as const,
    provenanceStatus: "SIMULATION_ONLY" as const,
  };
  new RefereeGovernanceRepository(db).upsert(review);
  return review;
};

export const prioritizeInfrastructure = (input: {
  projectType: FederationProjectType | string;
  districtId?: EntityId;
  provinceId?: EntityId;
  regionalNeed: number;
  facilitiesQuality: number;
  youthPotential: number;
  hotspotLabel: "EMERGING" | "DEVELOPING" | "ESTABLISHED" | "PRIORITY";
  nationalGap: number;
  federationFunds: number;
  governmentSupport: number;
}): InfrastructurePriority => {
  const potential =
    input.hotspotLabel === "PRIORITY"
      ? 70
      : input.hotspotLabel === "ESTABLISHED"
        ? 55
        : input.hotspotLabel === "DEVELOPING"
          ? 40
          : 25;
  const need =
    clamp(input.regionalNeed) +
    clamp(100 - input.facilitiesQuality) * 0.7 +
    clamp(input.nationalGap) * 0.5;
  const value =
    need * 0.45 +
    clamp(input.youthPotential) * 0.2 +
    potential * 0.2 +
    clamp(input.governmentSupport) * 0.15;
  const priorityLabel =
    value >= 75 ? "URGENT" : value >= 55 ? "HIGH" : value >= 35 ? "MEDIUM" : "LOW";
  const rationale = [
    input.regionalNeed >= 60 ? "regional need" : undefined,
    input.facilitiesQuality < 40 ? "facility gap" : undefined,
    input.youthPotential >= 60 ? "youth potential" : undefined,
    potential >= 55 ? "talent development base" : undefined,
  ].filter((item): item is string => Boolean(item));
  return {
    projectType: input.projectType,
    targetDistrictId: input.districtId,
    targetProvinceId: input.provinceId,
    priorityLabel,
    rationale: rationale.length ? rationale : ["balanced national development need"],
    fundingPath:
      input.governmentSupport >= 60 && input.federationFunds < 50
        ? "JOINT_FUNDING"
        : input.governmentSupport >= 60
          ? "GOVERNMENT_SUPPORT"
          : "FEDERATION",
    provenanceStatus: "SIMULATION_ONLY",
  };
};

export const federationInfrastructurePriorities = (
  db: GameDatabase,
  federationId: EntityId,
): InfrastructurePriority[] => {
  const territorial = new TerritorialFootballRepository(db);
  const existing = new FederationGovernanceRepository(db).projects(federationId);
  const policies = new FederationPolicyRepository(db).policies(federationId);
  const gap = policies.filter((policy) => policy.status !== "COMPLETED").length * 8;
  return territorial.districts().map((district) =>
    prioritizeInfrastructure({
      projectType: "REGIONAL_CENTRE",
      districtId: district.id,
      provinceId: district.provinceId,
      regionalNeed: 100 - district.developmentReputation,
      facilitiesQuality: district.groundAvailability,
      youthPotential: district.youthParticipation + district.schoolParticipation / 2,
      hotspotLabel:
        district.youthParticipation >= 50
          ? "PRIORITY"
          : district.youthParticipation >= 30
            ? "DEVELOPING"
            : "EMERGING",
      nationalGap: gap,
      federationFunds:
        existing.filter((project) => project.status === "IMPLEMENTATION").length * 10,
      governmentSupport: 0,
    }),
  );
};
