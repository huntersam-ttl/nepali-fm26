import { createStableEntityId, type EntityId, type NationalTeamCallup, type NationalTeamCampaign, type NationalTeamManagementDecision } from "@nepal-football-sim/shared-types";
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

export const respondToNationalTeamCallup = (db: GameDatabase, input: { callupId: EntityId; response: "ACCEPT" | "DECLINE" }): NationalTeamCallup => {
  const repo = new FederationGovernanceRepository(db); const callup = repo.nationalTeamCallups().find((item) => item.id === input.callupId); if (!callup) throw new Error("National team call-up not found");
  const next = { ...callup, status: input.response === "ACCEPT" ? "CALLED_UP" as const : "DECLINED" as const }; repo.upsertNationalTeamCallup(next); return next;
};

export const diasporaEligibilityForNationalTeam = (db: GameDatabase, federationId: EntityId) => new FederationGovernanceRepository(db).internationalEligibilities(federationId).filter((item) => item.discoveredVia === "DIASPORA_SCOUTING" || item.status === "DOCUMENTATION_REQUIRED");

export const scheduleApprovedNationalTeamFriendly = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; opponentName: string; date: string; seed: string; approved?: boolean }) => {
  if (input.approved === false) throw new Error("National team friendly was not approved");
  return scheduleFriendly(db, input);
};

export const registerNationalTeamCampaign = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; name: string; startedOn: string; competitionEditionId?: EntityId }): NationalTeamCampaign => {
  nationalTeam(db, input.nationalTeamId);
  const campaign: NationalTeamCampaign = { id: createStableEntityId("national-team-campaign", `${input.nationalTeamId}:${input.competitionEditionId ?? input.name}:${input.startedOn}`), federationId: input.federationId, nationalTeamId: input.nationalTeamId, competitionEditionId: input.competitionEditionId, name: input.name, startedOn: input.startedOn, matchesPlayed: 0, wins: 0, draws: 0, losses: 0, qualificationStatus: "ACTIVE", status: status };
  new NationalTeamManagementRepository(db).upsertCampaign(campaign); return campaign;
};

export const recordNationalTeamCampaignResult = (db: GameDatabase, input: { campaignId: EntityId; date: string; nationalTeamWon: boolean; draw: boolean; qualificationStatus?: NationalTeamCampaign["qualificationStatus"] }): NationalTeamCampaign => {
  const repo = new NationalTeamManagementRepository(db); const campaign = repo.campaigns().find((item) => item.id === input.campaignId); if (!campaign) throw new Error("National team campaign not found");
  const next: NationalTeamCampaign = { ...campaign, matchesPlayed: campaign.matchesPlayed + 1, wins: campaign.wins + (input.nationalTeamWon ? 1 : 0), draws: campaign.draws + (input.draw ? 1 : 0), losses: campaign.losses + (!input.nationalTeamWon && !input.draw ? 1 : 0), qualificationStatus: input.qualificationStatus ?? campaign.qualificationStatus };
  repo.upsertCampaign(next); return next;
};

export const internationalExposureForPlayer = (db: GameDatabase, playerId: EntityId) => new FederationGovernanceRepository(db).nationalTeamAppearances().filter((item) => item.playerId === playerId);
