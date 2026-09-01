import { PeopleFoundationRepository, type GameDatabase } from "@nepal-football-sim/database";
import { answerMediaInterview, answerMediaInterviewAsAi, createMediaInterview } from "./media.js";
import type {
  EntityId,
  MediaInterview,
  MediaStory,
  PersonPersonalityProfile,
  PersonRelationship,
  PlayerLifestyleProfile,
  SquadSocialGroup,
  SupporterReadModel,
} from "@nepal-football-sim/shared-types";

export type PressQuestion = {
  id: "TACTICS" | "EXPECTATIONS" | "RESPONSIBILITY" | "SQUAD";
  prompt: string;
  options: Array<"CALM" | "AMBITIOUS" | "PROTECTIVE" | "CONCILIATORY">;
};

export type PressConferenceReadModel = {
  interview: MediaInterview;
  questions: PressQuestion[];
  status: "OPEN" | "COMPLETED";
  framing: "POSITIVE" | "NEUTRAL" | "CRITICAL" | "SENSATIONAL";
};

export type SocialReaction = {
  label: "POSITIVE" | "MIXED" | "CRITICAL" | "VIRAL";
  summary: string;
  importance: number;
  sourceEventId: EntityId;
};

const questionsFor = (context: MediaInterview["context"]): PressQuestion[] => {
  if (context === "PRE_MATCH") {
    return [
      {
        id: "EXPECTATIONS",
        prompt: "What should supporters expect from this match?",
        options: ["CALM", "AMBITIOUS", "PROTECTIVE"],
      },
      {
        id: "TACTICS",
        prompt: "How will the team approach the opposition?",
        options: ["CALM", "AMBITIOUS", "CONCILIATORY"],
      },
    ];
  }
  return [
    {
      id: "RESPONSIBILITY",
      prompt: "What is your assessment of the result?",
      options: ["CALM", "PROTECTIVE", "CONCILIATORY"],
    },
    {
      id: "SQUAD",
      prompt: "How will you handle the next football decision?",
      options: ["CALM", "AMBITIOUS", "CONCILIATORY"],
    },
  ];
};

/** Opens or returns the existing persisted media interview; no duplicate conference is created. */
export const openPressConference = (input: {
  db: GameDatabase;
  storyId: EntityId;
  managerPersonId: EntityId;
  date: string;
  context: MediaInterview["context"];
}): PressConferenceReadModel => {
  const interview = createMediaInterview(input.db, input);
  const framing =
    interview.importance >= 8 ? "CRITICAL" : interview.importance >= 6 ? "NEUTRAL" : "POSITIVE";
  return { interview, questions: questionsFor(input.context), status: interview.status, framing };
};

export const resolvePressConference = (
  db: GameDatabase,
  input: {
    conference: PressConferenceReadModel;
    stance: "CALM" | "AMBITIOUS" | "PROTECTIVE" | "CONCILIATORY";
    response: string;
  },
): PressConferenceReadModel => {
  if (input.conference.status === "COMPLETED") return input.conference;
  const interview = answerMediaInterview(db, {
    interviewId: input.conference.interview.id,
    stance: input.stance,
    response: input.response,
  });
  const framing =
    input.stance === "AMBITIOUS"
      ? "POSITIVE"
      : input.stance === "PROTECTIVE"
        ? "CRITICAL"
        : input.stance === "CONCILIATORY"
          ? "NEUTRAL"
          : input.conference.framing;
  return { ...input.conference, interview, status: interview.status, framing };
};

export const resolveAiPressConference = (
  db: GameDatabase,
  conference: PressConferenceReadModel,
  seed: string,
): PressConferenceReadModel => {
  if (conference.status === "COMPLETED") return conference;
  const interview = answerMediaInterviewAsAi(db, { interviewId: conference.interview.id, seed });
  return { ...conference, interview, status: interview.status };
};

/** Small derived social layer: one summary per factual media story, never per account/post. */
export const deriveSocialReaction = (
  story: MediaStory,
  supporters?: SupporterReadModel,
): SocialReaction => {
  const mood = supporters?.mood ?? 50;
  const label =
    story.importance >= 9
      ? "VIRAL"
      : mood >= 65 && story.reputationEffect >= 0
        ? "POSITIVE"
        : mood < 38 || story.reputationEffect < 0
          ? "CRITICAL"
          : "MIXED";
  return {
    label,
    summary: `${label.toLowerCase()} reaction to ${story.headline}`,
    importance: Math.max(1, Math.min(10, story.importance + (label === "VIRAL" ? 1 : 0))),
    sourceEventId: story.sourceEntityId,
  };
};

