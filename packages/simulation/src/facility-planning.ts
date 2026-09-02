import { ClubEconomyRepository, FacilityPlanningRepository, GovernmentRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type FacilityProjectPlan, type FacilityProjectScope, type FacilitySiteOption, type InfrastructureProject, type InfrastructureProjectType } from "@nepal-football-sim/shared-types";
import { createInfrastructureProjectCommand } from "./club-economy.js";
import { SeededRandom } from "./rng.js";

const addDays = (date: string, days: number): string => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const scopeMultiplier: Record<FacilityProjectScope, number> = { BASIC: 0.78, STANDARD: 1, EXPANDED: 1.28, ELITE: 1.7 };
const scopeDurationMultiplier: Record<FacilityProjectScope, number> = { BASIC: 0.8, STANDARD: 1, EXPANDED: 1.25, ELITE: 1.55 };

const defaultComponents: Record<string, string[]> = {
  TRAINING_GROUND: ["pitches", "gym", "analysis", "floodlights"],
  ACADEMY: ["pitches", "classrooms", "medical", "education_community"],
  STADIUM: ["pitch", "floodlights", "media_broadcast", "community_facilities"],
  STAND: ["hospitality", "community_facilities"],
};

const bands = (cost: number, durationDays: number): Pick<FacilityProjectPlan, "costBand" | "durationBand"> => ({
  costBand: cost < 2_000_000 ? "LOW" : cost < 7_500_000 ? "MODERATE" : cost < 20_000_000 ? "HIGH" : "VERY_HIGH",
  durationBand: durationDays <= 120 ? "SHORT" : durationDays <= 240 ? "MEDIUM" : durationDays <= 420 ? "LONG" : "VERY_LONG",
});

export const generateFacilitySiteOptions = (db: GameDatabase, input: { clubId: EntityId; districtId: EntityId; municipalityName: string; date: string; seed: string }): FacilitySiteOption[] => {
  const repo = new FacilityPlanningRepository(db);
  const existing = repo.siteOptions(input.clubId, input.districtId);
  if (existing.length) return existing;
  const rng = new SeededRandom(`facility-site:${input.seed}:${input.clubId}:${input.districtId}`);
  const templates: Array<Pick<FacilitySiteOption, "siteType" | "arrangement" | "costBand" | "accessibilityBand" | "catchmentBand" | "communityValueBand" | "readiness" | "governmentConditions">> = [
    { siteType: "MUNICIPAL_LAND", arrangement: "LEASE", costBand: "LOW", accessibilityBand: "GOOD", catchmentBand: "REGIONAL", communityValueBand: "HIGH", readiness: "GOVERNMENT_REVIEW", governmentConditions: ["community access", "youth allocation"] },
    { siteType: "REGIONAL_SITE", arrangement: "PURCHASE", costBand: "HIGH", accessibilityBand: "LIMITED", catchmentBand: "WIDE", communityValueBand: "MEDIUM", readiness: "NEGOTIATION_REQUIRED", governmentConditions: ["planning approval"] },
    { siteType: "SHARED_CAMPUS", arrangement: "CO_FUNDED", costBand: "MODERATE", accessibilityBand: "STRONG", catchmentBand: "REGIONAL", communityValueBand: "HIGH", readiness: "AVAILABLE", governmentConditions: ["shared-use agreement"] },
  ];
  const options: FacilitySiteOption[] = templates.map((option, index) => ({ ...option, id: createStableEntityId("facility-site", `${input.clubId}:${input.districtId}:${index}`), clubId: input.clubId, districtId: input.districtId, municipalityName: input.municipalityName, provenanceStatus: "SIMULATION_ONLY" as const }));
  if (rng.next() < 0.25) options[1] = { ...options[1]!, accessibilityBand: "GOOD" };
  for (const option of options) repo.upsertSiteOption(option);
  return options;
};

export type FacilityPlanningInput = {
  clubId: EntityId;
  personId: EntityId;
  callerRole: "CHAIRMAN_OWNER" | "CEO";
  projectType: InfrastructureProjectType;
  date: string;
  seed: string;
  mode: "UPGRADE_EXISTING" | "NEW_SITE";
  scope: FacilityProjectScope;
  components?: string[];
  siteOptionId?: EntityId;
  fundingSource: "CLUB_CASH" | "DEBT" | "GOVERNMENT_GRANT" | "MIXED";
  financing?: Record<string, number>;
  governmentApplicationId?: EntityId;
  rationale: string;
};

