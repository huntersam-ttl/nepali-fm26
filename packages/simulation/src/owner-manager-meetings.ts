import { CareerWorldRepository, ClubEconomyRepository, ManagerRepository, UniversalInteractionRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type UniversalInteraction } from "@nepal-football-sim/shared-types";
import { openInteraction, submitInteractionAction } from "./universal-interaction-adapters.js";

export type OwnerManagerMeetingTopic = "FORM" | "TRANSFER_BUDGET" | "SQUAD_STRENGTHENING" | "YOUTH_USAGE" | "PLAYING_PHILOSOPHY" | "STAFF_BUDGET" | "FACILITIES" | "OBJECTIVES" | "CONTRACT_SECURITY";
export type OwnerManagerMeetingStance = "SUPPORT" | "REQUEST" | "CONCERN";

const managerForClub = (db: GameDatabase, clubId: EntityId) => new ManagerRepository(db).allActiveContracts().find((contract) => contract.clubId === clubId);

export const createOwnerManagerMeeting = (db: GameDatabase, input: { clubId: EntityId; date: string; topic: OwnerManagerMeetingTopic; deadline?: string }): UniversalInteraction => {
  const policy = new ClubEconomyRepository(db).boardPolicy(input.clubId);
  const contract = managerForClub(db, input.clubId);
  if (!policy?.chairmanPersonId || !contract) throw new Error("OWNER_MANAGER_MEETING_REQUIRES_ACTIVE_MANAGER_AND_CHAIRMAN");
  const manager = new ManagerRepository(db).getProfile(contract.managerProfileId);
  if (!manager) throw new Error("OWNER_MANAGER_MEETING_MANAGER_PROFILE_MISSING");
  const confidence = new CareerWorldRepository(db).boardConfidence(input.clubId)?.confidence ?? 60;
  const idempotencySubject = `Owner-manager meeting:${input.clubId}:${input.topic}:${input.date}`;
  const existing = new UniversalInteractionRepository(db).all().find((item) => item.subject === idempotencySubject);
  if (existing) return existing;
  return openInteraction(db, {
    interactionType: "OWNER_MANAGER_MEETING",
    initiator: { type: "CHAIRMAN", entityId: policy.chairmanPersonId },
    counterpart: { type: "MANAGER", entityId: manager.personId },
    organisationId: input.clubId,
    worldDate: input.date,
    subject: idempotencySubject,
    linkedReference: { type: "OWNER_MANAGER_MEETING", canonicalId: input.clubId },
    deadline: input.deadline,
    demands: { topic: input.topic, boardConfidence: confidence, expectation: new ClubEconomyRepository(db).boardPolicy(input.clubId)?.strategicObjective ?? "STABILITY" },
    relationshipState: 60,
    trust: Math.max(70, confidence),
    leverage: 70,
  });
};

export const resolveOwnerManagerMeeting = (db: GameDatabase, input: { interactionId: EntityId; date: string; seed: string; stance: OwnerManagerMeetingStance; commitment?: { type: "PROMOTION_CHALLENGE" | "YOUTH_USAGE" | "FINANCIAL_DISCIPLINE" | "SQUAD_STRENGTHENING" | "FACILITY_PROJECT" | "TACTICAL_STYLE"; targetCriteria: string; description: string; dueOn: string; importance?: number } }): UniversalInteraction => {
  const repo = new UniversalInteractionRepository(db);
  const current = repo.session(input.interactionId);
  if (!current) throw new Error("OWNER_MANAGER_MEETING_NOT_FOUND");
  if (current.stage === "ACCEPTED" && current.execution?.status === "APPLIED") return current;
  if (current.stage === "OPENED") submitInteractionAction(db, { interactionId: input.interactionId, action: "STATE_POSITION", tone: "PROFESSIONAL", date: input.date, seed: input.seed });
  const updated = repo.session(input.interactionId)!;
  const offers = { ...updated.offers, stance: input.stance, ...(input.commitment ? { commitmentType: input.commitment.type, targetCriteria: input.commitment.targetCriteria, commitmentDescription: input.commitment.description, commitmentDueOn: input.commitment.dueOn, importance: input.commitment.importance ?? 6 } : {}) };
  return submitInteractionAction(db, { interactionId: input.interactionId, action: "ACCEPT", tone: input.stance === "CONCERN" ? "ASSERTIVE" : "SUPPORTIVE", date: input.date, seed: input.seed, offer: offers });
};

export const defaultOwnerManagerStance = (db: GameDatabase, clubId: EntityId): OwnerManagerMeetingStance => {
  const confidence = new CareerWorldRepository(db).boardConfidence(clubId)?.confidence ?? 60;
  return confidence < 40 ? "CONCERN" : confidence >= 70 ? "SUPPORT" : "REQUEST";
};
