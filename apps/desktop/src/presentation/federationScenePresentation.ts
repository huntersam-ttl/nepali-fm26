import type { FederationPresidentDashboard, FederationProjectType } from "@nepal-football-sim/shared-types";
import type { SiteGeography } from "./clubScenePresentation.js";

/**
 * Derives the Federation Environment scene purely from the President's real,
 * canonical federation state — the same simulation profile scores, projects
 * and finances the President dashboard already reads. Nothing here is
 * decorative: a federation with weak recorded development scores renders as
 * a modest HQ and national centre, and only real numbers justify a larger,
 * more developed federation campus.
 *
 * Deliberately mirrors clubScenePresentation.ts's "state -> visual
 * descriptor" pattern (renderer-agnostic, unit-testable without a GPU) so
 * both surfaces share the same honesty and determinism guarantees.
 */

export type FederationVisualTier = "UNDEVELOPED" | "BASIC" | "MODEST" | "PROFESSIONAL" | "ADVANCED" | "ELITE";

const FEDERATION_TIER_LABEL: Record<FederationVisualTier, string> = {
  UNDEVELOPED: "No development on record",
  BASIC: "Basic",
  MODEST: "Modest",
  PROFESSIONAL: "Professional",
  ADVANCED: "Advanced",
  ELITE: "Elite",
};

export const federationTierLabel = (tier: FederationVisualTier): string => FEDERATION_TIER_LABEL[tier];

/** FederationSimulationProfile's scores are real 0-100 figures (unlike a
 * club's 0-20 facility quality), so this uses its own bands rather than
 * reusing facilityTierForQuality's scale. */
export const federationTierForScore = (score: number | undefined): FederationVisualTier => {
  if (score === undefined || score <= 0) return "UNDEVELOPED";
  if (score >= 80) return "ELITE";
  if (score >= 60) return "ADVANCED";
  if (score >= 40) return "PROFESSIONAL";
  if (score >= 20) return "MODEST";
  return "BASIC";
};

export type FederationBuildingKind = "HQ" | "NATIONAL_CENTRE";

/** Which real federation project types physically sit on which block. A
 * project with no real mapping (none today) is simply not shown — never a
 * fabricated construction state. */
const BLOCK_FOR_PROJECT_TYPE: Record<FederationProjectType, FederationBuildingKind> = {
  NATIONAL_TRAINING_CENTRE: "NATIONAL_CENTRE",
  REGIONAL_CENTRE: "NATIONAL_CENTRE",
  ACADEMY_EXPANSION: "NATIONAL_CENTRE",
  WOMENS_DEVELOPMENT: "NATIONAL_CENTRE",
  COACH_EDUCATION: "NATIONAL_CENTRE",
  REFEREE_PROGRAMME: "NATIONAL_CENTRE",
  GRASSROOTS_PROGRAMME: "HQ",
  DIGITAL_BROADCAST: "HQ",
  CLUB_SUPPORT_PROGRAMME: "HQ",
};

const BUILDING_PROJECT_STATUSES = new Set(["CONSTRUCTION", "IMPLEMENTATION"]);
const PLANNED_PROJECT_STATUSES = new Set(["IDEA", "PLANNING", "FINANCING"]);

export type FederationSceneBuilding = {
  kind: FederationBuildingKind;
  tier: FederationVisualTier;
  underConstruction: boolean;
  planned: boolean;
  statusLabel: string;
};

export type FederationSceneProfile = {
  federationId: string;
  federationName: string;
  hq: FederationSceneBuilding;
  nationalCentre: FederationSceneBuilding;
  /** Real practice-pitch count for the national centre, from youth and
   * coach-education development — never a fixed decoration. */
  nationalCentrePitchCount: number;
  /** A small referee-development marker, present only when the federation's
   * real recorded referee development score justifies it. */
  refereeDevelopmentPresent: boolean;
  /** True only when a real WOMENS_DEVELOPMENT project exists (any status)
   * — never inferred from unrelated scores. */
  womensProgrammePresent: boolean;
  /** No canonical federation HQ district exists in current state, so this
   * is honestly UNKNOWN unless a future data source resolves it — never a
   * hardcoded "Kathmandu" claim. */
  geography: SiteGeography;
  /** 0-1, from real federation reputation. */
  prestige: number;
  accentHue: number;
  seed: number;
  summary: string[];
};

const stableSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

const BUILDING_LABEL: Record<FederationBuildingKind, string> = {
  HQ: "Federation headquarters",
  NATIONAL_CENTRE: "National football centre",
};

export const buildFederationSceneProfile = (dashboard: FederationPresidentDashboard): FederationSceneProfile => {
  const federationId = String(dashboard.federation.id);
  const seed = stableSeed(federationId);
  const profile = dashboard.profile;

  const projectByBlock = new Map<FederationBuildingKind, (typeof dashboard.projects)[number]>();
  for (const project of dashboard.projects) {
    const block = BLOCK_FOR_PROJECT_TYPE[project.projectType];
    if (!block) continue;
    const existing = projectByBlock.get(block);
    if (existing && BUILDING_PROJECT_STATUSES.has(existing.status)) continue;
    projectByBlock.set(block, project);
  }

  const buildingFor = (kind: FederationBuildingKind, score: number | undefined): FederationSceneBuilding => {
    const tier = federationTierForScore(score);
    const project = projectByBlock.get(kind);
    const underConstruction = Boolean(project && BUILDING_PROJECT_STATUSES.has(project.status));
    const planned = Boolean(project && PLANNED_PROJECT_STATUSES.has(project.status));
    const statusLabel = underConstruction
      ? `${BUILDING_LABEL[kind]}: under construction`
      : planned
        ? `${BUILDING_LABEL[kind]}: project planned`
        : `${BUILDING_LABEL[kind]}: ${federationTierLabel(tier).toLowerCase()}`;
    return { kind, tier, underConstruction, planned, statusLabel };
  };

  // HQ reads from institutional/administrative strength; the national
  // centre reads from football-development strength — two genuinely
  // different real inputs, so they do not just track each other.
  const hqScore = profile
    ? (profile.governanceStability + profile.commercialStrength + profile.infrastructureLevel) / 3
    : undefined;
  const centreScore = profile
    ? (profile.youthDevelopment + profile.coachEducation + profile.infrastructureLevel) / 3
    : undefined;

  const hq = buildingFor("HQ", hqScore);
  const nationalCentre = buildingFor("NATIONAL_CENTRE", centreScore);
  const nationalCentrePitchCount =
    nationalCentre.tier === "ELITE"
      ? 4
      : nationalCentre.tier === "ADVANCED"
        ? 3
        : nationalCentre.tier === "PROFESSIONAL" || nationalCentre.tier === "MODEST"
          ? 2
          : nationalCentre.tier === "BASIC"
            ? 1
            : 0;

  const refereeDevelopmentPresent = (profile?.refereeDevelopment ?? 0) >= 20;
  const womensProgrammePresent = dashboard.projects.some((project) => project.projectType === "WOMENS_DEVELOPMENT");

  const prestige = Math.max(0, Math.min(1, (profile?.reputation ?? 0) / 100));

  const summary = [
    hq.statusLabel,
    nationalCentre.statusLabel,
    `National centre practice pitches: ${nationalCentrePitchCount}`,
    refereeDevelopmentPresent
      ? "Referee development: active technical programme"
      : "Referee development: not yet established",
    womensProgrammePresent
      ? "Women's & girls' development: active federation project"
      : "Women's & girls' development: no active project on record",
    `Federation reputation ${profile?.reputation ?? 0} of 100`,
  ];

  return {
    federationId,
    federationName: dashboard.federation.name,
    hq,
    nationalCentre,
    nationalCentrePitchCount,
    refereeDevelopmentPresent,
    womensProgrammePresent,
    // No canonical federation HQ district in current simulation state.
    geography: "UNKNOWN",
    prestige,
    accentHue: seed % 360,
    seed,
    summary,
  };
};