export const derivePlayerLifestyle = (
  personality: PersonPersonalityProfile,
): PlayerLifestyleProfile => ({
  personId: personality.personId,
  professionalismHabits:
    personality.traits.professionalism >= 75
      ? "ELITE"
      : personality.traits.professionalism >= 45
        ? "STEADY"
        : "INCONSISTENT",
  trainingDiscipline:
    personality.traits.professionalism >= 70
      ? "HIGH"
      : personality.traits.professionalism >= 40
        ? "NORMAL"
        : "LOW",
  mediaActivity:
    personality.traits.sociability >= 70
      ? "HIGH"
      : personality.traits.sociability >= 40
        ? "MODERATE"
        : "LOW",
  offFieldFocus:
    personality.traits.professionalism >= 70
      ? "FOOTBALL_FIRST"
      : personality.traits.adaptability < 35
        ? "DISTRACTED"
        : "BALANCED",
  adaptation: personality.traits.adaptability,
  provenanceStatus: "SIMULATION_ONLY",
});

/** Applies a real event to the derived lifestyle/adaptation view without
 * inventing a second persisted lifestyle model. */
export const applyPlayerLifestyleEvent = (input: {
  profile: PlayerLifestyleProfile;
  event: "TRANSFER_SETTLING" | "TRAINING_DISCIPLINE" | "MEDIA_ATTENTION" | "RELATIONSHIP";
  positive?: boolean;
}): PlayerLifestyleProfile => {
  const delta = input.positive === false ? -3 : 2;
  return {
    ...input.profile,
    adaptation: Math.max(
      0,
      Math.min(100, input.profile.adaptation + (input.event === "TRANSFER_SETTLING" ? delta : 0)),
    ),
  };
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Applies one bounded, event-driven relationship change with a date cooldown and idempotent same-date behavior. */
export const applyPlayerRelationshipEvent = (input: {
  db: GameDatabase;
  relationship: PersonRelationship;
  date: string;
  affinityDelta?: number;
  trustDelta?: number;
  respectDelta?: number;
  tensionDelta?: number;
  cooldownDays?: number;
}): PersonRelationship => {
  if (input.relationship.updatedOn === input.date) return input.relationship;
  if (daysBetween(input.relationship.updatedOn, input.date) < (input.cooldownDays ?? 7))
    return input.relationship;
  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const next = {
    ...input.relationship,
    affinity: clamp(
      input.relationship.affinity + Math.max(-8, Math.min(8, input.affinityDelta ?? 0)),
    ),
    trust: clamp(input.relationship.trust + Math.max(-8, Math.min(8, input.trustDelta ?? 0))),
    respect: clamp(input.relationship.respect + Math.max(-8, Math.min(8, input.respectDelta ?? 0))),
    tension: clamp(input.relationship.tension + Math.max(-8, Math.min(8, input.tensionDelta ?? 0))),
    updatedOn: input.date,
  };
  new PeopleFoundationRepository(input.db).upsertRelationship(next);
  return next;
};

/** Reads only existing edges; caller supplies the squad, so this cannot scan or create O(N²) pairs. */
export const squadSocialGroups = (db: GameDatabase, personIds: EntityId[]): SquadSocialGroup[] => {
  const allowed = new Set(personIds);
  const relationships = personIds
    .flatMap((personId) => new PeopleFoundationRepository(db).relationshipsForPerson(personId))
    .filter(
      (relationship, index, all) => all.findIndex((item) => item.id === relationship.id) === index,
    )
    .filter(
      (relationship) =>
        allowed.has(relationship.fromPersonId) && allowed.has(relationship.toPersonId),
    );
  return relationships
    .filter(
      (relationship) => relationship.kind === "TEAMMATE" || relationship.kind === "MANAGER_PLAYER",
    )
    .flatMap((relationship): SquadSocialGroup[] => {
      if (relationship.trust >= 70 && relationship.affinity >= 70)
        return [
          {
            type: "FRIENDSHIP" as const,
            personIds: [relationship.fromPersonId, relationship.toPersonId],
            clue: "strong mutual connection",
          },
        ];
      if (relationship.tension >= 65)
        return [
          {
            type: "RIVALRY" as const,
            personIds: [relationship.fromPersonId, relationship.toPersonId],
            clue: "competitive tension",
          },
        ];
      if (relationship.trust < 35)
        return [
          {
            type: "DISTRUST" as const,
            personIds: [relationship.fromPersonId, relationship.toPersonId],
            clue: "trust appears fragile",
          },
        ];
      return [];
    });
};
