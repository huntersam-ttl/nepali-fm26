import { describe, expect, it } from "vitest";
import {
  applyPlayerLifestyleEvent,
  derivePlayerLifestyle,
  deriveSocialReaction,
} from "@nepal-football-sim/simulation";
import type { MediaStory, PersonPersonalityProfile } from "@nepal-football-sim/shared-types";

const personality: PersonPersonalityProfile = {
  personId: "player-lifestyle" as PersonPersonalityProfile["personId"],
  traits: {
    professionalism: 82,
    ambition: 64,
    loyalty: 58,
    sociability: 76,
    adaptability: 71,
    pressureHandling: 60,
    determination: 73,
  },
  archetype: "PROFESSIONAL",
  updatedOn: "2026-08-01",
  provenanceStatus: "SIMULATION_ONLY",
};

const story: MediaStory = {
  id: "media-story" as MediaStory["id"],
  outletId: "outlet" as MediaStory["outletId"],
  eventType: "MATCH_RESULT",
  sourceEntityId: "event" as MediaStory["sourceEntityId"],
  publishedOn: "2026-08-01",
  importance: 9,
  headline: "A meaningful result",
  summary: "An event-backed story",
  subjectIds: [],
  reputationEffect: 0,
  status: "PUBLISHED",
  provenanceStatus: "SIMULATION_ONLY",
};

describe("press, social reaction, and lifestyle foundations", () => {
  it("derives deterministic, non-sensitive lifestyle clues from personality", () => {
    expect(derivePlayerLifestyle(personality)).toEqual(derivePlayerLifestyle(personality));
    expect(derivePlayerLifestyle(personality)).toMatchObject({
      professionalismHabits: "ELITE",
      trainingDiscipline: "HIGH",
      mediaActivity: "HIGH",
      adaptation: 71,
    });
  });

  it("derives one bounded social reaction from one factual media story", () => {
    const reaction = deriveSocialReaction(story);
    expect(reaction.label).toBe("VIRAL");
    expect(reaction.sourceEventId).toBe(story.sourceEntityId);
    expect(reaction.importance).toBeLessThanOrEqual(10);
    expect(reaction.summary).toContain(story.headline);
  });

  it("keeps event-driven adaptation bounded and deterministic", () => {
    const profile = derivePlayerLifestyle(personality);
    const settled = applyPlayerLifestyleEvent({
      profile,
      event: "TRANSFER_SETTLING",
      positive: true,
    });
    expect(settled.adaptation).toBe(profile.adaptation + 2);
    expect(
      applyPlayerLifestyleEvent({ profile: settled, event: "TRANSFER_SETTLING", positive: false })
        .adaptation,
    ).toBe(profile.adaptation - 1);
  });
});
