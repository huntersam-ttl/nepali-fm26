import { createStableEntityId, type DiasporaRecruitment, type EntityId, type FootballStaffRole, type InternationalCommitment, type NationalTeamCallup, type NationalTeamCampaign, type NationalTeamCampLifecycle, type NationalTeamInternationalForm, type NationalTeamManagementDecision, type NationalTeamOperationalPlan, type NationalTeamSelectionPolicy, type NationalTeamSquadRegistration, type NationalTeamWatchlistItem, type Person, type StaffProfile } from "@nepal-football-sim/shared-types";
import { FederationGovernanceRepository, InternationalFootballRepository, NationalTeamManagementRepository, StaffMarketRepository, WorldRepository, type GameDatabase } from "@nepal-football-sim/database";
import { type StaffEmploymentContract, type StaffAppointment } from "@nepal-football-sim/shared-types";
import { scheduleFriendly, selectNationalTeamSquad } from "./federation-governance.js";
import { homeCurrency, homeFootballContext, isHomeFederation } from "./home-context.js";
import { staffEligibility } from "./staff-market.js";

const status = "SIMULATION_ONLY" as const;

export class FederationPersonnelError extends Error {
  constructor(
    readonly code: "NOT_AUTHORIZED" | "INVALID_TARGET" | "CANDIDATE_NOT_FOUND" | "NOT_ELIGIBLE" | "ALREADY_EMPLOYED" | "INCUMBENT_PRESENT",
    message: string,
  ) {
    super(message);
  }
}

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

/** President-facing national-team head-coach appointment; all persistence is canonical employment state. */
export const appointNationalTeamHeadCoachForPresident = (
  db: GameDatabase,
  input: { federationId: EntityId; nationalTeamId: EntityId; presidentPersonId: EntityId; candidatePersonId: EntityId; date: string },
): StaffAppointment => {
  const governance = new FederationGovernanceRepository(db);
  const presidency = governance.leadershipTenures(input.federationId).some((tenure) => tenure.personId === input.presidentPersonId && tenure.role === "FEDERATION_PRESIDENT" && tenure.status === "ACTIVE");
  if (!presidency || !isHomeFederation(db, input.federationId)) throw new FederationPersonnelError("NOT_AUTHORIZED", `Only the active ${homeFootballContext(db).countryName} federation president may appoint national-team staff.`);

  const team = db.prepare("SELECT federation_id, club_id FROM teams WHERE id=?").get(input.nationalTeamId) as { federation_id?: EntityId; club_id?: EntityId } | undefined;
  if (!team || team.federation_id !== input.federationId || team.club_id) throw new FederationPersonnelError("INVALID_TARGET", "The target must be a Nepal national team in this federation.");
  if (db.prepare("SELECT 1 FROM staff_appointments WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH' AND employment_status='ACTIVE' LIMIT 1").get(input.nationalTeamId)) throw new FederationPersonnelError("INCUMBENT_PRESENT", "The national team already has a head coach.");

  const market = new StaffMarketRepository(db);
  const profile = market.staffProfile(input.candidatePersonId);
  if (!profile || profile.availability === "RETIRED") throw new FederationPersonnelError("CANDIDATE_NOT_FOUND", "The candidate is not an available staff profile.");
  if (market.activeAppointment(input.candidatePersonId)) throw new FederationPersonnelError("ALREADY_EMPLOYED", "The candidate is already employed.");
  const eligibility = staffEligibility("NATIONAL_TEAM_HEAD_COACH", profile, market.staffLicencesForPerson(input.candidatePersonId));
  if (!eligibility.eligible) throw new FederationPersonnelError("NOT_ELIGIBLE", eligibility.note ?? "The candidate is not eligible for this role.");

  const appointment: StaffAppointment = { id: createStableEntityId("staff-appointment", `${input.nationalTeamId}:national-head-coach:${input.candidatePersonId}`), personId: input.candidatePersonId, organisationType: "NATIONAL_TEAM", teamId: input.nationalTeamId, federationId: input.federationId, role: "NATIONAL_TEAM_HEAD_COACH", startDate: input.date, employmentStatus: "ACTIVE" };
  const contract: StaffEmploymentContract = { id: createStableEntityId("staff-contract", appointment.id), personId: appointment.personId, appointmentId: appointment.id, teamId: input.nationalTeamId, role: appointment.role, contractStart: input.date, contractEnd: addDays(input.date, 24 * 30), salaryAmountMinor: 400_000, currency: homeCurrency(db), status: "ACTIVE" };
  appointment.contractId = contract.id;
  const world = new WorldRepository(db);
  world.insertStaffAppointment(appointment);
  market.upsertEmploymentContract(contract);
  world.insertStaffHistoryEvent({ id: createStableEntityId("staff-history", `${appointment.id}:joined`), personId: appointment.personId, eventType: "STAFF_JOINED", occurredOn: input.date, appointmentId: appointment.id, teamId: input.nationalTeamId, description: "Appointed as national-team head coach." });
  return appointment;
};