export const createFacilityProjectPlan = (db: GameDatabase, input: FacilityPlanningInput): { project: InfrastructureProject; plan: FacilityProjectPlan; siteOption?: FacilitySiteOption } => {
  if (!input.rationale.trim()) throw new Error("Facility project rationale is required");
  const sites = new FacilityPlanningRepository(db);
  const siteOption = input.siteOptionId ? sites.siteOptions(input.clubId).find((site) => site.id === input.siteOptionId) : undefined;
  if (input.mode === "NEW_SITE" && !siteOption) throw new Error("New-site projects require a persisted site option");
  if (siteOption?.readiness === "GOVERNMENT_REVIEW" && !input.governmentApplicationId) throw new Error("This site requires a government application before planning can proceed");
  if (input.governmentApplicationId && !new GovernmentRepository(db).applications().some((application) => application.id === input.governmentApplicationId)) throw new Error("Government application missing for facility project");
  const components = [...new Set(input.components?.length ? input.components : defaultComponents[input.projectType] ?? ["renewed_core_components"])];
  const project = createInfrastructureProjectCommand(db, { clubId: input.clubId, personId: input.personId, callerRole: input.callerRole, projectType: input.projectType, date: input.date, seed: input.seed });
  const siteCostMultiplier = input.mode === "NEW_SITE" ? (siteOption?.arrangement === "PURCHASE" ? 1.35 : siteOption?.arrangement === "CO_FUNDED" ? 1.12 : 1.05) : 1;
  const componentMultiplier = 0.78 + components.length * 0.08;
  const adjustedCost = Math.round(project.capitalCost * scopeMultiplier[input.scope] * componentMultiplier * siteCostMultiplier);
  const baseDuration = Math.max(30, Math.round((new Date(`${project.expectedCompletion}T00:00:00Z`).getTime() - new Date(`${project.planningStart}T00:00:00Z`).getTime()) / 86_400_000));
  const durationDays = Math.round(baseDuration * scopeDurationMultiplier[input.scope] + (input.mode === "NEW_SITE" ? 45 : 0));
  const financingJson = input.financing ?? (input.fundingSource === "CLUB_CASH" ? { clubCash: adjustedCost } : {});
  const committed = Object.values(financingJson).reduce((sum, value) => sum + Math.max(0, value), 0);
  const updated: InfrastructureProject = { ...project, expectedCompletion: addDays(project.planningStart, durationDays), capitalCost: adjustedCost, ongoingCost: Math.round(project.ongoingCost * scopeMultiplier[input.scope] * componentMultiplier), financingJson, siteRights: input.mode === "NEW_SITE" ? siteOption?.arrangement === "LEASE" ? "LEASED" : siteOption?.arrangement === "CO_FUNDED" ? "SHARED" : "PERMISSION_REQUIRED" : project.siteRights, fundingCommitted: committed, fundingStatus: committed >= adjustedCost ? "FUNDED" : committed > 0 ? "PARTIALLY_FUNDED" : "UNFUNDED", components, utilisationCapacity: Math.round((project.utilisationCapacity ?? 0) * scopeMultiplier[input.scope]), maintenanceStatus: "FUNDED" };
  new ClubEconomyRepository(db).upsertInfrastructureProject(updated);
  const plan: FacilityProjectPlan = { id: createStableEntityId("facility-plan", updated.id), projectId: updated.id, clubId: input.clubId, projectType: input.projectType, mode: input.mode, scope: input.scope, components, siteOptionId: siteOption?.id, fundingSource: input.fundingSource, governmentApplicationId: input.governmentApplicationId, rationale: input.rationale, ...bands(adjustedCost, durationDays), expectedImprovement: components.map((component) => component.replaceAll("_", " ")), createdOn: input.date, provenanceStatus: "SIMULATION_ONLY" };
  sites.upsertPlan(plan);
  return { project: updated, plan, siteOption };
};
