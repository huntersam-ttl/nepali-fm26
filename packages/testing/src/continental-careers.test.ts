import { describe, expect, it } from "vitest";
import {
  calculateContinentalCoefficient,
  rollingContinentalCoefficient,
} from "@nepal-football-sim/simulation";
import {
  backroomSummary,
  decideStaffJob,
  managerJobMarketReadModel,
  staffPersonalityClues,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type ContinentalResult,
  type PersonPersonalityProfile,
  type PersonRelationship,
} from "@nepal-football-sim/shared-types";

const id = (value: string) => createStableEntityId("continental-careers-test", value);

const result = (clubId: string, seasonLabel: string, resultPoints: number): ContinentalResult => ({
  associationId: id("association:np"),
  clubId: id(clubId),
  seasonLabel,
  resultPoints,
  matches: 3,
  completedOn: `${seasonLabel}-05-01`,
  provenanceStatus: "SIMULATION_ONLY",
});

describe("continental coefficients and career-market foundations", () => {
  it("calculates an association coefficient from real participating club results", () => {
    const value = calculateContinentalCoefficient(
      [result("club:a", "2026", 9), result("club:b", "2026", 3)],
      "2026",
    );
    expect(value).toEqual({ coefficient: 6, resultPoints: 12, participatingClubs: 2 });
  });

  it("uses bounded recency weighting for rolling coefficient context", () => {
    expect(rollingContinentalCoefficient([20, 20, 20, 20, 20])).toBe(20);
    expect(rollingContinentalCoefficient([20, 0, 0, 0, 0])).toBeGreaterThan(0);
    expect(rollingContinentalCoefficient([20, 0, 0, 0, 0])).toBeLessThan(20);
    expect(rollingContinentalCoefficient([100, -10])).toBeLessThanOrEqual(20);
  });

  it("keeps manager offers explainable and human-controlled", () => {
    expect(
      managerJobMarketReadModel({
        vacancyId: id("vacancy:a"),
        managerProfileId: id("manager:a"),
        status: "OFFERED",
        fitScore: 78,
        rationale: ["Strong club-vision fit"],
      }),
    ).toMatchObject({ stage: "OFFER", fitLabel: "STRONG", humanDecisionRequired: true });
    expect(
      managerJobMarketReadModel({
        vacancyId: id("vacancy:a"),
        managerProfileId: id("manager:a"),
        status: "ACCEPTED",
        fitScore: 78,
      }).stage,
    ).toBe("ACCEPTED");
  });

  it("derives staff clues and deterministic movement from canonical personality", () => {
    const personality: PersonPersonalityProfile = {
      personId: id("person:a"),
      archetype: "PROFESSIONAL",
      traits: {
        professionalism: 9,
        ambition: 8,
        loyalty: 3,
        sociability: 5,
        adaptability: 8,
        pressureHandling: 6,
        determination: 7,
      },
      updatedOn: "2026-01-01",
      provenanceStatus: "SIMULATION_ONLY",
    };
    expect(staffPersonalityClues(personality)).toEqual({
      professionalism: "HIGH",
      ambition: "HIGH",
      loyalty: "LOW",
      adaptability: "HIGH",
    });
    const input = {
      personId: id("person:a"),
      vacancy: {
        id: id("vacancy:a"),
        organisationType: "CLUB" as const,
        clubId: id("club:b"),
        role: "SCOUT" as const,
        required: true,
        status: "VACANT" as const,
      },
      personality,
      clubFit: 88,
      offeredSalaryMinor: 1_000_000,
      currentSalaryMinor: 400_000,
      jobSecurity: 75,
    };
    expect(decideStaffJob(input)).toBe("ACCEPT");
    expect(decideStaffJob(input)).toBe(decideStaffJob(input));
  });

  it("summarizes backroom relationships without generating a relationship graph", () => {
    const relationship = (idValue: string, trust: number, tension: number): PersonRelationship => ({
      id: id("relationship:" + idValue),
      fromPersonId: id("staff:" + idValue),
      toPersonId: id("manager:a"),
      kind: "STAFF_MANAGER",
      affinity: trust,
      trust,
      respect: trust,
      tension,
      updatedOn: "2026-01-01",
      provenanceStatus: "SIMULATION_ONLY",
    });
    const summary = backroomSummary({
      clubId: id("club:a"),
      activeStaff: 4,
      relationships: [
        relationship("a", 80, 10),
        relationship("b", 25, 75),
        relationship("c", 20, 80),
      ],
    });
    expect(summary.atmosphere).toBe("CONFLICT");
    expect(summary.activeStaff).toBe(4);
    expect(summary.clue).not.toContain("score");
  });
});
