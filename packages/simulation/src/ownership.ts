import { ClubEconomyRepository, EventRepository, OwnershipRepository, WorldRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type ClubOwnershipModel, type ClubOwnershipStake, type EntityId, type OwnershipAcquisitionOffer, type OwnershipAcquisitionTransaction, type Person } from "@nepal-football-sim/shared-types";
import { calculateClubValuation } from "./club-economy.js";

const status = "SIMULATION_ONLY" as const;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export const calculateAcquisitionValuation = (db: GameDatabase, clubId: EntityId, date: string) => {
  const base = calculateClubValuation(db, clubId, date).valuation; const economy = new ClubEconomyRepository(db); const supporters = economy.supporterProfile(clubId); const commercial = economy.commercialProfile(clubId); const facility = economy.facilityProfile(clubId); const competitions = Number((db.prepare("SELECT COUNT(*) AS count FROM club_memberships WHERE club_id = ? AND status IN ('ACTIVE','QUALIFIED','PROMOTED')").get(clubId) as { count?: number })?.count ?? 0); const supportValue = ((supporters?.coreSupporters ?? 0) + (supporters?.casualSupporters ?? 0) * 0.4 + (supporters?.diasporaSupport ?? 0) * 0.7) * 40; const commercialValue = ((commercial?.brandStrength ?? 0) + (commercial?.digitalReach ?? 0)) * 80000; const facilityValue = ((facility?.trainingFacilityQuality ?? 0) + (facility?.youthFacilityQuality ?? 0) + (facility?.medicalFacilityQuality ?? 0)) * 50000; return Math.max(250000, Math.round(base + supportValue + commercialValue + facilityValue + competitions * 100000));
};

export const createOwnershipEnquiry = (db: GameDatabase, input: { clubId: EntityId; buyerPersonId: EntityId; percentage: number; date: string; sellerHolderId?: EntityId }): OwnershipAcquisitionOffer => {
  if (input.percentage <= 0 || input.percentage > 100) throw new Error("Ownership percentage is invalid"); if (!db.prepare("SELECT 1 FROM clubs WHERE id = ?").get(input.clubId)) throw new Error("Club does not exist"); const value: OwnershipAcquisitionOffer = { id: createStableEntityId("ownership-offer", `${input.clubId}:${input.buyerPersonId}:${input.date}:${input.percentage}`), clubId: input.clubId, buyerPersonId: input.buyerPersonId, sellerHolderId: input.sellerHolderId, percentage: input.percentage, offerAmount: 0, status: "ENQUIRY", createdOn: input.date, provenanceStatus: status }; new OwnershipRepository(db).upsertOffer(value); return value;
};

export const submitOwnershipOffer = (db: GameDatabase, input: { enquiryId: EntityId; amount: number; date: string }): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db); const enquiry = repo.offer(input.enquiryId); if (!enquiry || enquiry.status !== "ENQUIRY") throw new Error("Ownership enquiry is unavailable"); if (input.amount <= 0) throw new Error("Ownership offer must be positive"); const value = { ...enquiry, offerAmount: Math.round(input.amount), status: "OFFER" as const, createdOn: enquiry.createdOn }; repo.upsertOffer(value); return value;
};

export const counterOwnershipOffer = (db: GameDatabase, input: { offerId: EntityId; amount: number; date: string }): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db); const current = repo.offer(input.offerId); if (!current || !["OFFER", "COUNTER"].includes(current.status)) throw new Error("Ownership offer is unavailable"); const next = { ...current, counterAmount: Math.round(input.amount), status: "COUNTER" as const, rationale: "Existing owners requested terms closer to the club valuation." }; repo.upsertOffer(next); return next;
};

