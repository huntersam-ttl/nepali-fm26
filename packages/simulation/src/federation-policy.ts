import {
  createStableEntityId,
  type FederationCampaign,
  type FederationDevelopmentSummary,
  type FederationElectionCandidate,
  type FederationEndorsement,
  type FederationManifestoCommitment,
  type FederationPolicy,
  type FederationPolicyCategory,
  type FederationOutcomeSummary,
  type FederationStakeholderType,
  type EntityId,
} from "@nepal-football-sim/shared-types";
import {
  FederationGovernancePhaseBRepository,
  FederationGovernanceRepository,
  FederationPolicyRepository,
  GovernmentRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";

const status = "SIMULATION_ONLY" as const;
const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round = (value: number): number => Number(value.toFixed(3));
const developmentBand = (value: number): FederationDevelopmentSummary["band"] =>
  value >= 75
    ? "ESTABLISHED"
    : value >= 50
      ? "PROGRESSING"
      : value >= 25
        ? "BUILDING"
        : "FOUNDATION";

const policyDimension = (category: FederationPolicyCategory): string | undefined =>
  ({
    YOUTH_DEVELOPMENT: "youth",
    WOMENS_DEVELOPMENT: "womenGirls",
    REFEREE_DEVELOPMENT: "refereeing",
    COACHING_EDUCATION: "coaching",
    INFRASTRUCTURE: "infrastructure",
    REGIONAL_DEVELOPMENT: "schoolFootball",
    NATIONAL_TEAM_INVESTMENT: "nationalTeams",
    LEAGUE_STRUCTURE: "competitionQuality",
  })[category];

const emptyRecord = () => ({ fixtures: 0, wins: 0, draws: 0, losses: 0 });

const federationOutcomes = (db: GameDatabase, federationId: EntityId): FederationOutcomeSummary => {
  const teams = db
    .prepare(
      "SELECT id, level, gender FROM teams WHERE federation_id = ? AND club_id IS NULL ORDER BY id",
    )
    .all(federationId) as Array<{ id: EntityId; level: string; gender: string }>;
  const teamKinds = new Map<EntityId, "senior" | "youth" | "women">();
  for (const team of teams) {
    teamKinds.set(
      team.id,
      team.gender === "women" ? "women" : team.level === "senior" ? "senior" : "youth",
    );
  }
  const outcomes = { senior: emptyRecord(), youth: emptyRecord(), women: emptyRecord() };
  const fixtures = new FederationGovernanceRepository(db)
    .nationalTeamFixtures()
    .filter((fixture) => fixture.federationId === federationId && fixture.status === "PLAYED");
  for (const fixture of fixtures) {
    const kind = teamKinds.get(fixture.nationalTeamId);
    if (!kind || fixture.homeGoals === undefined || fixture.awayGoals === undefined) continue;
    const result = outcomes[kind];
    result.fixtures += 1;
    if (fixture.homeGoals > fixture.awayGoals) result.wins += 1;
    else if (fixture.homeGoals === fixture.awayGoals) result.draws += 1;
    else result.losses += 1;
  }
  const nationalAppearances = new FederationGovernanceRepository(db)
    .nationalTeamAppearances()
    .filter((appearance) => teamKinds.has(appearance.nationalTeamId));
  const womenNationalAppearances = nationalAppearances.filter(
    (appearance) => teamKinds.get(appearance.nationalTeamId) === "women",
  ).length;
  const nationalByPlayer = new Map<EntityId, Set<"senior" | "youth">>();
  for (const appearance of nationalAppearances) {
    const kind = teamKinds.get(appearance.nationalTeamId);
    if (kind !== "senior" && kind !== "youth") continue;
    const levels = nationalByPlayer.get(appearance.playerId) ?? new Set();
    levels.add(kind);
    nationalByPlayer.set(appearance.playerId, levels);
  }
  const academyPlayers = db
    .prepare(
      "SELECT DISTINCT player_id FROM generated_player_origins WHERE academy_id IS NOT NULL AND country_id = (SELECT country_id FROM federations WHERE id = ?)",
    )
    .all(federationId) as Array<{ player_id: EntityId }>;
  const academyIds = new Set(academyPlayers.map((row) => row.player_id));
  const intakeEvents = db
    .prepare(
      `SELECT COALESCE(yie.season_label, substr(gpo.generated_on, 1, 4)) AS season_label,
              gpo.player_id
       FROM generated_player_origins gpo
       LEFT JOIN youth_intake_events yie ON yie.id = gpo.intake_event_id
       WHERE gpo.academy_id IS NOT NULL
         AND gpo.country_id = (SELECT country_id FROM federations WHERE id = ?)
       ORDER BY season_label, player_id`,
    )
    .all(federationId) as Array<{ season_label: string; player_id: EntityId }>;
  const playerStats = db
    .prepare(
      `SELECT person_id, SUM(appearances) AS appearances
       FROM player_season_stats pss
       JOIN teams t ON t.id = pss.team_id
       WHERE t.club_id IS NOT NULL
       GROUP BY person_id`,
    )
    .all() as Array<{ person_id: EntityId; appearances: number }>;
  const appearancesByPlayer = new Map(
    playerStats.map((row) => [row.person_id, Number(row.appearances)]),
  );
  const firstTeamDebuts = playerStats.filter((row) => academyIds.has(row.person_id)).length;
  const regularFirstTeamPlayers = playerStats.filter(
    (row) => academyIds.has(row.person_id) && Number(row.appearances) >= 10,
  ).length;
  const youthNationalPlayers = [...academyIds].filter((id) =>
    nationalByPlayer.get(id)?.has("youth"),
  ).length;
  const seniorNationalPlayers = [...academyIds].filter((id) =>
    nationalByPlayer.get(id)?.has("senior"),
  ).length;
  const womenOrigins = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT gpo.player_id
           FROM generated_player_origins gpo
           JOIN persons p ON p.id = gpo.player_id
           WHERE gpo.country_id = (SELECT country_id FROM federations WHERE id = ?)
             AND p.gender_presentation = 'female'`,
        )
        .all(federationId) as Array<{ player_id: EntityId }>
    ).map((row) => row.player_id),
  );
  const womenAcademyProgression = [...womenOrigins].filter(
    (id) => (appearancesByPlayer.get(id) ?? 0) > 0,
  ).length;
  const womenYouthProgression = [...womenOrigins].filter((id) =>
    nationalAppearances.some(
      (appearance) =>
        appearance.playerId === id && teamKinds.get(appearance.nationalTeamId) === "youth",
    ),
  ).length;
  const womenSeniorProgression = [...womenOrigins].filter((id) =>
    nationalAppearances.some(
      (appearance) =>
        appearance.playerId === id && teamKinds.get(appearance.nationalTeamId) === "women",
    ),
  ).length;
  const womenPolicyProgress = new FederationPolicyRepository(db)
    .policies(federationId)
    .filter((policy) => policy.category === "WOMENS_DEVELOPMENT")
    .reduce((max, policy) => Math.max(max, policy.implementationProgress), 0);
  const womenProgress =
    outcomes.women.fixtures + womenNationalAppearances + womenPolicyProgress / 12;
  const girlsDevelopment =
    womenProgress >= 8
      ? "ESTABLISHED"
      : womenProgress >= 4
        ? "PROGRESSING"
        : womenProgress > 0
          ? "BUILDING"
          : "LIMITED";
  const stages = [
    ["academy intake", academyPlayers.length],
    ["first-team debut", firstTeamDebuts],
    ["regular first-team use", regularFirstTeamPlayers],
    ["youth national progression", youthNationalPlayers],
    ["senior national progression", seniorNationalPlayers],
  ] as const;
  const strongest = [...stages].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const weakest = [...stages].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0];
  const academyConversionBySeason = [...new Set(intakeEvents.map((row) => row.season_label))].map(
    (seasonLabel) => {
      const cohort = [
        ...new Set(
          intakeEvents
            .filter((row) => row.season_label === seasonLabel)
            .map((row) => row.player_id),
        ),
      ];
      const cohortSet = new Set(cohort);
      const firstTeam = new Set(
        playerStats
          .filter((row) => cohortSet.has(row.person_id) && Number(row.appearances) > 0)
          .map((row) => row.person_id),
      );
      const regular = new Set(
        playerStats
          .filter((row) => cohortSet.has(row.person_id) && Number(row.appearances) >= 10)
          .map((row) => row.person_id),
      );
      const youth = cohort.filter((id) => nationalByPlayer.get(id)?.has("youth")).length;
      const senior = cohort.filter((id) => nationalByPlayer.get(id)?.has("senior")).length;
      const meaningfulExternalTransfers = cohort.length
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT the.player_id
                 FROM transfer_history_events the
                 JOIN clubs c ON c.id = the.related_club_id
                 JOIN countries co ON co.id = c.country_id
                 WHERE the.event_type = 'TRANSFER_COMPLETED'
                   AND co.iso_code NOT IN ('NP', 'NPL')
                   AND the.player_id IN (${cohort.map(() => "?").join(",")})`,
                )
                .all(...cohort) as Array<{ player_id: EntityId }>
            ).map((row) => row.player_id),
          ).size
        : 0;
      const sampleSize = cohort.length;
      return {
        seasonLabel,
        intakeCount: sampleSize,
        academyGraduates: firstTeam.size,
        firstTeamDebuts: firstTeam.size,
        regularFirstTeamPlayers: regular.size,
        youthNationalCallups: youth,
        seniorNationalCallups: senior,
        meaningfulExternalTransfers,
        sampleSize,
        confidence: (sampleSize >= 10 ? "HIGH" : sampleSize >= 3 ? "MEDIUM" : "LOW") as
          "LOW" | "MEDIUM" | "HIGH",
      };
    },
  );
  const support =
    new FederationPolicyRepository(db)
      .policies(federationId)
      .some(
        (policy) => policy.category === "WOMENS_DEVELOPMENT" && policy.implementationProgress > 0,
      ) ||
    Boolean(
      db
        .prepare(
          "SELECT 1 FROM federation_projects WHERE federation_id = ? AND project_type = 'WOMENS_DEVELOPMENT' AND status = 'COMPLETED' LIMIT 1",
        )
        .get(federationId),
    );
  return {
    senior: outcomes.senior,
    youth: outcomes.youth,
    women: outcomes.women,
    pathway: {
      academyPlayers: academyPlayers.length,
      firstTeamDebuts,
      regularFirstTeamPlayers,
      youthNationalPlayers,
      seniorNationalPlayers,
    },
    academyConversionBySeason,
    womenProgramme: {
      participationBand: girlsDevelopment,
      intakeCount: womenOrigins.size,
      academyProgression: womenAcademyProgression,
      youthNationalProgression: womenYouthProgression,
      seniorNationalProgression: womenSeniorProgression,
      coachingInfrastructureSupport: support ? "PRESENT" : "LIMITED",
    },
    girlsDevelopment,
    strongestPathwayStage: strongest,
    weakestPathwayStage: weakest,
  };
};

