import type { ClubCampusProject, ClubProfile } from "@nepal-football-sim/shared-types";

/**
 * Derives the Club Environment scene purely from a club's real, canonical
 * state — stadium record, facility-quality snapshot, reputation, and its own
 * active infrastructure projects. Nothing here is decorative: a semi-pro club
 * with no facility data renders as a small ground with undeveloped land, and
 * only a club whose real numbers justify it gets a large, developed campus.
 *
 * This module is deliberately renderer-agnostic and side-effect free: it is
 * the same "state -> visual descriptor" pattern clubWorldPresentation.ts
 * already uses for the 2D campus, so both surfaces agree, and so the scene
 * can be unit-tested without a GPU.
 */

/** Stadium size/finish bands, from a village ground up to a venue that could
 * host a final. Mapped from real capacity plus the recorded venue fields. */
export type StadiumVisualTier =
  | "LOCAL_GROUND"
  | "BASIC_VENUE"
  | "ESTABLISHED"
  | "MODERN_LARGE"
  | "ELITE";

/** Shared band for any facility building. UNDEVELOPED is a real, honest
 * state (no facility data and no project), not a hidden/absent one. */
export type FacilityVisualTier =
  | "UNDEVELOPED"
  | "BASIC"
  | "MODEST"
  | "PROFESSIONAL"
  | "ADVANCED"
  | "ELITE";

/** How built-up the surrounding site reads — drives ground clutter, roads and
 * vegetation density, never a fixed decorative layout. */
export type SiteDevelopment = "OPEN_LAND" | "SPARSE" | "DEVELOPED" | "URBAN";

/**
 * Broad terrain identity for the club's real recorded district, so Nepal's
 * campuses read as Nepal rather than generic flat terrain. This is a real
 * classification of well-known Nepali geography (which districts sit in the
 * Kathmandu valley or the Terai plains), not an invented location — but the
 * exact site the campus sits on within that district is still unknown, so
 * the result stays an honest terrain *identity*, never a claim of the real
 * site's precise geography.
 */
export type SiteGeography = "KATHMANDU_VALLEY" | "TERAI" | "HILL" | "UNKNOWN";

const KATHMANDU_VALLEY_DISTRICTS = ["kathmandu", "lalitpur", "bhaktapur"];
// A representative, non-exhaustive set of Nepal's well-known Terai (flat
// southern plains) districts — everything else recorded falls back to HILL,
// which is geographically correct for the great majority of the country.
const TERAI_DISTRICTS = [
  "jhapa",
  "morang",
  "sunsari",
  "saptari",
  "siraha",
  "dhanusa",
  "mahottari",
  "sarlahi",
  "rautahat",
  "bara",
  "parsa",
  "chitwan",
  "nawalparasi",
  "rupandehi",
  "kapilvastu",
  "dang",
  "banke",
  "bardiya",
  "kailali",
  "kanchanpur",
];

/** Classifies from the club's recorded location label alone — real district
 * names, matched case-insensitively; anything unrecognised or absent stays
 * UNKNOWN rather than guessing. */
export const siteGeographyForLocation = (locationLabel: string | undefined): SiteGeography => {
  if (!locationLabel) return "UNKNOWN";
  const normalized = locationLabel.toLowerCase();
  if (KATHMANDU_VALLEY_DISTRICTS.some((district) => normalized.includes(district))) return "KATHMANDU_VALLEY";
  if (TERAI_DISTRICTS.some((district) => normalized.includes(district))) return "TERAI";
  return "HILL";
};

export type SceneBuildingKind = "STADIUM" | "TRAINING" | "ACADEMY" | "MEDICAL" | "OFFICES";

/** One physical building in the scene, with the real state that put it there. */
export type SceneBuilding = {
  kind: SceneBuildingKind;
  tier: FacilityVisualTier;
  /** The real 0-20 facility quality behind `tier`, when the club has one. */
  quality?: number;
  /** True when a real infrastructure project is currently building here —
   * the scene shows scaffolding rather than a finished upgrade. */
  underConstruction: boolean;
  /** A real project on this block that has not started building yet. */
  planned: boolean;
  /** Plain-language status, reused verbatim by the accessible text summary
   * so the scene never carries information the DOM does not also state. */
  statusLabel: string;
  /** Present only when a real, clickable project sits on this block. */
  project?: ClubCampusProject;
};

export type ClubSceneProfile = {
  clubId: string;
  clubName: string;
  stadium: {
    tier: StadiumVisualTier;
    /** 1-4 real stands, scaled from recorded capacity. */
    standCount: number;
    floodlights: boolean;
    roofed: boolean;
    capacity?: number;
    /** True when the venue is only the nearest known ground, not a confirmed
     * home ground — the scene must not imply ownership the data doesn't have. */
    provisionalVenue: boolean;
    label: string;
  };
  buildings: SceneBuilding[];
  site: SiteDevelopment;
  geography: SiteGeography;
  /** 0-1, from real football reputation. Drives lighting warmth/prestige only. */
  prestige: number;
  /** Deterministic hue (0-360) from the club id. SIMULATION_ONLY: this is a
   * stable accent so two clubs look different, never a claim about the club's
   * real colours, which this game does not hold data for. */
  accentHue: number;
  /** Stable per-club seed so procedural placement is identical every launch. */
  seed: number;
  /** Every fact the scene shows, in words, for the text summary and a11y. */
  summary: string[];
};

