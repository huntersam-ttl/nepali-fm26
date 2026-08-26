import { createStableEntityId, type DiasporaRecruitment, type EntityId, type InternationalCommitment, type NationalTeamCallup, type NationalTeamCampaign, type NationalTeamCampLifecycle, type NationalTeamManagementDecision, type NationalTeamSquadRegistration } from "@nepal-football-sim/shared-types";
import { FederationGovernanceRepository, InternationalFootballRepository, NationalTeamManagementRepository, type GameDatabase } from "@nepal-football-sim/database";
import { scheduleFriendly, selectNationalTeamSquad } from "./federation-governance.js";

const status = "SIMULATION_ONLY" as const;

const nationalTeam = (db: GameDatabase, teamId: EntityId): { id: EntityId; federationId: EntityId; level: string; gender: string } => {
  const row = db.prepare("SELECT id,federation_id,level,gender,club_id FROM teams WHERE id=?").get(teamId) as any;
  if (!row || row.club_id) throw new Error("National team not found");
  return { id: row.id, federationId: row.federation_id, level: row.level, gender: row.gender };
};

const unavailable = (db: GameDatabase, playerId: EntityId, date: string): string | undefined => {
  const injury = db.prepare("SELECT injury_type FROM injuries WHERE person_id=? AND date_occurred<=? AND expected_recovery_date>=? ORDER BY expected_recovery_date DESC LIMIT 1").get(playerId, date, date) as { injury_type?: string } | undefined;
  if (injury) return "INJURED";
  const availability = db.prepare("SELECT availability FROM player_availability_states WHERE person_id=?").get(playerId) as { availability?: string } | undefined;
  return availability?.availability && availability.availability !== "AVAILABLE" ? availability.availability : undefined;
};

export const selectManagedNationalTeamSquad = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; date: string; programme: string; seed: string; size?: number; managerPersonId?: EntityId; captainPlayerId?: EntityId; tacticalSetupId?: EntityId; tacticalStyle?: string; competitionEditionId?: EntityId }): NationalTeamManagementDecision => {
  const team = nationalTeam(db, input.nationalTeamId); if (team.federationId !== input.federationId) throw new Error("National team belongs to another federation");
  const callups = selectNationalTeamSquad(db, { federationId: input.federationId, nationalTeamId: input.nationalTeamId, date: input.date, programme: input.programme, seed: input.seed, size: input.size ?? 23 });
  const governance = new FederationGovernanceRepository(db); const available: NationalTeamCallup[] = [];
  for (const callup of callups) { const reason = unavailable(db, callup.playerId, input.date); const next = reason ? { ...callup, status: reason === "INJURED" ? "WITHDRAWN" as const : "DECLINED" as const } : callup; governance.upsertNationalTeamCallup(next); if (!reason) available.push(next); }
  const captain = input.captainPlayerId && available.some((item) => item.playerId === input.captainPlayerId) ? input.captainPlayerId : available[0]?.playerId;
  const repo = new NationalTeamManagementRepository(db); for (const previous of repo.decisions(input.nationalTeamId).filter((item) => item.status === "ACTIVE")) repo.upsertDecision({ ...previous, status: "SUPERSEDED" });
  const decision: NationalTeamManagementDecision = { id: createStableEntityId("national-team-management", `${input.nationalTeamId}:${input.date}:${input.programme}`), federationId: input.federationId, nationalTeamId: input.nationalTeamId, managerPersonId: input.managerPersonId, decisionDate: input.date, programme: input.programme, selectedPlayerIds: available.map((item) => item.playerId), captainPlayerId: captain, tacticalSetupId: input.tacticalSetupId, tacticalStyle: input.tacticalStyle, competitionEditionId: input.competitionEditionId, status: "ACTIVE", provenanceStatus: status };
  repo.upsertDecision(decision); return decision;
};

export const respondToNationalTeamCallup = (db: GameDatabase, input: { callupId: EntityId; response: "ACCEPT" | "DECLINE" | "RELUCTANT"; date?: string; reason?: string }): NationalTeamCallup => {
  const repo = new FederationGovernanceRepository(db); const callup = repo.nationalTeamCallups().find((item) => item.id === input.callupId); if (!callup) throw new Error("National team call-up not found");
  const federationId = (db.prepare("SELECT federation_id FROM teams WHERE id=?").get(callup.nationalTeamId) as { federation_id: EntityId } | undefined)?.federation_id; if (input.response === "RELUCTANT" && federationId) setInternationalCommitment(db, { playerId: callup.playerId, federationId, status: "TEMPORARILY_RELUCTANT", decidedOn: input.date ?? callup.callupDate, reason: input.reason, provenanceStatus: status });
  const next = { ...callup, status: input.response === "DECLINE" ? "DECLINED" as const : "CALLED_UP" as const }; repo.upsertNationalTeamCallup(next); return next;
};