const staffPerson = (db: GameDatabase, id: EntityId, name: string, countryId: EntityId, date: string): Person => { const world = new WorldRepository(db); const existing = world.getPerson(id); if (existing) return existing; const person: Person = { id, fullName: name, displayName: name, dateOfBirth: "1978-01-01", nationalityCountryId: countryId, genderPresentation: "unknown", languages: ["Nepali", "English"] }; world.insertPerson(person); world.insertPersonRole({ id: createStableEntityId("person-role", `${id}:STAFF`), personId: id, role: "STAFF", activeFrom: date }); return person; };

export const ensureNationalTeamStaffStructure = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; date: string }): Array<{ role: FootballStaffRole; personId: EntityId }> => {
  const countryId = (db.prepare("SELECT country_id FROM federations WHERE id=?").get(input.federationId) as { country_id: EntityId } | undefined)?.country_id;
  if (!countryId) throw new Error("Federation not found");
  const team = db.prepare("SELECT name, level, gender FROM teams WHERE id=?").get(input.nationalTeamId) as { name: string; level: string; gender: string } | undefined;
  if (!team) throw new Error("National team not found");
  const organisationNames = [team.name];
  if (team.level === "senior" && team.gender === "women") organisationNames.push("Nepal Women's Senior National Team");
  const useImportedSeniorMenCoach = team.level === "senior" && team.gender === "men";
  const roles: Array<[FootballStaffRole, string]> = [["NATIONAL_TEAM_HEAD_COACH", "National Team Head Coach"], ["NATIONAL_TEAM_ASSISTANT", "National Team Assistant"], ["SPORTS_SCIENTIST", "National Team Performance Coach"], ["NATIONAL_TEAM_PHYSIO", "National Team Medical Lead"], ["NATIONAL_TEAM_ANALYST", "National Team Scout Analyst"]];
  const world = new WorldRepository(db);
  const result: Array<{ role: FootballStaffRole; personId: EntityId }> = [];
  for (const [role, name] of roles) {
    const existing = db.prepare(
      `SELECT id, person_id, team_id FROM staff_appointments
       WHERE role = ? AND employment_status = 'ACTIVE'
         AND (team_id = ? OR (team_id IS NULL AND federation_id = ? AND organisation_name IN (${organisationNames.map(() => "?").join(",")})))
       ORDER BY CASE WHEN team_id = ? THEN 0 ELSE 1 END, id
       LIMIT 1`,
    ).get(role, input.nationalTeamId, input.federationId, ...organisationNames, input.nationalTeamId) as { id: EntityId; person_id: EntityId; team_id?: EntityId } | undefined;
    if (existing && existing.team_id !== input.nationalTeamId) {
      db.prepare("UPDATE staff_appointments SET team_id = ? WHERE id = ?").run(input.nationalTeamId, existing.id);
    }
    /*
     * The global seed may already contain a verified current Nepal staff
     * identity. Reuse it before creating the gameplay-only fallback, so the
     * appointment relationship does not erase factual coverage at the point
     * where national-team gameplay becomes active.
     */
    const imported = !existing && useImportedSeniorMenCoach && role === "NATIONAL_TEAM_HEAD_COACH"
      ? db.prepare(
        `SELECT canonical_id AS person_id
         FROM global_dataset_import_records
         WHERE entity_type = 'STAFF'
           AND provenance IN ('VERIFIED', 'REPORTED', 'ESTIMATED')
           AND (json_extract(payload_json, '$.role') = ?
                OR (? = 'NATIONAL_TEAM_HEAD_COACH' AND json_extract(payload_json, '$.role') = 'HEAD_COACH'))
           AND lower(json_extract(payload_json, '$.current_club_or_federation')) = 'nepal national team'
         ORDER BY CASE provenance WHEN 'VERIFIED' THEN 0 WHEN 'REPORTED' THEN 1 ELSE 2 END, canonical_id
         LIMIT 1`,
      ).get(role, role) as { person_id?: EntityId } | undefined
      : undefined;
    const factualPersonId = imported?.person_id;
    const personId = existing?.person_id ?? factualPersonId ?? createStableEntityId("person", `national-team-staff:${input.nationalTeamId}:${role}`);
    if (!existing) {
      if (!factualPersonId) {
        staffPerson(db, personId, name, countryId, input.date);
        const profile: StaffProfile = { id: createStableEntityId("staff-profile", personId), personId, preferredRole: role, salaryExpectation: "NATIONAL_TEAM_SCALE", reputation: "SIMULATION_ONLY", countryKnowledge: [countryId], clubKnowledge: [], availability: "EMPLOYED", workEligibilityStatus: "ELIGIBLE" };
        world.insertStaffProfile(profile);
      } else {
        db.prepare("UPDATE staff_profiles SET availability = 'EMPLOYED' WHERE person_id = ?").run(factualPersonId);
      }
      world.insertStaffAppointment({ id: createStableEntityId("staff-appointment", `${input.nationalTeamId}:${role}`), personId, organisationType: "NATIONAL_TEAM", teamId: input.nationalTeamId, federationId: input.federationId, role, startDate: input.date, employmentStatus: "ACTIVE" });
    }
    result.push({ role, personId });
  }
  return result;
};

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

