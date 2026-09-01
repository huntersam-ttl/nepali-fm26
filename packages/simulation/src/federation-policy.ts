import {
  createStableEntityId,
  type FederationCampaign,
  type FederationDevelopmentSummary,
  type FederationElectionCandidate,
  type FederationEndorsement,
  type FederationManifestoCommitment,
  type FederationPolicy,
  type FederationPolicyCategory,
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
    if (policy.status === "COMPLETED" || policy.status === "SUSPENDED") continue;
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
  const band =
    averageProgress >= 75
      ? "ESTABLISHED"
      : averageProgress >= 50
        ? "PROGRESSING"
        : averageProgress >= 25
          ? "BUILDING"
          : "FOUNDATION";
  const governmentTrust =
    new GovernmentRepository(db)
      .relationships()
      .filter((item) => item.entityId === federationId)
      .map((item) => item.trust)[0] ?? 0;
  const governanceProfile = governance.profile(federationId);
  if (governanceProfile && strengths.length === 0 && governanceProfile.reputation >= 7)
    strengths.push("governance stability");
  return {
    federationId,
    band,
    strengths,
    priorities,
    governmentRelationship:
      governmentTrust >= 70 ? "STRONG" : governmentTrust >= 40 ? "WORKING" : "LIMITED",
    asOf: date,
    provenanceStatus: status,
  };
};