export const decideOwnershipOffer = (db: GameDatabase, input: { offerId: EntityId; date: string; accept?: boolean }): OwnershipAcquisitionOffer => {
  const repo = new OwnershipRepository(db); const current = repo.offer(input.offerId); if (!current || !["OFFER", "COUNTER"].includes(current.status)) throw new Error("Ownership offer is unavailable"); const amount = current.counterAmount ?? current.offerAmount; const club = db.prepare("SELECT ownership_type FROM clubs WHERE id = ?").get(current.clubId) as { ownership_type?: string } | undefined; const valuation = calculateAcquisitionValuation(db, current.clubId, input.date); const personal = new ClubEconomyRepository(db).personalFinancialProfile(current.buyerPersonId); const offered = input.accept !== false && (personal?.cash ?? 0) >= amount && amount >= Math.round(valuation * 0.85) && !(current.percentage > 49 && ["DEPARTMENTAL", "MUNICIPALITY_BACKED"].includes(club?.ownership_type ?? "")); const next = { ...current, status: offered ? "ACCEPTED" as const : "REJECTED" as const, decidedOn: input.date, rationale: offered ? "Owners accepted a financially credible offer." : "Owners declined because value, control, or ownership restrictions were not met." }; repo.upsertOffer(next); if (offered) completeAcquisition(db, next, amount, input.date); return next;
};