/**
 * The simulation's own entry into a competition edition: one campaign record and
 * one final squad registration per team and edition. Created once; never
 * overwritten, so a later pass cannot replace a registered squad. The squad is
 * the selection the simulation already made for the edition, not a second one.
 */
export const recordNationalTeamEditionEntry = (
  db: GameDatabase,
  input: {
    federationId: EntityId;
    nationalTeamId: EntityId;
    edition: { id: EntityId; name: string; startDate: string };
    squadPlayerIds: EntityId[];
    registrationDeadline: string;
  },
): { campaign: NationalTeamCampaign; registration?: NationalTeamSquadRegistration } => {
  const repo = new NationalTeamManagementRepository(db);
  const campaign =
    repo.campaigns(input.nationalTeamId).find((item) => item.competitionEditionId === input.edition.id) ??
    registerNationalTeamCampaign(db, {
      federationId: input.federationId,
      nationalTeamId: input.nationalTeamId,
      name: `${input.edition.name} campaign`,
      startedOn: input.edition.startDate,
      competitionEditionId: input.edition.id,
    });
  const existing = repo.registrations().find((item) => item.nationalTeamId === input.nationalTeamId && item.competitionEditionId === input.edition.id);
  if (existing || input.squadPlayerIds.length === 0) return { campaign, registration: existing };
  const registration: NationalTeamSquadRegistration = {
    id: createStableEntityId("national-team-registration", `${input.edition.id}:${input.nationalTeamId}`),
    federationId: input.federationId,
    nationalTeamId: input.nationalTeamId,
    competitionEditionId: input.edition.id,
    registrationDeadline: input.registrationDeadline,
    provisionalPlayerIds: input.squadPlayerIds,
    finalPlayerIds: input.squadPlayerIds,
    status: "FINAL",
    provenanceStatus: status,
  };
  repo.upsertRegistration(registration);
  return { campaign, registration };
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

const policyScore = (db: GameDatabase, playerId: EntityId, policy: NationalTeamSelectionPolicy, nationalTeamId: EntityId): number => {
  const appearances = (db.prepare("SELECT COUNT(*) AS count FROM national_team_appearances WHERE player_id=? AND national_team_id=?").get(playerId, nationalTeamId) as { count: number }).count; const person = db.prepare("SELECT date_of_birth,second_nationality_country_id FROM persons WHERE id=?").get(playerId) as { date_of_birth?: string; second_nationality_country_id?: EntityId } | undefined; const age = person?.date_of_birth ? 2026 - Number(person.date_of_birth.slice(0, 4)) : 25; const diaspora = person?.second_nationality_country_id ? 1 : 0;
  if (policy === "FORM_FIRST") return appearances * 2; if (policy === "EXPERIENCE_FIRST") return appearances * 3 + age * 0.02; if (policy === "YOUTH_DEVELOPMENT") return Math.max(0, 30 - age) + appearances * 0.2; if (policy === "DIASPORA_INCLUSIVE") return appearances + diaspora * 3; if (policy === "DOMESTIC_CORE") return appearances + (diaspora ? 0 : 2); return appearances + age * 0.05;
};

export const recommendNationalTeamSelection = (db: GameDatabase, input: { federationId: EntityId; nationalTeamId: EntityId; date: string; programme: string; seed: string; policy: NationalTeamSelectionPolicy; size?: number; managerPersonId?: EntityId; tacticalSetupId?: EntityId; tacticalStyle?: string; competitionEditionId?: EntityId }): NationalTeamManagementDecision => {
  const decision = selectManagedNationalTeamSquad(db, input); const ordered = [...decision.selectedPlayerIds].sort((a, b) => policyScore(db, b, input.policy, input.nationalTeamId) - policyScore(db, a, input.policy, input.nationalTeamId) || a.localeCompare(b)); const repo = new NationalTeamManagementRepository(db); const next = { ...decision, selectedPlayerIds: ordered, captainPlayerId: decision.captainPlayerId && ordered.includes(decision.captainPlayerId) ? decision.captainPlayerId : ordered[0] }; repo.upsertDecision(next);
  for (const playerId of ordered) { const eligibility = new FederationGovernanceRepository(db).internationalEligibilities(input.federationId).find((item) => item.playerId === playerId); const item: NationalTeamWatchlistItem = { id: createStableEntityId("national-team-watchlist", `${input.nationalTeamId}:${playerId}`), federationId: input.federationId, nationalTeamId: input.nationalTeamId, playerId, playerKnowledgeLevel: eligibility?.status === "ELIGIBLE" ? "BASIC" : "MINIMAL", reason: `${input.policy} selection recommendation`, lastReviewed: input.date, status: "SELECTED", provenanceStatus: status }; repo.upsertWatchlist(item); }
  return next;
};

export const planNationalTeamOperations = (db: GameDatabase, input: Omit<NationalTeamOperationalPlan, "id" | "status" | "provenanceStatus">): NationalTeamOperationalPlan => { const plan: NationalTeamOperationalPlan = { ...input, id: createStableEntityId("national-team-operational-plan", `${input.nationalTeamId}:${input.campStart}:${input.competitionEditionId ?? "window"}`), status: "PLANNED", provenanceStatus: status }; new NationalTeamManagementRepository(db).upsertOperationalPlan(plan); return plan; };

export const refreshNationalTeamInternationalForm = (db: GameDatabase, input: { nationalTeamId: EntityId; windowDate: string }): NationalTeamInternationalForm[] => { const appearances = new FederationGovernanceRepository(db).nationalTeamAppearances(input.nationalTeamId); const byPlayer = new Map<EntityId, NationalTeamInternationalForm>(); for (const appearance of appearances) { const previous = byPlayer.get(appearance.playerId) ?? { id: createStableEntityId("national-team-form", `${input.nationalTeamId}:${appearance.playerId}:${input.windowDate}`), nationalTeamId: input.nationalTeamId, playerId: appearance.playerId, windowDate: input.windowDate, appearances: 0, minutes: 0, goals: 0, formRating: 0, rationale: "International appearance record", provenanceStatus: status }; previous.appearances += 1; previous.minutes += appearance.minutes; previous.goals += appearance.goals; previous.formRating = Math.min(10, Number((previous.appearances * 0.8 + previous.goals * 1.4 + previous.minutes / 180).toFixed(2))); byPlayer.set(appearance.playerId, previous); } const repo = new NationalTeamManagementRepository(db); for (const form of byPlayer.values()) repo.upsertInternationalForm(form); return [...byPlayer.values()].sort((a, b) => a.playerId.localeCompare(b.playerId)); };
