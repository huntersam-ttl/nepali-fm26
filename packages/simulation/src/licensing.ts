import { ClubEconomyRepository, ClubLicensingRepository, CompetitionRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type ClubLicenceCase, type ClubLicenceRemediation, type EntityId } from "@nepal-football-sim/shared-types";

const status = "SIMULATION_ONLY" as const;
const deadline = (date: string) => `${Number(date.slice(0, 4)) + 1}-03-31`;
const outcome = (ok: boolean, conditional: boolean) => ok ? "LICENSED" as const : conditional ? "CONDITIONAL" as const : "FAILED" as const;

export const assessClubLicence = (db: GameDatabase, input: { federationId: EntityId; clubId: EntityId; competitionSeasonId: EntityId; seasonLabel: string; date: string }): ClubLicenceCase => {
  const economy = new ClubEconomyRepository(db);
  const account = economy.financialAccount(input.clubId);
  const facility = economy.facilityProfile(input.clubId);
  const venue = db.prepare("SELECT 1 FROM venue_relationships WHERE club_id=? AND status NOT IN ('CLOSED','unavailable') LIMIT 1").get(input.clubId);
  const staff = Number((db.prepare("SELECT COUNT(*) AS count FROM staff_appointments WHERE club_id=? AND employment_status='ACTIVE'").get(input.clubId) as any)?.count ?? 0);
  const season = db.prepare("SELECT c.category FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=?").get(input.competitionSeasonId) as { category?: string } | undefined;
  const requirements: ClubLicenceRemediation[] = [];
  if ((account?.cashBalance ?? 0) - (account?.debtBalance ?? 0) < 0) requirements.push({ key:"FINANCE", requirement:"Restore positive cash after debt obligations", deadline:deadline(input.date), completed:false });
  if (!venue) requirements.push({ key:"STADIUM", requirement:"Secure an approved venue use right", deadline:deadline(input.date), completed:false });
  if (!facility || (facility.trainingFacilityQuality ?? 0) < 1) requirements.push({ key:"FACILITY", requirement:"Provide a basic training facility", deadline:deadline(input.date), completed:false });
  if (staff < 1) requirements.push({ key:"STAFF", requirement:"Appoint an active football staff member", deadline:deadline(input.date), completed:false });
  if (season?.category === "WOMENS_LEAGUE" && (!facility || (facility.youthFacilityQuality ?? 0) < 1)) requirements.push({ key:"PROGRAMME", requirement:"Provide supported women/youth programme access", deadline:deadline(input.date), completed:false });
  const critical = requirements.filter((item) => ["FINANCE","STADIUM"].includes(item.key)).length;
  const overall = outcome(requirements.length === 0, critical === 0);
  const result: ClubLicenceCase = { id:createStableEntityId("club-licence-case",`${input.federationId}:${input.clubId}:${input.competitionSeasonId}`), federationId:input.federationId, clubId:input.clubId, competitionSeasonId:input.competitionSeasonId, seasonLabel:input.seasonLabel, status:overall === "LICENSED" ? "PASSED" : overall === "CONDITIONAL" ? "CONDITIONAL" : "FAILED", remediation:requirements, sanctions:overall === "FAILED" ? ["REGISTRATION_RESTRICTION"] : [], reviewedAt:input.date, provenanceStatus:status };
  new ClubLicensingRepository(db).upsert(result); return result;
};

export const resolveClubLicence = (db: GameDatabase, input: { caseId: EntityId; date: string }): ClubLicenceCase => {
  const repo = new ClubLicensingRepository(db); const current = repo.get(input.caseId); if (!current) throw new Error("Licence case not found");
  const next = { ...current, remediation: current.remediation.map((item) => ({ ...item, completed: item.completed || input.date <= item.deadline })), status: current.remediation.every((item) => item.completed || input.date > item.deadline) ? "RESOLVED" as const : "CONDITIONAL" as const, reviewedAt:input.date };
  repo.upsert(next); return next;
};

export const clubMayEnterCompetition = (db: GameDatabase, competitionSeasonId: EntityId, clubId: EntityId) => { const item = new ClubLicensingRepository(db).cases(competitionSeasonId).find((entry) => entry.clubId === clubId); return item?.status === "PASSED" || item?.status === "RESOLVED" || item?.status === "CONDITIONAL"; };