export const diasporaEligibilityForNationalTeam = (db: GameDatabase, federationId: EntityId) => new FederationGovernanceRepository(db).internationalEligibilities(federationId).filter((item) => item.discoveredVia === "DIASPORA_SCOUTING" || item.status === "DOCUMENTATION_REQUIRED");

export const scheduleApprovedNationalTeamFriendly = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; opponentName: string; date: string; seed: string; approved?: boolean }) => {
  if (input.approved === false) throw new Error("National team friendly was not approved");
  return scheduleFriendly(db, input);
};

export const registerNationalTeamCampaign = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; name: string; startedOn: string; competitionEditionId?: EntityId; objectives?: Record<string, number> }): NationalTeamCampaign => {
  nationalTeam(db, input.nationalTeamId);
  const campaign: NationalTeamCampaign = { id: createStableEntityId("national-team-campaign", `${input.nationalTeamId}:${input.competitionEditionId ?? input.name}:${input.startedOn}`), federationId: input.federationId, nationalTeamId: input.nationalTeamId, competitionEditionId: input.competitionEditionId, name: input.name, startedOn: input.startedOn, matchesPlayed: 0, wins: 0, draws: 0, losses: 0, qualificationStatus: "ACTIVE", objectives: input.objectives ?? {}, status: status };
  new NationalTeamManagementRepository(db).upsertCampaign(campaign); return campaign;
};

export const planNationalTeamCampaignSquad = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; competitionEditionId: EntityId; registrationDeadline: string; date: string; programme: string; seed: string; managerPersonId?: EntityId }): NationalTeamSquadRegistration => {
  if (input.date > input.registrationDeadline) throw new Error("Registration deadline has passed");
  const decision = selectManagedNationalTeamSquad(db, { ...input, competitionEditionId: input.competitionEditionId });
  const registration: NationalTeamSquadRegistration = { id: createStableEntityId("national-team-registration", `${input.competitionEditionId}:${input.nationalTeamId}`), federationId: input.federationId, nationalTeamId: input.nationalTeamId, competitionEditionId: input.competitionEditionId, registrationDeadline: input.registrationDeadline, provisionalPlayerIds: decision.selectedPlayerIds, status: "PROVISIONAL", provenanceStatus: status };
  new NationalTeamManagementRepository(db).upsertRegistration(registration); return registration;
};

export const finalizeNationalTeamCampaignSquad = (db: GameDatabase, input: { registrationId: EntityId; date: string; seed: string }): NationalTeamSquadRegistration => {
  const repo = new NationalTeamManagementRepository(db); const registration = repo.registrations().find((item) => item.id === input.registrationId); if (!registration) throw new Error("National team registration not found"); if (input.date > registration.registrationDeadline) throw new Error("Registration deadline has passed");
  const finalPlayerIds = registration.provisionalPlayerIds.filter((playerId) => !unavailable(db, playerId, input.date));
  if (finalPlayerIds.length < registration.provisionalPlayerIds.length) {
    const replacement = selectManagedNationalTeamSquad(db, { federationId: registration.federationId, nationalTeamId: registration.nationalTeamId, date: input.date, programme: "Registration replacements", seed: `${input.seed}:${registration.id}`, size: registration.provisionalPlayerIds.length });
    for (const playerId of replacement.selectedPlayerIds) if (finalPlayerIds.length < registration.provisionalPlayerIds.length && !finalPlayerIds.includes(playerId)) finalPlayerIds.push(playerId);
  }
  const next = { ...registration, finalPlayerIds, status: "FINAL" as const }; repo.upsertRegistration(next); return next;
};

export const startNationalTeamCampLifecycle = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; playerIds: EntityId[]; callupDate: string; competitionEditionId?: EntityId }): NationalTeamCampLifecycle => {
  const camp: NationalTeamCampLifecycle = { id: createStableEntityId("national-team-camp-lifecycle", `${input.nationalTeamId}:${input.callupDate}`), federationId: input.federationId, nationalTeamId: input.nationalTeamId, competitionEditionId: input.competitionEditionId, callupDate: input.callupDate, status: "CALLED_UP", playerIds: input.playerIds, fitnessEffect: -3, provenanceStatus: status };
  new NationalTeamManagementRepository(db).upsertCampLifecycle(camp); return camp;
};