/** Small, stable string hash. Same club id always yields the same layout. */
const stableSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

/** Matches the bands clubWorldPresentation.ts already uses for the 2D campus,
 * so a block never reads "Elite" in one surface and "Adequate" in the other. */
export const facilityTierForQuality = (quality: number | undefined): FacilityVisualTier => {
  if (quality === undefined || quality <= 0) return "UNDEVELOPED";
  if (quality >= 16) return "ELITE";
  if (quality >= 13) return "ADVANCED";
  if (quality >= 9) return "PROFESSIONAL";
  if (quality >= 5) return "MODEST";
  return "BASIC";
};

const FACILITY_TIER_LABEL: Record<FacilityVisualTier, string> = {
  UNDEVELOPED: "No facility on record",
  BASIC: "Basic",
  MODEST: "Modest",
  PROFESSIONAL: "Professional",
  ADVANCED: "Advanced",
  ELITE: "Elite",
};

export const facilityTierLabel = (tier: FacilityVisualTier): string => FACILITY_TIER_LABEL[tier];

/**
 * Stadium band from real capacity, with the recorded venue quality only ever
 * able to hold a venue back, never inflate it: a 40,000-seat ground with a
 * poor pitch and no floodlights is still a big stadium, but it does not read
 * as an elite modern one.
 */
export const stadiumTierForVenue = (stadium: ClubProfile["stadium"]): StadiumVisualTier => {
  const capacity = stadium?.capacity ?? 0;
  if (capacity <= 0) return "LOCAL_GROUND";
  const base: StadiumVisualTier =
    capacity >= 40000
      ? "ELITE"
      : capacity >= 20000
        ? "MODERN_LARGE"
        : capacity >= 8000
          ? "ESTABLISHED"
          : capacity >= 2000
            ? "BASIC_VENUE"
            : "LOCAL_GROUND";
  // A venue with neither floodlights nor covered stands cannot present as a
  // modern elite arena however big it is.
  if ((base === "ELITE" || base === "MODERN_LARGE") && !stadium?.floodlights && !stadium?.coveredStands) {
    return "ESTABLISHED";
  }
  return base;
};

const STADIUM_TIER_LABEL: Record<StadiumVisualTier, string> = {
  LOCAL_GROUND: "Small local ground",
  BASIC_VENUE: "Basic professional venue",
  ESTABLISHED: "Established stadium",
  MODERN_LARGE: "Modern large venue",
  ELITE: "Elite venue",
};

export const stadiumTierLabel = (tier: StadiumVisualTier): string => STADIUM_TIER_LABEL[tier];

/** Real stands, not decoration: one per ~8,000 recorded seats, capped at the
 * four sides a ground physically has. A capacity-less venue shows one stand. */
const standCountForCapacity = (capacity: number | undefined): number =>
  capacity && capacity > 0 ? Math.min(4, Math.max(1, Math.round(capacity / 8000))) : 1;

/** Which campus block each real project type physically sits on. Mirrors
 * clubWorldPresentation.ts's mapping so the two surfaces never disagree. */
const BLOCK_FOR_PROJECT_TYPE: Record<string, SceneBuildingKind> = {
  TRAINING_GROUND: "TRAINING",
  GYM: "TRAINING",
  ANALYSIS_ROOM: "TRAINING",
  MEDICAL_ROOM: "MEDICAL",
  RECOVERY_CENTRE: "MEDICAL",
  ACADEMY: "ACADEMY",
  OFFICE: "OFFICES",
  SCOUTING_DEPARTMENT: "OFFICES",
  STADIUM: "STADIUM",
  STAND: "STADIUM",
  FLOODLIGHTS: "STADIUM",
  PITCH: "STADIUM",
  DRAINAGE: "STADIUM",
  REFURBISHMENT: "STADIUM",
};

const BUILDING_PROJECT_STATUSES = new Set(["CONSTRUCTION"]);
const PLANNED_PROJECT_STATUSES = new Set(["IDEA", "PLANNING", "APPROVED", "FINANCING"]);

const BUILDING_LABEL: Record<SceneBuildingKind, string> = {
  STADIUM: "Stadium",
  TRAINING: "Training ground",
  ACADEMY: "Academy",
  MEDICAL: "Medical centre",
  OFFICES: "Club offices",
};

/** Site build-up from real reputation and how much of the campus actually
 * exists — a club with nothing built sits on open land. */