const CATEGORY_MAP: Record<string, FederationPolicyCategory> = {
  YOUTH_ELITE_DEVELOPMENT: "YOUTH_DEVELOPMENT",
  GRASSROOTS_EXPANSION: "REGIONAL_DEVELOPMENT",
  WOMENS_FOOTBALL: "WOMENS_DEVELOPMENT",
  COACH_EDUCATION: "COACHING_EDUCATION",
  INFRASTRUCTURE: "INFRASTRUCTURE",
  REFEREE_DEVELOPMENT: "REFEREE_DEVELOPMENT",
  NATIONAL_TEAM_PERFORMANCE: "NATIONAL_TEAM_INVESTMENT",
  CLUB_PROFESSIONALISATION: "LEAGUE_STRUCTURE",
};

export const policyCategoryForManifesto = (key: string): FederationPolicyCategory | undefined =>
  CATEGORY_MAP[key];

export const campaignSupportEstimate = (input: {
  candidate: FederationElectionCandidate;
  endorsements?: FederationEndorsement[];
  previousPerformance?: number;
  policyAlignment?: number;
  promiseRecord?: { fulfilled: number; broken: number };
}): number => {
  const endorsements = (input.endorsements ?? []).reduce(
    (sum, item) => sum + clamp(item.support, -1, 1) * 7,
    0,
  );
  const promises =
    (input.promiseRecord?.fulfilled ?? 0) * 3 - (input.promiseRecord?.broken ?? 0) * 5;
  const value =
    input.candidate.supportBase * 7 +
    input.candidate.reputation * 5 +
    input.candidate.committeeInfluence * 12 +
    Object.values(input.candidate.votingBlocs).reduce((sum, item) => sum + item, 0) * 4 +
    (input.previousPerformance ?? 0) * 0.15 +
    (input.policyAlignment ?? 0) * 0.15 +
    endorsements +
    promises;
  return round(clamp(value));
};

