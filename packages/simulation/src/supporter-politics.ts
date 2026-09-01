import {
  EventRepository,
  SupporterCultureRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  buildSupporterEvent,
  clampSupporterScore,
  supporterReadModel,
  supporterUnrestState,
  type SupporterMoodInput,
} from "./supporter-culture.js";
import type {
  MediaStoryFrame,
  SupporterCultureProfile,
  SupporterFaction,
  SupporterReactionState,
  SupporterReadModel,
} from "@nepal-football-sim/shared-types";
import {
  createStableEntityId,
  type EntityId,
  type HistoricalEvent,
} from "@nepal-football-sim/shared-types";

export type SupporterPoliticsInput = SupporterMoodInput & {
  attendanceContext?: number;
  managerConfidence?: number;
  ownershipChange?: number;
  transferPolicyAlignment?: number;
  youthVisionAlignment?: number;
  facilitiesChange?: number;
  sustainedIssueDays?: number;
  daysSinceLastProtest?: number;
  repeatedBrokenPromises?: number;
  managerBoardCrisis?: boolean;
  controversialDecision?: boolean;
};

export type SupporterPoliticsDecision = {
  score: number;
  reaction: SupporterReactionState;
  concerns: string[];
  protestTriggered: boolean;
  attendanceModifier: number;
  boardPressure: number;
  mediaImportance: number;
};

const reactionFor = (score: number, previous: SupporterReactionState): SupporterReactionState => {
  if (previous === "PROTESTING" && score < 56) return "PROTESTING";
  if (score >= 74) return "SUPPORTIVE";
  if (score >= 56) return "CONTENT";
  if (score >= 36) return "RESTLESS";
  return "ANGRY";
};

const previousReaction = (profile: SupporterCultureProfile): SupporterReactionState => {
  if (profile.unrest === "PROTESTING") return "PROTESTING";
  if (profile.unrest === "ANGRY") return "ANGRY";
  if (profile.unrest === "FRUSTRATED" || profile.unrest === "CONCERNED") return "RESTLESS";
  return profile.currentMood >= 74 ? "SUPPORTIVE" : "CONTENT";
};

/** Deterministic, bounded supporter decision with sustained-issue protest gating. */
export const decideSupporterPolitics = (
  profile: SupporterCultureProfile,
  input: SupporterPoliticsInput,
): SupporterPoliticsDecision => {
  const values = [
    clampSupporterScore(50 + input.performanceVsExpectation * 1.25) * 0.35,
    clampSupporterScore(input.attendanceContext ?? 50) * 0.1,
    clampSupporterScore(input.managerConfidence ?? profile.trustInManager) * 0.15,
    clampSupporterScore(50 + (input.ownershipChange ?? 0) * 1.25) * 0.08,
    clampSupporterScore(input.transferPolicyAlignment ?? 50) * 0.08,
    clampSupporterScore(input.youthVisionAlignment ?? 50) * 0.08,
    clampSupporterScore(input.facilitiesChange ?? 50) * 0.06,
    clampSupporterScore(profile.trustInOwnership) * 0.1,
  ];
  const score = clampSupporterScore(values.reduce((sum, value) => sum + value, 0));
  const concerns: string[] = [];
  if ((input.performanceVsExpectation ?? 0) < -8) concerns.push("prolonged poor results");
  if ((input.managerConfidence ?? 60) < 35 || input.managerBoardCrisis)
    concerns.push("manager and board crisis");
  if ((input.ownershipChange ?? 0) < -15) concerns.push("ownership control change");
  if ((input.financialInstability ?? false) || (input.attendanceContext ?? 50) < 30)
    concerns.push("financial or attendance pressure");
  if ((input.repeatedBrokenPromises ?? 0) > 0 || input.brokenPromise)
    concerns.push("broken promises");
  if ((input.controversialDecision ?? false) || (input.youthVisionAlignment ?? 50) < 30)
    concerns.push("club-vision disagreement");
  const previous = previousReaction(profile);
  const sustained = (input.sustainedIssueDays ?? 0) >= 28;
  const cooldownOver = (input.daysSinceLastProtest ?? 999) >= 30;
  const protestTriggered = sustained && cooldownOver && concerns.length > 0 && score < 38;
  const reaction = protestTriggered ? "PROTESTING" : reactionFor(score, previous);
  return {
    score,
    reaction,
    concerns,
    protestTriggered,
    attendanceModifier: Math.max(-0.12, Math.min(0.04, (score - 55) / 500)),
    boardPressure: Math.max(-4, Math.min(4, (50 - score) / 12)),
    mediaImportance: Math.max(2, Math.min(10, concerns.length * 1.4 + (protestTriggered ? 5 : 0))),
  };
};

export const supporterFactions = (profile: SupporterCultureProfile): SupporterFaction[] => {
  const factions: SupporterFaction[] = [];
  if (profile.loyalty >= 65 || profile.localIdentity >= 65) factions.push("TRADITIONALISTS");
  if (profile.expectations >= 65 || profile.passion >= 70) factions.push("RESULTS_FIRST");
  if (profile.youthInterest >= 62) factions.push("YOUTH_FOCUSED");
  if (profile.trustInOwnership <= 38) factions.push("OWNERSHIP_CRITICAL");
  if (profile.commercialEngagement >= 65 || profile.nationalReach >= 65)
    factions.push("GROWTH_FOCUSED");
  return factions;
};

