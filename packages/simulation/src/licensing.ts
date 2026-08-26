import { ClubEconomyRepository, ClubLicensingRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type ClubLicenceCase, type ClubLicenceHistoryEvent, type ClubLicenceRemediation, type EntityId } from "@nepal-football-sim/shared-types";

const simulationStatus = "SIMULATION_ONLY" as const;
const nextDeadline = (date: string) => `${Number(date.slice(0, 4)) + 1}-03-31`;
const event = (date: string, action: ClubLicenceHistoryEvent["action"], note: string): ClubLicenceHistoryEvent => ({ date, action, note });

const requirementsFor = (db: GameDatabase, input: { clubId: EntityId; competitionSeasonId: EntityId; date: string }): ClubLicenceRemediation[] => {
  const economy = new ClubEconomyRepository(db); const account = economy.financialAccount(input.clubId); const facility = economy.facilityProfile(input.clubId);
  const venue = db.prepare("SELECT 1 FROM venue_relationships WHERE club_id=? AND status NOT IN ('CLOSED','unavailable') LIMIT 1").get(input.clubId);
  const staff = Number((db.prepare("SELECT COUNT(*) AS count FROM staff_appointments WHERE club_id=? AND employment_status='ACTIVE'").get(input.clubId) as any)?.count ?? 0);
  const category = (db.prepare("SELECT c.category FROM competition_seasons cs JOIN competitions c ON c.id=cs.competition_id WHERE cs.id=?").get(input.competitionSeasonId) as { category?: string } | undefined)?.category;
  const deadline = nextDeadline(input.date); const result: ClubLicenceRemediation[] = [];
  if ((account?.cashBalance ?? 0) - (account?.debtBalance ?? 0) < 0) result.push({ key: "FINANCE", requirement: "Restore positive cash after debt obligations", deadline, completed: false });
  if (!venue) result.push({ key: "STADIUM", requirement: "Secure an approved venue use right", deadline, completed: false });
  if (!facility || (facility.trainingFacilityQuality ?? 0) < 1) result.push({ key: "FACILITY", requirement: "Provide a basic training facility", deadline, completed: false });
  if (staff < 1) result.push({ key: "STAFF", requirement: "Appoint an active football staff member", deadline, completed: false });
  if (category === "WOMENS_LEAGUE" && (!facility || (facility.youthFacilityQuality ?? 0) < 1)) result.push({ key: "PROGRAMME", requirement: "Provide supported programme access", deadline, completed: false });
  return result;
};

export const openClubLicenceCycle = (db: GameDatabase, input: { federationId: EntityId; clubId: EntityId; competitionSeasonId: EntityId; seasonLabel: string; date: string }): ClubLicenceCase => {
  const repo = new ClubLicensingRepository(db); const existing = repo.cases(input.competitionSeasonId).find((item) => item.clubId === input.clubId);
  if (existing) return existing;
  const result: ClubLicenceCase = { id: createStableEntityId("club-licence-case", `${input.federationId}:${input.clubId}:${input.competitionSeasonId}`), federationId: input.federationId, clubId: input.clubId, competitionSeasonId: input.competitionSeasonId, seasonLabel: input.seasonLabel, status: "PENDING", remediation: [], sanctions: [], history: [event(input.date, "OPENED", "Seasonal licence application opened")], reviewedAt: input.date, provenanceStatus: simulationStatus };
  repo.upsert(result); return result;
};

export const assessClubLicence = (db: GameDatabase, input: { federationId: EntityId; clubId: EntityId; competitionSeasonId: EntityId; seasonLabel: string; date: string }): ClubLicenceCase => {
  const repo = new ClubLicensingRepository(db); const current = openClubLicenceCycle(db, input); const remediation = requirementsFor(db, input); const critical = remediation.some((item) => item.key === "FINANCE" || item.key === "STADIUM");
  if (current.status !== "PENDING" && current.reviewedAt === input.date && current.remediation.length === remediation.length && current.remediation.every((item, index) => item.key === remediation[index]?.key)) return current;
  const status = remediation.length === 0 ? "PASSED" : critical ? "FAILED" : "CONDITIONAL"; const sanctions = status === "FAILED" ? ["REGISTRATION_RESTRICTION"] : [];
  const history = [...current.history, event(input.date, "ASSESSED", `Evidence check found ${remediation.length} open requirement(s)`), event(input.date, status === "PASSED" ? "PASSED" : status === "CONDITIONAL" ? "CONDITIONAL" : "FAILED", `Licence decision: ${status}`)];
  const result = { ...current, status: status as ClubLicenceCase["status"], remediation, sanctions, history, reviewedAt: input.date }; repo.upsert(result); return result;
};

export const finaliseClubLicence = (db: GameDatabase, input: { caseId: EntityId; date: string }): ClubLicenceCase => {
  const repo = new ClubLicensingRepository(db); const current = repo.get(input.caseId); if (!current) throw new Error("Licence case not found");
  const open = current.remediation.filter((item) => !item.completed); const expired = open.some((item) => input.date > item.deadline); const status = open.length === 0 ? "PASSED" : expired ? "FAILED" : "CONDITIONAL";
  const sanctions = status === "FAILED" ? ["REGISTRATION_RESTRICTION"] : []; const result = { ...current, status: status as ClubLicenceCase["status"], sanctions, history: [...current.history, event(input.date, status === "PASSED" ? "PASSED" : "FAILED", `Final decision from ${open.length} outstanding requirement(s)`)], reviewedAt: input.date }; repo.upsert(result); return result;
};

export const appealClubLicence = (db: GameDatabase, input: { caseId: EntityId; date: string }): ClubLicenceCase => {
  const repo = new ClubLicensingRepository(db); const current = repo.get(input.caseId); if (!current || !["FAILED", "CONDITIONAL"].includes(current.status)) throw new Error("Licence is not appealable");
  const unresolved = requirementsFor(db, { clubId: current.clubId, competitionSeasonId: current.competitionSeasonId, date: input.date }); const status = unresolved.length === 0 ? "RESOLVED" : "FAILED"; const result = { ...current, status: status as ClubLicenceCase["status"], remediation: unresolved, sanctions: status === "FAILED" ? ["REGISTRATION_RESTRICTION"] : [], history: [...current.history, event(input.date, "APPEALED", "Appeal re-evaluated persisted club evidence"), event(input.date, status, status === "RESOLVED" ? "Appeal upheld on updated evidence" : "Appeal denied; requirements remain open")], reviewedAt: input.date }; repo.upsert(result); return result;
};

export const closeClubLicenceCycle = (db: GameDatabase, input: { caseId: EntityId; date: string }): ClubLicenceCase => { const repo = new ClubLicensingRepository(db); const current = repo.get(input.caseId); if (!current) throw new Error("Licence case not found"); const result = { ...current, status: "RESOLVED" as const, history: [...current.history, event(input.date, "CLOSED", "Seasonal licensing record archived")], reviewedAt: input.date }; repo.upsert(result); return result; };
export const clubMayEnterCompetition = (db: GameDatabase, competitionSeasonId: EntityId, clubId: EntityId) => { const item = new ClubLicensingRepository(db).cases(competitionSeasonId).find((entry) => entry.clubId === clubId); return item?.status === "PASSED" || item?.status === "RESOLVED" || item?.status === "CONDITIONAL"; };