const completeAcquisition = (db: GameDatabase, offer: OwnershipAcquisitionOffer, amount: number, date: string): OwnershipAcquisitionTransaction => {
  const economy = new ClubEconomyRepository(db);
  const priorTransaction = new OwnershipRepository(db).transactions(offer.clubId).find((item) => item.offerId === offer.id);
  if (priorTransaction) return priorTransaction;
  const personal = economy.personalFinancialProfile(offer.buyerPersonId);
  if (!personal || personal.cash < amount) throw new Error("Personal cash is insufficient for acquisition");
  const active = economy.ownershipStakes(offer.clubId).filter((stake) => stake.status === "ACTIVE");
  const existing = active.find((stake) => stake.holderId === offer.buyerPersonId);
  const controlTransfer = offer.percentage >= 51 && Boolean(offer.sellerHolderId || active.some((stake) => !stake.holderId));
  const replaced = controlTransfer ? (offer.percentage >= 100 ? active : active.filter((stake) => !offer.sellerHolderId || stake.holderId === offer.sellerHolderId || !stake.holderId)) : [];
  const retained = active.filter((stake) => !replaced.includes(stake));
  const definedTotal = retained.reduce((sum, stake) => sum + (stake.percentage ?? 0), 0) - (existing?.percentage ?? 0);
  const totalPercentage = (existing?.percentage ?? 0) + offer.percentage;
  if (definedTotal + totalPercentage > 100) throw new Error("Ownership percentage exceeds available shares");
  const person = db.prepare("SELECT display_name, full_name FROM persons WHERE id = ?").get(offer.buyerPersonId) as { display_name?: string; full_name: string } | undefined;
  const model: ClubOwnershipModel = totalPercentage >= 51 ? "BUYABLE" : "PARTIALLY_BUYABLE";
  const stake: ClubOwnershipStake = { id: createStableEntityId("ownership-stake", `${offer.clubId}:${offer.buyerPersonId}`), clubId: offer.clubId, holderType: "PERSON", holderId: offer.buyerPersonId, holderName: person?.display_name ?? person?.full_name ?? offer.buyerPersonId, role: totalPercentage >= 51 ? "MAJORITY_OWNER" : "MINORITY_OWNER", percentage: totalPercentage, votingPercentage: totalPercentage, startDate: existing?.startDate ?? date, status: "ACTIVE", ownershipModel: model, provenanceStatus: status };
  economy.updatePersonalCash(offer.buyerPersonId, -amount, date);
  if (offer.sellerHolderId && offer.sellerHolderId !== offer.buyerPersonId && economy.personalFinancialProfile(offer.sellerHolderId)) economy.updatePersonalCash(offer.sellerHolderId, amount, date);
  for (const prior of replaced) {
    recordOwnershipEra(db, offer.clubId, prior, date);
    db.prepare("UPDATE club_ownership_stakes SET status='FORMER', end_date=? WHERE id=? AND status='ACTIVE'").run(date, prior.id);
    db.prepare("UPDATE club_ownership_history SET end_date=?, exit_reason=?, successor_holder_id=?, acquisition_price=?, percentage=? WHERE club_id=? AND holder_id IS ? AND end_date IS NULL").run(date, "VOLUNTARY_SALE", offer.buyerPersonId, amount, prior.percentage ?? null, offer.clubId, prior.holderId ?? null);
  }
  economy.upsertOwnershipStake(stake);
  db.prepare("INSERT OR IGNORE INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(stake.id, offer.clubId, offer.buyerPersonId, stake.holderName, date, null, null, null, amount, offer.percentage, status);
  if (totalPercentage >= 51) db.prepare("UPDATE clubs SET ownership_type = 'PRIVATE' WHERE id = ?").run(offer.clubId);
  const transaction: OwnershipAcquisitionTransaction = { id: createStableEntityId("ownership-transaction", offer.id), offerId: offer.id, clubId: offer.clubId, buyerPersonId: offer.buyerPersonId, sellerHolderId: offer.sellerHolderId, date, amount, percentage: offer.percentage, status: "POSTED", provenanceStatus: status };
  new OwnershipRepository(db).insertTransaction(transaction);
  new EventRepository(db).insertHistoricalEvent({ id: createStableEntityId("history", `OWNERSHIP_TRANSFER:${offer.id}`), occurredOn: date, eventType: "CLUB_OWNERSHIP_TRANSFERRED", involvedEntities: [{ id: offer.clubId, type: "club" }, { id: offer.buyerPersonId, type: "person" }], title: "Club ownership transferred", data: { amount, percentage: offer.percentage }, importance: "high", scope: "club" });
  return transaction;
};

export const withdrawOwnershipOffer = (db: GameDatabase, offerId: EntityId, date: string): OwnershipAcquisitionOffer => { const repo = new OwnershipRepository(db); const current = repo.offer(offerId); if (!current || ["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(current.status)) throw new Error("Ownership offer is unavailable"); const next = { ...current, status: "WITHDRAWN" as const, decidedOn: date }; repo.upsertOffer(next); return next; };

export type OwnershipSuccessionState = {
  clubId: EntityId;
  status: "TRANSITION" | "INTERIM" | "COMPLETED";
  exitReason: string;
  startedOn: string;
  nextReviewOn: string;
  interimHolderId?: EntityId;
  candidatePersonId?: EntityId;
  activeOfferId?: EntityId;
  completedOn?: string;
  attemptCount: number;
};

const daysAfter = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const successionState = (db: GameDatabase, clubId: EntityId): OwnershipSuccessionState | undefined => {
  const row = db.prepare("SELECT * FROM club_ownership_succession WHERE club_id=?").get(clubId) as any;
  return row ? { clubId: row.club_id, status: row.status, exitReason: row.exit_reason, startedOn: row.started_on, nextReviewOn: row.next_review_on, interimHolderId: row.interim_holder_id ?? undefined, candidatePersonId: row.candidate_person_id ?? undefined, activeOfferId: row.active_offer_id ?? undefined, completedOn: row.completed_on ?? undefined, attemptCount: row.attempt_count } : undefined;
};

const recordOwnershipEra = (db: GameDatabase, clubId: EntityId, stake: ClubOwnershipStake, date: string, exitReason?: string): void => {
  if (db.prepare("SELECT 1 FROM club_ownership_history WHERE id=?").get(stake.id)) return;
  db.prepare("INSERT INTO club_ownership_history (id,club_id,holder_id,holder_name,start_date,end_date,exit_reason,successor_holder_id,acquisition_price,percentage,provenance_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(stake.id, clubId, stake.holderId ?? null, stake.holderName, stake.startDate, stake.endDate ?? null, exitReason ?? null, null, null, stake.percentage ?? null, stake.provenanceStatus);
  if (date < stake.startDate) throw new Error("Ownership transition predates ownership era");
};

export const ownershipHistory = (db: GameDatabase, clubId?: EntityId): Array<Record<string, unknown>> => {
  const rows = (clubId ? db.prepare("SELECT * FROM club_ownership_history WHERE club_id=? ORDER BY start_date,id").all(clubId) : db.prepare("SELECT * FROM club_ownership_history ORDER BY club_id,start_date,id").all()) as any[];
  return rows.map((row) => ({ id: row.id, clubId: row.club_id, holderId: row.holder_id ?? undefined, holderName: row.holder_name, startDate: row.start_date, endDate: row.end_date ?? undefined, exitReason: row.exit_reason ?? undefined, successorHolderId: row.successor_holder_id ?? undefined, acquisitionPrice: row.acquisition_price ?? undefined, percentage: row.percentage ?? undefined, provenanceStatus: row.provenance_status }));
};

export const exitClubOwnership = (db: GameDatabase, input: { clubId: EntityId; ownerPersonId: EntityId; date: string; reason?: string; seed?: string }): OwnershipSuccessionState => {
  const economy = new ClubEconomyRepository(db);
  const stake = economy.ownershipStakes(input.clubId).find((item) => item.holderId === input.ownerPersonId && item.status === "ACTIVE");
  if (!stake) throw new Error("Active owner stake not found");
  const current = successionState(db, input.clubId);
  if (current && current.status !== "COMPLETED") return current;
  recordOwnershipEra(db, input.clubId, stake, input.date, input.reason ?? "OWNER_EXIT");
  db.prepare("UPDATE club_ownership_stakes SET status='FORMER', end_date=? WHERE id=? AND status='ACTIVE'").run(input.date, stake.id);
  db.prepare("INSERT INTO club_ownership_succession (club_id,status,exit_reason,started_on,next_review_on,candidate_person_id,active_offer_id,attempt_count,provenance_status) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(club_id) DO UPDATE SET status=excluded.status,exit_reason=excluded.exit_reason,started_on=excluded.started_on,next_review_on=excluded.next_review_on,candidate_person_id=NULL,active_offer_id=NULL,completed_on=NULL,attempt_count=0,provenance_status=excluded.provenance_status").run(input.clubId, "TRANSITION", input.reason ?? "OWNER_EXIT", input.date, input.date, null, null, 0, status);
  new EventRepository(db).insertHistoricalEvent({ id: createStableEntityId("history", `OWNERSHIP_SUCCESSION_STARTED:${input.clubId}:${input.date}`), occurredOn: input.date, eventType: "CLUB_OWNERSHIP_SUCCESSION_STARTED", involvedEntities: [{ id: input.clubId, type: "club" }, { id: input.ownerPersonId, type: "person" }], title: "Club ownership succession started", data: { reason: input.reason ?? "OWNER_EXIT" }, importance: "high", scope: "club" });
  return successionState(db, input.clubId)!;
};

const candidateForClub = (db: GameDatabase, clubId: EntityId, valuation: number): EntityId | undefined => {
  const row = db.prepare("SELECT p.id FROM personal_financial_profiles pf JOIN persons p ON p.id=pf.person_id WHERE pf.cash>=? AND NOT EXISTS (SELECT 1 FROM club_ownership_stakes s WHERE s.holder_id=pf.person_id AND s.status='ACTIVE' AND s.percentage>=51 AND s.club_id<>?) ORDER BY pf.cash DESC, p.id LIMIT 1").get(valuation, clubId) as { id?: EntityId } | undefined;
  return row?.id;
};

const generateOwnershipCandidate = (db: GameDatabase, clubId: EntityId, date: string, valuation: number, sequence: number): EntityId => {
  const club = db.prepare("SELECT name,country_id,location_id FROM clubs WHERE id=?").get(clubId) as { name: string; country_id: EntityId; location_id?: EntityId };
  const id = createStableEntityId("ownership-candidate", `${clubId}:${sequence}`);
  const person: Person = { id, fullName: `Simulation Ownership Candidate ${club.name}`, displayName: `Simulation Candidate ${club.name}`, dateOfBirth: "1974-01-01", nationalityCountryId: club.country_id, placeOfBirthLocationId: club.location_id, hometownLocationId: club.location_id, genderPresentation: "unknown", languages: ["Nepali"] };
  const world = new WorldRepository(db);
  if (!world.getPerson(id)) {
    world.insertPerson(person);
    world.insertPersonRole({ id: createStableEntityId("person-role", `${id}:CHAIRMAN`), personId: id, role: "CHAIRMAN", activeFrom: date });
  }
  if (!new ClubEconomyRepository(db).personalFinancialProfile(id)) {
    new ClubEconomyRepository(db).upsertPersonalFinancialProfile({ personId: id, cash: Math.max(Math.round(valuation * 1.25), 3000000), investments: 0, assets: Math.max(Math.round(valuation * 1.25), 3000000), liabilities: 0, netWorth: Math.max(Math.round(valuation * 1.25), 3000000), currency: "NPR", lastUpdatedAt: date, status });
  }
  return id;
};

export const processOwnershipSuccession = (db: GameDatabase, input: { clubId: EntityId; date: string; seed: string; allowGeneratedCandidate?: boolean }): OwnershipSuccessionState | undefined => {
  let state = successionState(db, input.clubId);
  if (!state || state.status === "COMPLETED" || state.nextReviewOn > input.date) return state;
  const valuation = calculateAcquisitionValuation(db, input.clubId, input.date);
  const candidate = state.candidatePersonId ?? candidateForClub(db, input.clubId, valuation) ?? (input.allowGeneratedCandidate === false ? undefined : generateOwnershipCandidate(db, input.clubId, input.date, valuation, state.attemptCount));
  if (!candidate) {
    db.prepare("UPDATE club_ownership_succession SET status='INTERIM',next_review_on=?,attempt_count=attempt_count+1 WHERE club_id=?").run(daysAfter(input.date, 90), input.clubId);
    return successionState(db, input.clubId);
  }
  const seller = db.prepare("SELECT holder_id FROM club_ownership_history WHERE club_id=? AND end_date=? ORDER BY id DESC LIMIT 1").get(input.clubId, input.date) as { holder_id?: EntityId } | undefined;
  const enquiry = createOwnershipEnquiry(db, { clubId: input.clubId, buyerPersonId: candidate, percentage: 100, sellerHolderId: seller?.holder_id, date: input.date });
  const offer = submitOwnershipOffer(db, { enquiryId: enquiry.id, amount: valuation, date: input.date });
  const decided = decideOwnershipOffer(db, { offerId: offer.id, date: input.date });
  if (decided.status !== "ACCEPTED") {
    db.prepare("UPDATE club_ownership_succession SET status='INTERIM',candidate_person_id=?,next_review_on=?,attempt_count=attempt_count+1 WHERE club_id=?").run(candidate, daysAfter(input.date, 90), input.clubId);
    return successionState(db, input.clubId);
  }
  db.prepare("UPDATE club_ownership_succession SET status='COMPLETED',candidate_person_id=?,active_offer_id=?,completed_on=?,next_review_on=?,attempt_count=attempt_count+1 WHERE club_id=?").run(candidate, offer.id, input.date, input.date, input.clubId);
  db.prepare("UPDATE club_ownership_history SET successor_holder_id=?,acquisition_price=? WHERE club_id=? AND end_date=? AND successor_holder_id IS NULL").run(candidate, valuation, input.clubId, input.date);
  state = successionState(db, input.clubId);
  return state;
};

export const processOwnershipContinuity = (db: GameDatabase, input: { date: string; seed: string; allowGeneratedCandidate?: boolean }): OwnershipSuccessionState[] => {
  const clubs = db.prepare("SELECT id FROM clubs ORDER BY id").all() as Array<{ id: EntityId }>;
  const states: OwnershipSuccessionState[] = [];
  for (const club of clubs) {
    const current = successionState(db, club.id);
    const active = new ClubEconomyRepository(db).ownershipStakes(club.id).filter((stake) => stake.status === "ACTIVE");
    if (!current && active.length === 0) {
      db.prepare("INSERT INTO club_ownership_succession (club_id,status,exit_reason,started_on,next_review_on,attempt_count,provenance_status) VALUES (?,?,?,?,?,?,?)").run(club.id, "INTERIM", "OWNERLESS_STATE", input.date, input.date, 0, status);
    }
    const next = processOwnershipSuccession(db, { ...input, clubId: club.id });
    if (next) states.push(next);
  }
  return states;
};