export const supporterPoliticsReadModel = (
  db: GameDatabase,
  clubId: EntityId,
  gender: "men" | "women" = "men",
):
  | (SupporterReadModel & {
      reaction: SupporterReactionState;
      activeConcerns: string[];
      factions: SupporterFaction[];
    })
  | undefined => {
  const model = supporterReadModel(db, clubId, gender);
  if (!model) return undefined;
  const concerns = model.recentEvents
    .filter((event) => event.magnitude >= 45)
    .slice(0, 5)
    .map((event) => event.summary);
  const reaction: SupporterReactionState =
    model.profile.unrest === "PROTESTING"
      ? "PROTESTING"
      : model.profile.unrest === "ANGRY"
        ? "ANGRY"
        : model.profile.unrest === "FRUSTRATED" || model.profile.unrest === "CONCERNED"
          ? "RESTLESS"
          : model.profile.currentMood >= 74
            ? "SUPPORTIVE"
            : "CONTENT";
  return {
    ...model,
    reaction,
    activeConcerns: concerns,
    factions: supporterFactions(model.profile),
  };
};

export const applySupporterPolitics = (input: {
  db: GameDatabase;
  profile: SupporterCultureProfile;
  date: string;
  politics: SupporterPoliticsInput;
  key: string;
  subjectIds?: EntityId[];
}): { profile: SupporterCultureProfile; decision: SupporterPoliticsDecision } => {
  const decision = decideSupporterPolitics(input.profile, input.politics);
  const next: SupporterCultureProfile = {
    ...input.profile,
    currentMood: clampSupporterScore(
      input.profile.currentMood + Math.max(-9, Math.min(9, (decision.score - 55) * 0.12)),
    ),
    optimism: clampSupporterScore(
      input.profile.optimism + Math.max(-5, Math.min(5, (decision.score - 55) * 0.08)),
    ),
    trustInManager: clampSupporterScore(
      input.profile.trustInManager +
        Math.max(
          -7,
          Math.min(
            7,
            ((input.politics.managerConfidence ?? input.profile.trustInManager) -
              input.profile.trustInManager) *
              0.08,
          ),
        ),
    ),
    trustInOwnership: clampSupporterScore(
      input.profile.trustInOwnership +
        Math.max(-6, Math.min(6, (input.politics.ownershipChange ?? 0) * 0.08)),
    ),
    unrest: decision.reaction === "PROTESTING" ? "PROTESTING" : supporterUnrestState(input.profile),
    lastEvaluatedOn: input.date,
  };
  new SupporterCultureRepository(input.db).upsertProfile(next);
  if (decision.protestTriggered) {
    const event = buildSupporterEvent({
      clubId: input.profile.clubId,
      gender: input.profile.gender,
      date: input.date,
      type: "PROTEST",
      magnitude: decision.mediaImportance * 10,
      moodDelta: next.currentMood - input.profile.currentMood,
      summary: "Supporters organised a protest over sustained club concerns.",
      subjectIds: input.subjectIds,
      key: input.key,
    });
    new SupporterCultureRepository(input.db).recordEvent(event);
    const historical: HistoricalEvent = {
      id: createStableEntityId("history", `SUPPORTER_PROTEST:${event.id}`),
      occurredOn: input.date,
      eventType: "SUPPORTER_PROTEST",
      involvedEntities: [
        { id: input.profile.clubId, type: "club" },
        ...(input.subjectIds ?? []).map((id) => ({ id, type: "person" as const })),
      ],
      title: event.summary,
      data: {
        supporterEventId: event.id,
        concerns: decision.concerns,
        mediaImportance: decision.mediaImportance,
      },
      importance: decision.mediaImportance >= 7 ? "high" : "medium",
      scope: "club",
    };
    new EventRepository(input.db).insertHistoricalEvent(historical);
  }
  return { profile: next, decision };
};

export const mediaFrameForEvent = (
  event: HistoricalEvent,
  outletStyle: "WIRE" | "ANALYSIS" | "TABLOID" | "TRADE",
): MediaStoryFrame => {
  const importance =
    event.importance === "historic"
      ? 10
      : event.importance === "high"
        ? 8
        : event.importance === "medium"
          ? 5
          : 2;
  const negative =
    event.eventType.includes("PROTEST") ||
    event.eventType.includes("SACK") ||
    event.eventType.includes("DEFAULT");
  return {
    sourceEventId: event.id,
    eventType: event.eventType,
    importance,
    subjectIds: event.involvedEntities.map((entity) => entity.id),
    sentiment: negative ? "NEGATIVE" : "NEUTRAL",
    frame:
      outletStyle === "TABLOID"
        ? "SENSATIONAL"
        : outletStyle === "ANALYSIS"
          ? "ANALYSIS"
          : "FACTUAL",
    publishedOn: event.occurredOn,
    provenanceStatus: "SIMULATION_ONLY",
  };
};
