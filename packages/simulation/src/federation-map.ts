import type { CareerRole, DistrictDetail, EntityId, FederationMap, MapDistrictSummary, MapRegionTone } from "@nepal-football-sim/shared-types";
import { TerritorialFootballRepository, FederationGovernanceRepository, type GameDatabase } from "@nepal-football-sim/database";
import { buildEntityReference } from "./entity-reference.js";
import { presentLocationById } from "./club-location.js";
import { latestFederationStory } from "./infrastructure-story.js";

const districtTone = (district: { developmentReputation: number }): MapRegionTone =>
  district.developmentReputation >= 65 ? "ok" : district.developmentReputation >= 40 ? "info" : district.developmentReputation >= 20 ? "warn" : "bad";

/** The district a given location sits in, walking the same real hierarchy
 * presentLocationById already walks — never a fabricated placement. */
const districtIdForLocation = (db: GameDatabase, locationId: EntityId | undefined): EntityId | undefined => {
  if (!locationId) return undefined;
  const districts = new TerritorialFootballRepository(db).districts();
  const districtByLocationId = new Map(districts.filter((item) => item.locationId).map((item) => [item.locationId, item.id]));
  const chain = db
    .prepare(
      `WITH RECURSIVE up(id, parent_location_id, depth) AS (
         SELECT id, parent_location_id, 0 FROM locations WHERE id = ?
         UNION ALL
         SELECT l.id, l.parent_location_id, up.depth + 1 FROM locations l JOIN up ON l.id = up.parent_location_id
       )
       SELECT id FROM up ORDER BY depth`,
    )
    .all(locationId) as Array<{ id: EntityId }>;
  for (const entry of chain) {
    const districtId = districtByLocationId.get(entry.id);
    if (districtId) return districtId;
  }
  return undefined;
};

const buildDistrictSummary = (
  db: GameDatabase,
  district: ReturnType<TerritorialFootballRepository["districts"]>[number],
  activeProjectCount: number,
): MapDistrictSummary => ({
  id: district.id,
  name: district.name,
  locationLabel: presentLocationById(db, district.locationId),
  developmentReputation: district.developmentReputation,
  registeredClubCount: district.registeredClubCount,
  girlsParticipation: district.girlsParticipation,
  youthParticipation: district.youthParticipation,
  coachSupply: district.coachSupply,
  refereeSupply: district.refereeSupply,
  activeProjectCount,
  tone: districtTone(district),
});

/**
 * A schematic Nepal-region map read model — grouped by real province and
 * district data the territorial-football system already tracks, never
 * fabricated GPS geometry. Every tone/badge is derived from a real,
 * already-persisted district metric.
 */
export const buildFederationMap = (db: GameDatabase, federationId: EntityId): FederationMap => {
  const territorial = new TerritorialFootballRepository(db);
  const districts = territorial.districts();
  const provinces = territorial.provinces();
  const federationProjects = new FederationGovernanceRepository(db).projects(federationId);
  const activeProjectCountByDistrict = new Map<EntityId, number>();
  for (const project of federationProjects) {
    if (!project.targetDistrictId || ["COMPLETED", "CANCELLED"].includes(project.status)) continue;
    activeProjectCountByDistrict.set(project.targetDistrictId, (activeProjectCountByDistrict.get(project.targetDistrictId) ?? 0) + 1);
  }
  for (const project of territorial.projects()) {
    if (["COMPLETED", "CANCELLED", "REJECTED"].includes(project.status)) continue;
    activeProjectCountByDistrict.set(project.districtId, (activeProjectCountByDistrict.get(project.districtId) ?? 0) + 1);
  }
  const districtsByProvince = new Map<EntityId, typeof districts>();
  for (const district of districts) {
    districtsByProvince.set(district.provinceId, [...(districtsByProvince.get(district.provinceId) ?? []), district]);
  }
  return {
    provinces: provinces.map((province) => ({
      id: province.id,
      name: province.name,
      districts: (districtsByProvince.get(province.id) ?? [])
        .map((district) => buildDistrictSummary(db, district, activeProjectCountByDistrict.get(district.id) ?? 0))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    provenanceStatus: "SIMULATION_ONLY",
  };
};

/**
 * Region detail panel behind a map click — real clubs resolved via the same
 * location hierarchy as districtIdForLocation, real federation/district
 * projects, and the most recent real story touching this district's
 * projects. Honest empty states rather than a placeholder when nothing
 * resolves.
 */
export const buildDistrictDetail = (
  db: GameDatabase,
  federationId: EntityId,
  districtId: EntityId,
  role: CareerRole,
): DistrictDetail | undefined => {
  const territorial = new TerritorialFootballRepository(db);
  const district = territorial.district(districtId);
  if (!district) return undefined;
  const province = territorial.province(district.provinceId);
  const federationProjects = new FederationGovernanceRepository(db)
    .projects(federationId)
    .filter((project) => project.targetDistrictId === districtId);
  const districtProjects = territorial.projects(districtId);
  const activeProjectCount =
    federationProjects.filter((project) => !["COMPLETED", "CANCELLED"].includes(project.status)).length +
    districtProjects.filter((project) => !["COMPLETED", "CANCELLED", "REJECTED"].includes(project.status)).length;
  const clubRows = db
    .prepare("SELECT id, location_id FROM clubs WHERE location_id IS NOT NULL")
    .all() as Array<{ id: EntityId; location_id: EntityId }>;
  const clubs = clubRows
    .filter((row) => districtIdForLocation(db, row.location_id) === districtId)
    .map((row) => buildEntityReference(db, "CLUB", row.id, role));
  return {
    district: buildDistrictSummary(db, district, activeProjectCount),
    provinceName: province?.name ?? "Province not on record",
    clubs,
    federationProjects: federationProjects.map((project) => ({
      id: project.id,
      name: project.name,
      projectType: project.projectType,
      status: project.status,
    })),
    districtProjects: districtProjects.map((project) => ({
      id: project.id,
      projectType: project.projectType,
      status: project.status,
      reportingStatus: project.reportingStatus,
    })),
    latestStory: latestFederationStory(db, federationId, role),
  };
};