export const advanceNationalTeamCampLifecycle = (db: GameDatabase, input: { campId: EntityId; phase: "ARRIVED" | "TRAINING" | "MATCH" | "RELEASED"; date: string }): NationalTeamCampLifecycle => {
  const repo = new NationalTeamManagementRepository(db); const camp = repo.campLifecycles().find((item) => item.id === input.campId); if (!camp) throw new Error("National team camp not found"); const order = ["CALLED_UP", "ARRIVED", "TRAINING", "MATCH", "RELEASED"]; if (order.indexOf(input.phase) <= order.indexOf(camp.status)) throw new Error("Camp phase cannot move backwards");
  const next: NationalTeamCampLifecycle = { ...camp, status: input.phase, arrivalDate: input.phase === "ARRIVED" ? input.date : camp.arrivalDate, trainingStart: input.phase === "TRAINING" ? input.date : camp.trainingStart, matchDate: input.phase === "MATCH" ? input.date : camp.matchDate, releaseDate: input.phase === "RELEASED" ? input.date : camp.releaseDate };
  const international = new InternationalFootballRepository(db); for (const playerId of camp.playerIds) { const duty = international.duties().find((item) => item.nationalTeamId === camp.nationalTeamId && item.playerId === playerId && item.departureDate === camp.callupDate); if (input.phase === "ARRIVED" && !duty) international.upsertDuty({ id: createStableEntityId("national-team-duty", `${camp.id}:${playerId}`), nationalTeamId: camp.nationalTeamId, playerId, competitionEditionId: camp.competitionEditionId, departureDate: camp.callupDate, returnDate: camp.releaseDate ?? input.date, status: "ON_DUTY", fitnessEffect: camp.fitnessEffect, provenanceStatus: status }); else if (input.phase === "RELEASED" && duty) international.upsertDuty({ ...duty, returnDate: input.date, status: "RETURNED" }); }
  repo.upsertCampLifecycle(next); return next;
};

export const setInternationalCommitment = (db: GameDatabase, input: InternationalCommitment): InternationalCommitment => { const next = { ...input, provenanceStatus: status }; new NationalTeamManagementRepository(db).upsertCommitment(next); return next; };

export const advanceDiasporaRecruitment = (db: GameDatabase, input: Omit<DiasporaRecruitment, "id" | "provenanceStatus"> & { id?: EntityId }): DiasporaRecruitment => {
  if (input.status === "ELIGIBLE_CONFIRMED" || input.status === "COMMITTED") { const eligibility = new FederationGovernanceRepository(db).internationalEligibilities(input.federationId).find((item) => item.playerId === input.playerId && item.status === "ELIGIBLE"); if (!eligibility) throw new Error("Eligibility confirmation is required before commitment"); }
  const next: DiasporaRecruitment = { ...input, id: input.id ?? createStableEntityId("diaspora-recruitment", `${input.federationId}:${input.playerId}`), provenanceStatus: status }; new NationalTeamManagementRepository(db).upsertDiaspora(next); return next;
};

export const recordNationalTeamCampaignResult = (db: GameDatabase, input: { campaignId: EntityId; date: string; nationalTeamWon: boolean; draw: boolean; qualificationStatus?: NationalTeamCampaign["qualificationStatus"] }): NationalTeamCampaign => {
  const repo = new NationalTeamManagementRepository(db); const campaign = repo.campaigns().find((item) => item.id === input.campaignId); if (!campaign) throw new Error("National team campaign not found");
  const next: NationalTeamCampaign = { ...campaign, matchesPlayed: campaign.matchesPlayed + 1, wins: campaign.wins + (input.nationalTeamWon ? 1 : 0), draws: campaign.draws + (input.draw ? 1 : 0), losses: campaign.losses + (!input.nationalTeamWon && !input.draw ? 1 : 0), qualificationStatus: input.qualificationStatus ?? campaign.qualificationStatus };
  repo.upsertCampaign(next); return next;
};

export const internationalExposureForPlayer = (db: GameDatabase, playerId: EntityId) => new FederationGovernanceRepository(db).nationalTeamAppearances().filter((item) => item.playerId === playerId);