export const startFederationCampaign = (
  db: GameDatabase,
  input: {
    candidate: FederationElectionCandidate;
    date: string;
    platform?: Partial<Record<FederationPolicyCategory, number>>;
  },
): FederationCampaign => {
  const platform = Object.fromEntries(
    Object.keys(CATEGORY_MAP).map((key) => [
      CATEGORY_MAP[key],
      clamp(input.platform?.[CATEGORY_MAP[key]] ?? input.candidate.manifesto[key] ?? 0, 0, 1),
    ]),
  ) as Record<FederationPolicyCategory, number>;
  const repository = new FederationPolicyRepository(db);
  const existing = repository
    .campaigns(input.candidate.cycleId)
    .find((item) => item.candidateId === input.candidate.id);
  if (existing) return existing;
  const campaign: FederationCampaign = {
    id: createStableEntityId(
      "federation-campaign",
      `${input.candidate.cycleId}:${input.candidate.id}`,
    ),
    cycleId: input.candidate.cycleId,
    federationId: input.candidate.federationId,
    candidateId: input.candidate.id,
    platform,
    campaignEvents: [],
    supportEstimate: campaignSupportEstimate({ candidate: input.candidate }),
    status: "ACTIVE",
    updatedOn: input.date,
    provenanceStatus: status,
  };
  repository.upsertCampaign(campaign);
  return campaign;
};

