import { createStableEntityId, type GovernmentFundingApplication, type GovernmentInstitution, type GovernmentFundingType } from "@nepal-football-sim/shared-types";
import { GovernmentRepository, type GameDatabase } from "@nepal-football-sim/database";

export type GovernmentFundingEvidence = {
  federationCredibility: number;
  projectQuality: number;
  footballPerformance: number;
  existingCommitments: number;
};

export type GovernmentFundingDecision = {
  status: GovernmentFundingApplication["status"];
  approvedAmount?: number;
  conditions: string[];
  reason: string;
};

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/** Pure, inspectable decision function; it never moves money between ledgers. */
export const evaluateGovernmentFunding = (input: {
  institution: GovernmentInstitution;
  requestedAmount: number;
  fundingType: GovernmentFundingType;
  evidence: GovernmentFundingEvidence;
}): GovernmentFundingDecision => {
  const profile = input.institution.profile;
  const available = Math.max(0, profile.budgetCapacity - profile.committedBudget);
  const priority = input.fundingType === "INFRASTRUCTURE" || input.fundingType === "REGIONAL_GROUND" || input.fundingType === "MUNICIPAL_LAND_OR_VENUE"
    ? profile.infrastructurePriority
    : input.fundingType === "YOUTH_GRASSROOTS" || input.fundingType === "WOMENS_FOOTBALL"
      ? profile.youthWomenPriority
      : profile.footballPriority;
  const score = clamp(priority * 0.25 + input.evidence.federationCredibility * 0.25 + input.evidence.projectQuality * 0.2 + input.evidence.footballPerformance * 0.15 + (100 - clamp(input.evidence.existingCommitments)) * 0.15);
  if (input.requestedAmount <= 0 || available <= 0 || score < 35) return { status: "REJECTED", conditions: [], reason: "Budget capacity or football evidence is insufficient" };
  const affordableAmount = Math.min(input.requestedAmount, Math.floor(available * (score >= 65 ? 0.5 : 0.25)));
  if (affordableAmount <= 0) return { status: "REJECTED", conditions: [], reason: "Existing commitments leave no responsible allocation" };
  const conditions = ["annual reporting", "auditable use of funds"];
  if (["INFRASTRUCTURE", "REGIONAL_GROUND", "MUNICIPAL_LAND_OR_VENUE"].includes(input.fundingType)) conditions.push("community access");
  if (["YOUTH_GRASSROOTS", "WOMENS_FOOTBALL"].includes(input.fundingType)) conditions.push("youth/women allocation");
  if (score < 65 || affordableAmount < input.requestedAmount) return { status: "CONDITIONAL", approvedAmount: affordableAmount, conditions, reason: "Support is viable but requires staged delivery and evidence" };
  return { status: "APPROVED", approvedAmount: affordableAmount, conditions, reason: "Priority and capacity support the requested programme" };
};

export const proposeGovernmentFunding = (db: GameDatabase, input: Omit<GovernmentFundingApplication, "id" | "status" | "approvedAmount" | "conditions" | "decidedOn" | "decisionReason" | "provenanceStatus">): GovernmentFundingApplication => {
  const application: GovernmentFundingApplication = { ...input, id: createStableEntityId("government-funding", `${input.institutionId}:${input.fundingType}:${input.proposedOn}:${input.projectId ?? input.clubId ?? input.federationId ?? "general"}`), status: "PROPOSED", conditions: [], provenanceStatus: "SIMULATION_ONLY" };
  new GovernmentRepository(db).upsertApplication(application);
  return application;
};

export const submitGovernmentFunding = (db: GameDatabase, applicationId: string): GovernmentFundingApplication => {
  const repo = new GovernmentRepository(db); const application = repo.applications().find((item) => item.id === applicationId);
  if (!application) throw new Error(`Government funding application missing: ${applicationId}`);
  if (application.status !== "PROPOSED") return application;
  const submitted = { ...application, status: "SUBMITTED" as const };
  repo.upsertApplication(submitted); return submitted;
};

export const reviewGovernmentFunding = (db: GameDatabase, input: { applicationId: string; reviewedOn: string; evidence: GovernmentFundingEvidence }): GovernmentFundingApplication => {
  const repo = new GovernmentRepository(db); const application = repo.applications().find((item) => item.id === input.applicationId);
  if (!application) throw new Error(`Government funding application missing: ${input.applicationId}`);
  if (["APPROVED", "REJECTED", "COMPLETED"].includes(application.status)) return application;
  const institution = repo.institution(application.institutionId); if (!institution) throw new Error(`Government institution missing: ${application.institutionId}`);
  const decision = evaluateGovernmentFunding({ institution, requestedAmount: application.requestedAmount, fundingType: application.fundingType, evidence: input.evidence });
  const reviewed: GovernmentFundingApplication = { ...application, status: decision.status, approvedAmount: decision.approvedAmount, conditions: decision.conditions, decidedOn: input.reviewedOn, decisionReason: decision.reason };
  repo.upsertApplication(reviewed);
  if (decision.approvedAmount && ["APPROVED", "CONDITIONAL"].includes(decision.status)) repo.upsertInstitution({ ...institution, profile: { ...institution.profile, committedBudget: institution.profile.committedBudget + decision.approvedAmount } });
  return reviewed;
};
