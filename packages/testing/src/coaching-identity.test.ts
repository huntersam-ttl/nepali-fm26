import { describe, expect, it } from "vitest";
import { coachingJobFit } from "@nepal-football-sim/simulation";
import type { JobVacancy, ManagerProfile } from "@nepal-football-sim/shared-types";

const manager = (reputation: number): ManagerProfile => ({
  id: "manager-profile" as ManagerProfile["id"],
  personId: "manager-person" as ManagerProfile["personId"],
  attributes: {
    tactical: {
      tacticalKnowledge: 14,
      adaptability: 12,
      matchManagement: 15,
      setPieceKnowledge: 10,
    },
    coaching: {
      attackingCoaching: 16,
      defensiveCoaching: 11,
      technicalCoaching: 13,
      mentalCoaching: 12,
      fitnessUnderstanding: 10,
      youthDevelopment: 9,
    },
    people: { manManagement: 15, motivation: 14, discipline: 12, communication: 13 },
    recruitment: { playerJudgement: 11, potentialJudgement: 10 },
    personality: {
      reputation,
      mediaHandling: 10,
      pressureHandling: 12,
      professionalism: 14,
      ambition: 13,
      loyalty: 11,
    },
  },
  preferredStyle: "BALANCED",
  reputationProfile: reputation >= 8 ? "LOCAL_RESPECTED" : "UNKNOWN",
  createdOn: "2026-01-01",
});

const vacancy = (expectation: string): JobVacancy => ({
  id: "vacancy" as JobVacancy["id"],
  teamId: "team" as JobVacancy["teamId"],
  openedOn: "2026-01-01",
  reason: "NEW_CLUB",
  boardExpectation: expectation,
  status: "OPEN",
});

describe("coaching identity and job market foundation", () => {
  it("keeps demanding-vacancy eligibility tied to the existing reputation rules", () => {
    expect(coachingJobFit(manager(7), vacancy("TITLE_CHALLENGE")).eligible).toBe(false);
    expect(coachingJobFit(manager(8), vacancy("TITLE_CHALLENGE")).eligible).toBe(true);
  });

  it("returns deterministic bounded scores and rationale", () => {
    const first = coachingJobFit(manager(10), vacancy("PROMOTION"));
    const second = coachingJobFit(manager(10), vacancy("PROMOTION"));
    expect(first).toEqual(second);
    expect(first.fitScore).toBeGreaterThanOrEqual(0);
    expect(first.fitScore).toBeLessThanOrEqual(100);
    expect(first.rationale).toHaveLength(2);
  });
});
