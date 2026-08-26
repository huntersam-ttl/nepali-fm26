import { ClubEconomyRepository, OwnershipInvestorRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type ClubOwnershipStake, type EntityId, type InvestorExpectation, type InvestorExpectationType, type OwnershipInvestorProfile, type OwnerInvestmentForm } from "@nepal-football-sim/shared-types";
import { calculateAcquisitionValuation } from "./ownership.js";
import { investPersonalFunds } from "./club-economy.js";

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const expectationTypes: InvestorExpectationType[] = ["FINANCIAL_RETURN", "SPORTING_GROWTH", "INFRASTRUCTURE_GROWTH", "REPUTATION_GROWTH"];

export const createInvestorProfile = (db: GameDatabase, input: { clubId: EntityId; personId: EntityId; date: string; expectations?: Partial<Record<InvestorExpectationType, number>> }): OwnershipInvestorProfile => {
  const economy = new ClubEconomyRepository(db);
  if (!economy.personalFinancialProfile(input.personId)) throw new Error("Personal financial profile missing");
  const stake = economy.ownershipStakes(input.clubId).find((item) => item.holderId === input.personId && item.status === "ACTIVE");
  const expectations = Object.fromEntries(expectationTypes.map((type) => [type, { type, target: input.expectations?.[type] ?? 0.5, progress: 0, status: "ON_TRACK" }])) as Record<InvestorExpectationType, InvestorExpectation>;
  const profile: OwnershipInvestorProfile = { id: createStableEntityId("investor-profile", `${input.clubId}:${input.personId}`), clubId: input.clubId, personId: input.personId, influence: clamp((stake?.votingPercentage ?? stake?.percentage ?? 0) / 50, 0.1, 1), expectations, trust: 0.5, confidence: 0.5, lastReviewedOn: input.date, status: "ACTIVE", provenanceStatus: "SIMULATION_ONLY" };
  new OwnershipInvestorRepository(db).upsert(profile);
  return profile;
};

export const reviewInvestorConfidence = (db: GameDatabase, input: { clubId: EntityId; date: string }): OwnershipInvestorProfile[] => {
  const economy = new ClubEconomyRepository(db);
  const supporter = economy.supporterProfile(input.clubId);
  const facility = economy.facilityProfile(input.clubId);
  const valuation = calculateAcquisitionValuation(db, input.clubId, input.date);
  const cash = economy.financialAccount(input.clubId)?.cashBalance ?? 0;
  const played = Number((db.prepare("SELECT COUNT(*) AS count FROM matches m JOIN fixtures f ON f.id=m.fixture_id JOIN teams t ON (t.id=f.home_team_id OR t.id=f.away_team_id) WHERE t.club_id=? AND m.played_date IS NOT NULL").get(input.clubId) as any)?.count ?? 0);
  const progress: Record<InvestorExpectationType, number> = { FINANCIAL_RETURN: clamp(cash / Math.max(valuation * 0.1, 1)), SPORTING_GROWTH: clamp(played / 10), INFRASTRUCTURE_GROWTH: clamp(((facility?.trainingFacilityQuality ?? 0) + (facility?.youthFacilityQuality ?? 0) + (facility?.medicalFacilityQuality ?? 0)) / 30), REPUTATION_GROWTH: clamp((supporter?.footballReputation ?? 0) / 100) };
  const repo = new OwnershipInvestorRepository(db);
  return repo.profiles(input.clubId).map((profile) => {
    let misses = 0;
    const expectations = { ...profile.expectations };
    for (const type of expectationTypes) {
      const target = expectations[type]?.target ?? 0.5;
      const value = progress[type];
      const status = value >= target ? "MET" : value >= target * 0.65 ? "ON_TRACK" : value >= target * 0.35 ? "AT_RISK" : "MISSED";
      if (status === "MISSED") misses += 1;
      expectations[type] = { ...expectations[type], progress: value, status };
    }
    const updated = { ...profile, expectations, confidence: clamp(profile.confidence + (misses ? -0.05 : 0.03)), trust: clamp(profile.trust + (misses ? -0.03 : 0.02)), lastReviewedOn: input.date };
    repo.upsert(updated);
    return updated;
  });
};

export const investorDecisionAuthority = (db: GameDatabase, input: { clubId: EntityId; personId: EntityId; decision: "BUDGET" | "INFRASTRUCTURE" | "MANAGER_APPOINTMENT" | "MAJOR_TRANSFER" | "CAPITAL_INJECTION" }): boolean => {
  const stake = new ClubEconomyRepository(db).ownershipStakes(input.clubId).find((item) => item.holderId === input.personId && item.status === "ACTIVE");
  const vote = stake?.votingPercentage ?? stake?.percentage ?? 0;
  return vote >= 51 || (input.decision === "CAPITAL_INJECTION" && vote > 0) || (input.decision === "BUDGET" && vote >= 25);
};

export const capitalInjectionFromInvestor = (db: GameDatabase, input: { clubId: EntityId; personId: EntityId; date: string; amount: number; form: "EQUITY" | "SHAREHOLDER_LOAN" }) => {
  if (!investorDecisionAuthority(db, { ...input, decision: "CAPITAL_INJECTION" })) throw new Error("Investor lacks capital authority");
  const transaction = investPersonalFunds(db, { ...input, form: input.form as OwnerInvestmentForm });
  if (input.form !== "EQUITY") return transaction;
  const economy = new ClubEconomyRepository(db);
  const stakes = economy.ownershipStakes(input.clubId).filter((item) => item.status === "ACTIVE" && item.percentage != null);
  const valuation = calculateAcquisitionValuation(db, input.clubId, input.date);
  const added = clamp(input.amount / Math.max(valuation + input.amount, 1), 0, 0.49);
  const own = stakes.find((item) => item.holderId === input.personId);
  for (const stake of stakes) { const percentage = (stake.percentage ?? 0) * (1 - added); economy.upsertOwnershipStake({ ...stake, percentage, votingPercentage: percentage }); }
  const person = db.prepare("SELECT display_name, full_name FROM persons WHERE id=?").get(input.personId) as any;
  const percentage = (own?.percentage ?? 0) + added * 100;
  const stake: ClubOwnershipStake = { id: createStableEntityId("ownership-stake", `${input.clubId}:${input.personId}`), clubId: input.clubId, holderType: "PERSON", holderId: input.personId, holderName: person?.display_name ?? person?.full_name ?? input.personId, role: percentage >= 51 ? "MAJORITY_OWNER" : "MINORITY_OWNER", percentage, votingPercentage: percentage, startDate: own?.startDate ?? input.date, status: "ACTIVE", ownershipModel: "PARTIALLY_BUYABLE", provenanceStatus: "SIMULATION_ONLY" };
  economy.upsertOwnershipStake(stake);
  return transaction;
};
