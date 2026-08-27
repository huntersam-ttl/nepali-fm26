import { CareerWorldRepository, ClubEconomyRepository, ManagerRepository, UniversalInteractionRepository, type GameDatabase } from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId, type JobVacancy, type ManagerProfile, type UniversalInteraction } from "@nepal-football-sim/shared-types";
import { openInteraction } from "./universal-interaction-adapters.js";

export type ManagerInterviewAnswers = {
  tacticalStyle: "POSSESSION" | "DIRECT" | "ADAPTIVE";
  youthCommitment: "PRIORITIZE" | "BALANCED" | "EXPERIENCE";
  budgetExpectation: "LARGE" | "CURRENT" | "LEAN";
  authorityRequest: "MORE_CONTROL" | "SHARED" | "BOARD_LED";
  objective: "SURVIVAL" | "PROGRESS" | "TITLE";
};

export type ManagerInterviewResult = {
  interaction: UniversalInteraction;
  score: number;
  successful: boolean;
  answers: ManagerInterviewAnswers;
};

export const defaultManagerInterviewAnswers = (profile: ManagerProfile): ManagerInterviewAnswers => ({
  tacticalStyle: profile.attributes.tactical.adaptability >= 8 ? "ADAPTIVE" : "DIRECT",
  youthCommitment: profile.attributes.coaching.youthDevelopment >= 8 ? "PRIORITIZE" : "BALANCED",
  budgetExpectation: profile.attributes.personality.professionalism >= 8 ? "CURRENT" : "LARGE",
  authorityRequest: profile.attributes.people.communication >= 8 ? "SHARED" : "MORE_CONTROL",
  objective: profile.attributes.personality.ambition >= 8 ? "TITLE" : "PROGRESS",
});

export const createManagerInterview = (db: GameDatabase, input: { vacancy: JobVacancy; profile: ManagerProfile; date: string; cycle?: string }): UniversalInteraction => {
  if (!input.vacancy.clubId) throw new Error("Manager interview requires a club authority");
  const repo = new UniversalInteractionRepository(db);
  const cycle = input.cycle ?? input.date;
  const existing = repo.all().find((item) => item.interactionType === "MANAGER_INTERVIEW" && item.linkedReference?.canonicalId === input.vacancy.id && item.initiator.entityId === input.profile.personId && item.linkedReference?.stage === cycle);
  if (existing) return existing;
  return openInteraction(db, {
    interactionType: "MANAGER_INTERVIEW",
    initiator: { type: "MANAGER", entityId: input.profile.personId },
    counterpart: { type: "BOARD", entityId: input.vacancy.clubId },
    organisationId: input.vacancy.clubId,
    worldDate: input.date,
    subject: `Manager interview:${input.vacancy.id}:${cycle}`,
    linkedReference: { type: "MANAGER_INTERVIEW", canonicalId: input.vacancy.id, stage: cycle },
    deadline: addDays(input.date, 14),
    demands: { boardExpectation: input.vacancy.boardExpectation },
  });
};

export const resolveManagerInterview = (db: GameDatabase, input: { interactionId: EntityId; vacancy: JobVacancy; profile: ManagerProfile; answers: ManagerInterviewAnswers; date: string }): ManagerInterviewResult => {
  const repo = new UniversalInteractionRepository(db);
  const current = repo.session(input.interactionId);
  if (!current) throw new Error("Manager interview not found");
  const saved = current.offers.answers ? current : { ...current, offers: { ...current.offers, answers: JSON.stringify(input.answers) } };
  const policy = input.vacancy.clubId ? new ClubEconomyRepository(db).boardPolicy(input.vacancy.clubId) : undefined;
  const objective = input.vacancy.boardExpectation;
  let score = 40 + input.profile.attributes.personality.reputation * 3 + input.profile.attributes.tactical.adaptability * 1.5;
  if (objective === "YOUTH_DEVELOPMENT") score += input.answers.youthCommitment === "PRIORITIZE" ? 18 : -6;
  if (objective === "SURVIVE") score += input.answers.objective === "SURVIVAL" ? 12 : -4;
  if (objective === "TITLE_CHALLENGE" || objective === "PROMOTION") score += input.answers.objective === "TITLE" ? 12 : -6;
  if (policy?.financialRiskTolerance === "LOW" && input.answers.budgetExpectation === "LARGE") score -= 15;
  if (policy?.youthPriority && input.answers.youthCommitment === "PRIORITIZE") score += policy.youthPriority * 0.6;
  if (input.answers.authorityRequest === "MORE_CONTROL") score -= 3;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const successful = score >= 55;
  const next: UniversalInteraction = { ...saved, offers: { ...saved.offers, answers: JSON.stringify(input.answers), score }, stage: successful ? "ACCEPTED" : "REJECTED", availableActions: [], outcome: successful ? `Interview passed with board score ${score}` : `Interview rejected with board score ${score}`, history: [...saved.history, { date: input.date, stage: successful ? "ACCEPTED" : "REJECTED", action: successful ? "ACCEPT" : "REJECT", note: "Structured manager interview evaluated" }] };
  repo.upsert(next);
  repo.insertMemory({ id: createStableEntityId("interaction-memory", `${next.id}:${next.stage}`), participantId: input.profile.personId, counterpartId: input.vacancy.clubId!, interactionId: next.id, memoryType: next.stage, value: score, occurredOn: input.date, note: next.outcome!, provenanceStatus: "SIMULATION_ONLY" });
  return { interaction: next, score, successful, answers: input.answers };
};

export const interviewManagerForApplication = (db: GameDatabase, input: { vacancy: JobVacancy; profile: ManagerProfile; date: string }): ManagerInterviewResult => {
  const interview = createManagerInterview(db, input);
  const current = new UniversalInteractionRepository(db).session(interview.id)!;
  if (current.stage === "ACCEPTED" || current.stage === "REJECTED") return { interaction: current, score: Number(current.offers.score ?? 0), successful: current.stage === "ACCEPTED", answers: JSON.parse(String(current.offers.answers ?? JSON.stringify(defaultManagerInterviewAnswers(input.profile)))) };
  return resolveManagerInterview(db, { interactionId: interview.id, vacancy: input.vacancy, profile: input.profile, answers: defaultManagerInterviewAnswers(input.profile), date: input.date });
};

const addDays = (date: string, days: number): string => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