export const recordFederationCampaignEvent = (
  db: GameDatabase,
  input: {
    campaignId: EntityId;
    date: string;
    type: FederationCampaign["campaignEvents"][number]["type"];
    summary: string;
  },
): FederationCampaign => {
  const repository = new FederationPolicyRepository(db);
  const campaign = repository.campaigns().find((item) => item.id === input.campaignId);
  if (!campaign) throw new Error("Federation campaign not found");
  const event = { date: input.date, type: input.type, summary: input.summary };
  const next = {
    ...campaign,
    campaignEvents: [...campaign.campaignEvents, event].slice(-12),
    updatedOn: input.date,
  };
  repository.upsertCampaign(next);
  return next;
};

export const recordFederationEndorsement = (
  db: GameDatabase,
  input: {
    campaignId: EntityId;
    candidateId: EntityId;
    stakeholderType: FederationStakeholderType;
    stakeholderId?: EntityId;
    support: number;
    reason: string;
    date: string;
  },
): FederationEndorsement => {
  const endorsement: FederationEndorsement = {
    id: createStableEntityId(
      "federation-endorsement",
      `${input.campaignId}:${input.stakeholderType}:${input.stakeholderId ?? "general"}`,
    ),
    campaignId: input.campaignId,
    candidateId: input.candidateId,
    stakeholderType: input.stakeholderType,
    stakeholderId: input.stakeholderId,
    support: clamp(input.support, -1, 1),
    reason: input.reason,
    endorsedOn: input.date,
    provenanceStatus: status,
  };
  new FederationPolicyRepository(db).upsertEndorsement(endorsement);
  return endorsement;
};

export const createFederationPolicy = (
  db: GameDatabase,
  input: Omit<FederationPolicy, "id" | "provenanceStatus"> & { id?: EntityId },
): FederationPolicy => {
  const policy: FederationPolicy = {
    ...input,
    id:
      input.id ??
      createStableEntityId(
        "federation-policy",
        `${input.federationId}:${input.category}:${input.startDate}:${input.title}`,
      ),
    provenanceStatus: status,
    implementationProgress: clamp(input.implementationProgress),
  };
  new FederationPolicyRepository(db).upsertPolicy(policy);
  return policy;
};

