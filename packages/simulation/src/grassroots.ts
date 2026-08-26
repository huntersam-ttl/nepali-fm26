import { createStableEntityId, type EntityId, type GrassrootsProgramme, type GrassrootsProgrammeHistory, type GrassrootsProgrammeType } from "@nepal-football-sim/shared-types";
import { GrassrootsRepository, type GameDatabase } from "@nepal-football-sim/database";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const qualityOf = (programme: GrassrootsProgramme): number => clamp(programme.annualFunding / 10000 + programme.coachingAccess * 0.25 + programme.facilityAccess * 0.2 + programme.regionalParticipation * 0.2 + programme.localFootballPriority * 0.1);

export const delayedGrassrootsImpact = (programme: GrassrootsProgramme): { playerPoolMultiplier: number; regionalTalentProbability: number; participationMultiplier: number } => {
  if (programme.yearsActive < 3 || programme.status !== "ACTIVE") return { playerPoolMultiplier: 0, regionalTalentProbability: 0, participationMultiplier: 0 };
  const years = Math.min(10, programme.yearsActive - 2);
  const quality = qualityOf(programme) / 100;
  return { playerPoolMultiplier: Number((years * quality * 0.02).toFixed(4)), regionalTalentProbability: Number((years * quality * 0.01).toFixed(4)), participationMultiplier: Number((years * quality * 0.03).toFixed(4)) };
};

export const createGrassrootsProgramme = (db: GameDatabase, input: { name: string; programmeType: GrassrootsProgrammeType; locationId: EntityId; locationKind: GrassrootsProgramme["locationKind"]; federationId?: EntityId; fundingApplicationId?: EntityId; annualFunding: number; coachingAccess?: number; facilityAccess?: number; regionalParticipation?: number; localFootballPriority?: number; date: string }): GrassrootsProgramme => {
  if (input.annualFunding < 0) throw new Error("Grassroots funding cannot be negative");
  const programme: GrassrootsProgramme = { id:createStableEntityId("grassroots-programme", `${input.locationId}:${input.programmeType}:${input.name}`), name:input.name, programmeType:input.programmeType, locationId:input.locationId, locationKind:input.locationKind, federationId:input.federationId, fundingApplicationId:input.fundingApplicationId, annualFunding:Math.round(input.annualFunding), coachingAccess:clamp(input.coachingAccess ?? 0), facilityAccess:clamp(input.facilityAccess ?? 0), regionalParticipation:clamp(input.regionalParticipation ?? 0), localFootballPriority:clamp(input.localFootballPriority ?? 0), yearsActive:0, status:"PLANNED", provenanceStatus:"SIMULATION_ONLY" };
  const repo = new GrassrootsRepository(db); repo.upsertProgramme(programme); repo.insertHistory({ id:createStableEntityId("grassroots-history", `${programme.id}:created`), programmeId:programme.id, date:input.date, eventType:"CREATED", quality:qualityOf(programme), delayedImpact:0, provenanceStatus:"SIMULATION_ONLY" }); return programme;
};

export const advanceGrassrootsProgramme = (db: GameDatabase, input: { programmeId: EntityId; date: string; funded?: boolean }): GrassrootsProgramme => {
  const repo = new GrassrootsRepository(db); const current = repo.programme(input.programmeId); if (!current) throw new Error(`Grassroots programme missing: ${input.programmeId}`);
  const active = input.funded !== false; const next: GrassrootsProgramme = { ...current, status:active ? "ACTIVE" : "SUSPENDED", yearsActive:active ? current.yearsActive + 1 : current.yearsActive };
  repo.upsertProgramme(next); const impact=delayedGrassrootsImpact(next); const event: GrassrootsProgrammeHistory = { id:createStableEntityId("grassroots-history", `${next.id}:${input.date}:${next.yearsActive}:${next.status}`), programmeId:next.id, date:input.date, eventType:next.status === "SUSPENDED" ? "SUSPENDED" : "ADVANCED", quality:qualityOf(next), delayedImpact:Math.round(impact.playerPoolMultiplier * 10000), provenanceStatus:"SIMULATION_ONLY" }; repo.insertHistory(event); return next;
};