const siteDevelopmentFor = (prestige: number, developedBlocks: number): SiteDevelopment => {
  if (developedBlocks === 0) return "OPEN_LAND";
  if (prestige >= 0.6 && developedBlocks >= 3) return "URBAN";
  if (developedBlocks >= 2) return "DEVELOPED";
  return "SPARSE";
};

export const buildClubSceneProfile = (profile: ClubProfile): ClubSceneProfile => {
  const clubId = String(profile.entityReference.id);
  const seed = stableSeed(clubId);
  const snapshot = profile.facilitySnapshot;
  const prestige = Math.max(0, Math.min(1, (profile.reputation?.footballReputation ?? 0) / 100));
  const geography = siteGeographyForLocation(profile.locationLabel);

  const projectByBlock = new Map<SceneBuildingKind, ClubCampusProject>();
  for (const project of profile.campusProjects) {
    const block = BLOCK_FOR_PROJECT_TYPE[project.projectType];
    if (!block) continue;
    // A project actually building outranks one merely planned on the same block.
    const existing = projectByBlock.get(block);
    if (existing && BUILDING_PROJECT_STATUSES.has(existing.status)) continue;
    projectByBlock.set(block, project);
  }

  const qualityFor = (kind: SceneBuildingKind): number | undefined => {
    if (!snapshot) return undefined;
    if (kind === "TRAINING") return snapshot.trainingFacilityQuality;
    if (kind === "ACADEMY") return snapshot.youthFacilityQuality;
    if (kind === "MEDICAL") return snapshot.medicalFacilityQuality;
    if (kind === "OFFICES") return snapshot.analyticsFacilityQuality;
    return undefined;
  };

  const buildings: SceneBuilding[] = (["TRAINING", "ACADEMY", "MEDICAL", "OFFICES"] as const).map((kind) => {
    const quality = qualityFor(kind);
    const tier = facilityTierForQuality(quality);
    const project = projectByBlock.get(kind);
    const underConstruction = Boolean(project && BUILDING_PROJECT_STATUSES.has(project.status));
    const planned = Boolean(project && PLANNED_PROJECT_STATUSES.has(project.status));
    const statusLabel = underConstruction
      ? `${BUILDING_LABEL[kind]}: under construction`
      : planned
        ? `${BUILDING_LABEL[kind]}: project planned`
        : `${BUILDING_LABEL[kind]}: ${facilityTierLabel(tier).toLowerCase()}`;
    return { kind, tier, quality, underConstruction, planned, statusLabel, project };
  });

  const stadiumProject = projectByBlock.get("STADIUM");
  const stadiumTier = stadiumTierForVenue(profile.stadium);
  const standCount = standCountForCapacity(profile.stadium?.capacity);
  const developedBlocks = buildings.filter((building) => building.tier !== "UNDEVELOPED").length;

  const stadiumStatus = stadiumProject && BUILDING_PROJECT_STATUSES.has(stadiumProject.status)
    ? "stadium work under construction"
    : stadiumProject && PLANNED_PROJECT_STATUSES.has(stadiumProject.status)
      ? "stadium project planned"
      : undefined;

  const stadiumLabel = profile.stadium
    ? `${profile.stadium.name} — ${stadiumTierLabel(stadiumTier).toLowerCase()}${
        profile.stadium.capacity ? `, capacity ${profile.stadium.capacity.toLocaleString()}` : ", capacity not on record"
      }${profile.stadium.confirmedHomeGround ? "" : " (nearest known venue, not a confirmed home ground)"}`
    : "No home ground on record";

  const GEOGRAPHY_SUMMARY: Record<SiteGeography, string> = {
    KATHMANDU_VALLEY: "Kathmandu valley setting — a dense urban surrounding",
    TERAI: "Terai plains setting — open, flat surrounding land",
    HILL: "Hill-region setting — elevated, terraced surrounding terrain",
    UNKNOWN: "Surrounding terrain not on record",
  };

  const summary = [
    stadiumLabel,
    ...(stadiumStatus ? [`Stadium: ${stadiumStatus}`] : []),
    ...buildings.map((building) => building.statusLabel),
    `Club football reputation ${profile.reputation?.footballReputation ?? 0} of 100`,
    GEOGRAPHY_SUMMARY[geography],
  ];

  return {
    clubId,
    clubName: profile.entityReference.label,
    stadium: {
      tier: stadiumTier,
      standCount,
      floodlights: Boolean(profile.stadium?.floodlights),
      roofed: Boolean(profile.stadium?.coveredStands),
      capacity: profile.stadium?.capacity,
      provisionalVenue: Boolean(profile.stadium) && !profile.stadium!.confirmedHomeGround,
      label: stadiumLabel,
    },
    buildings,
    site: siteDevelopmentFor(prestige, developedBlocks),
    geography,
    prestige,
    // Deterministic, stable, and explicitly not a real-kit colour claim.
    accentHue: seed % 360,
    seed,
    summary,
  };
};