export const activateManifestoPolicies = (
  db: GameDatabase,
  commitments: FederationManifestoCommitment[],
): FederationPolicy[] =>
  commitments.map((commitment) =>
    createFederationPolicy(db, {
      federationId: commitment.federationId,
      category: policyCategoryForManifesto(commitment.policyArea) ?? "REGIONAL_DEVELOPMENT",
      title: commitment.promise,
      status: "PROPOSED",
      startDate: commitment.lastUpdated,
      fundingCommitted: 0,
      implementationProgress: commitment.progress,
      targetValue: commitment.targetValue,
      effects: {},
      sourceCommitmentId: commitment.id,
    }),
  );

export const advanceFederationPolicies = (
  db: GameDatabase,
  input: { federationId: EntityId; date: string; seasonalProgress?: number },
): FederationPolicy[] => {
  const repository = new FederationPolicyRepository(db);
  const progressed: FederationPolicy[] = [];
  for (const policy of repository.policies(input.federationId)) {
    // A proposal has no implementation outcome until it is funded.  Keeping
    // this gate here prevents an unapproved manifesto commitment from
    // accumulating progress during the seasonal simulation pass.
    if (policy.status !== "FUNDED" && policy.status !== "IMPLEMENTING") continue;
    const increment = clamp(input.seasonalProgress ?? 12, 1, 25);
    const progress = clamp(policy.implementationProgress + increment);
    const next: FederationPolicy = {
      ...policy,
      implementationProgress: progress,
      status:
        progress >= policy.targetValue
          ? "COMPLETED"
          : progress > 0
            ? "IMPLEMENTING"
            : policy.status,
      endDate: progress >= policy.targetValue ? input.date : policy.endDate,
    };
    repository.upsertPolicy(next);
    progressed.push(next);
  }
  return progressed;
};

