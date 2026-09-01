import {
  createStableEntityId,
  type AcademyCatchmentSummary,
  type AcademyRecruitmentReach,
  type AcademySimulationProfile,
  type DistrictFootballUnit,
  type EntityId,
  type SchoolFootballDevelopmentSummary,
  type TalentHotspotLabel,
  type TalentHotspotSnapshot,
  type YouthGeographyReadModel,
} from "@nepal-football-sim/shared-types";
import {
  TerritorialFootballRepository,
  YouthRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { SeededRandom } from "./rng.js";

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const rounded = (value: number): number => Math.round(value);

export type TalentHotspotInputs = {
  district: DistrictFootballUnit;
  asOf: string;
  academyPresence: number;
  academyQuality: number;
  federationInvestment: number;
  historicalProduction: number;
  youthPopulationIndex?: number;
  seed?: string;
};

/** Stable annual diagnostic. Geography IDs, not names or hidden stereotypes, drive the seed. */
export const deriveTalentHotspot = (input: TalentHotspotInputs): TalentHotspotSnapshot => {
  const youthPopulation = clamp(input.youthPopulationIndex ?? input.district.youthParticipation);
  const signal = rounded(
    input.district.schoolParticipation * 0.2 +
      input.district.youthParticipation * 0.18 +
      input.district.coachSupply * 0.16 +
      input.district.groundAvailability * 0.12 +
      input.district.scoutingVisibility * 0.08 +
      input.academyPresence * 8 +
      input.academyQuality * 1.2 +
      input.federationInvestment * 0.1 +
      input.historicalProduction * 0.12 +
      youthPopulation * 0.08 +
      deterministicJitter(input.district.id, input.seed),
  );
  const label: TalentHotspotLabel =
    signal >= 70
      ? "PRIORITY"
      : signal >= 52
        ? "ESTABLISHED"
        : signal >= 32
          ? "DEVELOPING"
          : "EMERGING";
  const contributingFactors = [
    input.district.schoolParticipation >= 50 ? "school football participation" : undefined,
    input.district.coachSupply >= 45 ? "coach supply" : undefined,
    input.academyPresence > 0 ? "academy pathway" : undefined,
    input.federationInvestment >= 20 ? "federation investment" : undefined,
    input.historicalProduction >= 3 ? "recent player production" : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    districtId: input.district.id,
    provinceId: input.district.provinceId,
    asOf: input.asOf,
    label,
    momentum: "STABLE",
    contributingFactors:
      contributingFactors.length > 0 ? contributingFactors : ["grassroots participation base"],
    provenance: "SIMULATION_ONLY",
  };
};

/** Applies slow inertia; a single season cannot rewrite a district's development identity. */
export const evolveTalentHotspot = (
  previous: TalentHotspotSnapshot,
  input: TalentHotspotInputs & { asOf: string },
): TalentHotspotSnapshot => {
  const next = deriveTalentHotspot(input);
  const rank = (label: TalentHotspotLabel): number =>
    (
      ({ EMERGING: 1, DEVELOPING: 2, ESTABLISHED: 3, PRIORITY: 4 }) as Record<
        TalentHotspotLabel,
        number
      >
    )[label];
  const delta = rank(next.label) - rank(previous.label);
  const movement = delta === 0 ? "STABLE" : delta > 0 ? "RISING" : "STAGNATING";
  const retained = Math.abs(delta) > 1 ? previous.label : next.label;
  return { ...next, asOf: input.asOf, label: retained, momentum: movement };
};

export const deriveSchoolFootballSummary = (
  district: DistrictFootballUnit,
  academyCount: number,
): SchoolFootballDevelopmentSummary => ({
  districtId: district.id,
  programmeLabel:
    district.schoolParticipation >= 65
      ? "STRONG"
      : district.schoolParticipation >= 40
        ? "ACTIVE"
        : district.schoolParticipation >= 20
          ? "DEVELOPING"
          : "LIMITED",
  participationLabel:
    district.schoolParticipation >= 60
      ? "WIDESPREAD"
      : district.schoolParticipation >= 25
        ? "STEADY"
        : "LOW",
  academyConnection:
    academyCount >= 2 ? "REGIONAL_PATHWAY" : academyCount === 1 ? "LOCAL_PATHWAY" : "NONE_RECORDED",
  competitionExposure: district.youthParticipation >= 40 ? "REGULAR" : "LIMITED",
  provenance: "SIMULATION_ONLY",
});

export const deriveAcademyCatchment = (input: {
  profile: AcademySimulationProfile;
  homeDistrictId?: EntityId;
  partnershipCount?: number;
}): AcademyCatchmentSummary => {
  const reachScore =
    input.profile.regionalReach +
    input.profile.youthRecruitmentQuality +
    input.profile.talentIdentificationQuality +
    (input.partnershipCount ?? 0) * 1.5;
  const reach: AcademyRecruitmentReach =
    reachScore >= 22 ? "NATIONAL" : reachScore >= 13 ? "REGIONAL" : "LOCAL";
  return {
    academyId: input.profile.academyId,
    clubId: input.profile.clubId,
    homeDistrictId: input.homeDistrictId,
    reach,
    catchmentLabel:
      reach === "NATIONAL" ? "NATIONWIDE" : reach === "REGIONAL" ? "WIDER_REGION" : "LOCAL",
    pathwayLinks: [
      reach === "LOCAL" ? "school-to-local-academy" : "district-to-academy",
      ...(input.partnershipCount ? ["academy-partnership"] : []),
    ],
    provenance: "SIMULATION_ONLY",
  };
};

export const youthGeographyReadModel = (
  db: GameDatabase,
  playerId: EntityId,
): YouthGeographyReadModel | undefined => {
  const origin = new YouthRepository(db)
    .generatedPlayerOrigins()
    .find((item) => item.playerId === playerId);
  if (!origin) return undefined;
  const district = origin.districtLocationId;
  const province = district
    ? (
        db.prepare("SELECT parent_location_id AS id FROM locations WHERE id=?").get(district) as
          { id?: EntityId } | undefined
      )?.id
    : undefined;
  const recruitmentPathway = origin.academyId
    ? origin.originType === "NATIONAL_ACADEMY"
      ? "NATIONAL_ACADEMY"
      : origin.originType === "REGIONAL_ACADEMY"
        ? "REGIONAL_ACADEMY"
        : "LOCAL_ACADEMY"
    : origin.originType === "DISTRICT_FOOTBALL" || origin.originType === "GRASSROOTS"
      ? "SCHOOL"
      : "OTHER";
  return {
    playerId,
    birthDistrictId: district,
    developmentDistrictId: district,
    provinceId: province,
    academyOriginId: origin.academyId,
    recruitmentPathway,
    provenance: "SIMULATION_ONLY",
  };
};

export const nepalYouthGeography = (
  db: GameDatabase,
  asOf: string,
  seed: string,
): {
  hotspots: TalentHotspotSnapshot[];
  schools: SchoolFootballDevelopmentSummary[];
  catchments: AcademyCatchmentSummary[];
} => {
  const territorial = new TerritorialFootballRepository(db);
  const districts = territorial.districts();
  const profiles = new YouthRepository(db).academyProfiles();
  const academyCounts = new Map<EntityId, number>();
  for (const row of db
    .prepare("SELECT location_id FROM academies WHERE location_id IS NOT NULL")
    .all() as Array<{ location_id?: EntityId }>) {
    if (row.location_id)
      academyCounts.set(row.location_id, (academyCounts.get(row.location_id) ?? 0) + 1);
  }
  const production = new Map<EntityId, number>();
  for (const row of db
    .prepare(
      "SELECT district_location_id AS district, COUNT(*) AS count FROM generated_player_origins WHERE district_location_id IS NOT NULL GROUP BY district_location_id",
    )
    .all() as Array<{ district?: EntityId; count: number }>) {
    if (row.district) production.set(row.district, Number(row.count));
  }
  const investment = new Map<EntityId, number>();
  for (const project of territorial.projects()) {
    if (project.status === "CANCELLED" || project.status === "REJECTED") continue;
    investment.set(
      project.districtId,
      (investment.get(project.districtId) ?? 0) + project.federationContribution,
    );
  }
  const hotspots = districts.map((district) =>
    deriveTalentHotspot({
      district,
      asOf,
      academyPresence: district.locationId ? (academyCounts.get(district.locationId) ?? 0) : 0,
      academyQuality: averageAcademyQuality(profiles),
      federationInvestment: investment.get(district.id) ?? 0,
      historicalProduction: district.locationId ? (production.get(district.locationId) ?? 0) : 0,
      seed: `${seed}:${asOf}`,
    }),
  );
  const schools = districts.map((district) =>
    deriveSchoolFootballSummary(
      district,
      district.locationId ? (academyCounts.get(district.locationId) ?? 0) : 0,
    ),
  );
  const catchments = profiles.map((profile) => deriveAcademyCatchment({ profile }));
  return { hotspots, schools, catchments };
};

const averageAcademyQuality = (profiles: AcademySimulationProfile[]): number =>
  profiles.length === 0
    ? 0
    : profiles.reduce(
        (sum, profile) => sum + profile.academyCoachingQuality + profile.academyFacilitiesQuality,
        0,
      ) / profiles.length;
const deterministicJitter = (districtId: EntityId, seed = "academy-geography"): number =>
  Number(
    (
      (new SeededRandom(`${seed}:${createStableEntityId("hotspot", districtId)}`).next() - 0.5) *
      4
    ).toFixed(2),
  );