export const federationDevelopmentSummary = (
  db: GameDatabase,
  federationId: EntityId,
  date: string,
): FederationDevelopmentSummary => {
  const governance = new FederationGovernanceRepository(db);
  const policies = new FederationPolicyRepository(db).policies(federationId);
  const active = policies.filter(
    (policy) => policy.status === "IMPLEMENTING" || policy.status === "COMPLETED",
  );
  const strengths: string[] = active
    .filter((policy) => policy.implementationProgress >= policy.targetValue)
    .slice(0, 4)
    .map((policy) => policy.category);
  const priorities = policies
    .filter((policy) => policy.status !== "COMPLETED")
    .slice(0, 4)
    .map((policy) => policy.category);
  const averageProgress = policies.length
    ? policies.reduce((sum, policy) => sum + policy.implementationProgress, 0) / policies.length
    : 0;
  const governmentTrust =
    new GovernmentRepository(db)
      .relationships()
      .filter((item) => item.entityId === federationId)
      .map((item) => item.trust)[0] ?? 0;
  const governanceProfile = governance.profile(federationId);
  const outcomes = federationOutcomes(db, federationId);
  if (governanceProfile && strengths.length === 0 && governanceProfile.reputation >= 7)
    strengths.push("governance stability");
  const dimensionScores: Record<string, number> = {
    youth: clamp(governanceProfile?.youthDevelopment ?? averageProgress / 10) * 10,
    schoolFootball: clamp(governanceProfile?.grassrootsDevelopment ?? averageProgress / 10) * 10,
    talentHotspots: clamp(governanceProfile?.grassrootsDevelopment ?? averageProgress / 10) * 10,
    coaching: clamp(governanceProfile?.coachEducation ?? averageProgress / 10) * 10,
    refereeing: clamp(governanceProfile?.refereeDevelopment ?? averageProgress / 10) * 10,
    infrastructure: clamp(governanceProfile?.infrastructureLevel ?? averageProgress / 10) * 10,
    womenGirls: clamp(governanceProfile?.grassrootsDevelopment ?? averageProgress / 10) * 10,
    nationalTeams: clamp(governanceProfile?.internationalRelations ?? averageProgress / 10) * 10,
    competitionQuality:
      clamp(governanceProfile?.competitionOrganisation ?? averageProgress / 10) * 10,
    commercialStrength: clamp(governanceProfile?.commercialStrength ?? averageProgress / 10) * 10,
  };
  const impactSummaries: string[] = [];

  const resultSignal = (record: typeof outcomes.senior): number =>
    record.fixtures > 0
      ? clamp(((record.wins + record.draws * 0.5) / record.fixtures) * 100)
      : 0;
  const addOutcomeSignal = (dimension: string, value: number, label: string): void => {
    const bounded = clamp(value, -6, 6);
    if (bounded === 0) return;
    dimensionScores[dimension] = clamp(dimensionScores[dimension] + bounded);
    impactSummaries.push(`${label}: ${bounded > 0 ? "positive" : "negative"} outcome signal`);
  };

  // Results and pathway achievements are outcome signals, separate from the
  // policy/project progress signals below. They are deliberately capped so a
  // large historical database cannot overwhelm the slow-moving profile base.
  if (outcomes.senior.fixtures > 0)
    addOutcomeSignal(
      "nationalTeams",
      (resultSignal(outcomes.senior) - 50) * 0.12,
      "Senior national-team results",
    );
  if (outcomes.youth.fixtures > 0)
    addOutcomeSignal(
      "youth",
      (resultSignal(outcomes.youth) - 50) * 0.12,
      "Youth national-team results",
    );
  if (outcomes.women.fixtures > 0)
    addOutcomeSignal(
      "womenGirls",
      (resultSignal(outcomes.women) - 50) * 0.12,
      "Women national-team results",
    );

  const pathwaySignal = Math.min(
    6,
    outcomes.pathway.firstTeamDebuts * 0.25 +
      outcomes.pathway.regularFirstTeamPlayers * 0.45 +
      outcomes.pathway.youthNationalPlayers * 0.35 +
      outcomes.pathway.seniorNationalPlayers * 0.5,
  );
  addOutcomeSignal("youth", pathwaySignal, "Academy pathway outcomes");

  const womenPathwaySignal = Math.min(
    6,
    outcomes.womenProgramme.academyProgression * 0.3 +
      outcomes.womenProgramme.youthNationalProgression * 0.45 +
      outcomes.womenProgramme.seniorNationalProgression * 0.6,
  );
  addOutcomeSignal("womenGirls", womenPathwaySignal, "Women/girls pathway outcomes");

  const completedProjects = governance
    .projects(federationId)
    .filter((project) => project.status === "COMPLETED").length;
  addOutcomeSignal(
    "infrastructure",
    Math.min(4, completedProjects * 0.75),
    "Completed federation projects",
  );

  for (const policy of policies.filter((item) => item.implementationProgress > 0)) {
    const dimension = policyDimension(policy.category);
    if (!dimension) continue;
    // Policy progress is an outcome signal, not a second project/profile
    // increment. Its contribution is deliberately capped and proportional.
    const contribution = Math.min(8, policy.implementationProgress * 0.08);
    dimensionScores[dimension] = clamp(dimensionScores[dimension] + contribution, 0, 100);
    impactSummaries.push(
      `${policy.category}: ${Math.round(policy.implementationProgress)}% implemented`,
    );
  }
  const dimensions = Object.fromEntries(
    Object.entries(dimensionScores).map(([key, value]) => [key, developmentBand(value)]),
  );
  const overallScore =
    Object.values(dimensionScores).reduce((sum, value) => sum + value, 0) /
    Object.keys(dimensionScores).length;
  const positiveOutcome = impactSummaries.some((summary) => summary.includes("positive outcome"));
  const negativeOutcome = impactSummaries.some((summary) => summary.includes("negative outcome"));
  const trend = policies.some(
    (policy) => policy.status === "IMPLEMENTING" && policy.implementationProgress > 0,
  ) || (positiveOutcome && !negativeOutcome)
    ? "IMPROVING"
    : negativeOutcome && !positiveOutcome
      ? "DECLINING"
      : "STABLE";
  return {
    federationId,
    band: developmentBand(overallScore),
    dimensions,
    trend,
    strengths,
    priorities,
    impactSummaries: impactSummaries.slice(0, 8),
    outcomes,
    governmentRelationship:
      governmentTrust >= 70 ? "STRONG" : governmentTrust >= 40 ? "WORKING" : "LIMITED",
    asOf: date,
    provenanceStatus: status,
  };
};
