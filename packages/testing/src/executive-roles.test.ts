import { describe, expect, it } from "vitest";
import {
  canExecutiveAct,
  executiveAuthorities,
  executiveJobListing,
  rankExecutiveCandidate,
} from "@nepal-football-sim/simulation";
import { createStableEntityId, type StaffVacancy } from "@nepal-football-sim/shared-types";

const id = (value: string) => createStableEntityId("executive-test", value);

describe("sporting director and executive role foundation", () => {
  it("keeps authority exclusive and explicit", () => {
    const assignment = {
      id: id("assignment"),
      clubId: id("club"),
      role: "SPORTING_DIRECTOR" as const,
      personId: id("person"),
      appointmentId: id("appointment"),
      status: "FILLED" as const,
      assignedOn: "2026-01-01",
      provenanceStatus: "SIMULATION_ONLY" as const,
    };
    expect(
      canExecutiveAct({ role: "SPORTING_DIRECTOR", authority: "TRANSFER_NEGOTIATION", assignment }),
    ).toBe(true);
    expect(
      canExecutiveAct({ role: "SPORTING_DIRECTOR", authority: "SQUAD_PLANNING", assignment }),
    ).toBe(true);
    expect(canExecutiveAct({ role: "CEO", authority: "TRANSFER_NEGOTIATION", assignment })).toBe(
      false,
    );
    expect(canExecutiveAct({ role: "MANAGER", authority: "TRANSFER_NEGOTIATION" })).toBe(false);
    expect(canExecutiveAct({ role: "MANAGER", authority: "SQUAD_PLANNING" })).toBe(true);
    expect(executiveAuthorities.CEO).not.toContain("TRANSFER_NEGOTIATION");
  });

  it("ranks executive candidates deterministically with explainable fit", () => {
    const input = {
      personId: id("person"),
      role: "DIRECTOR_OF_FOOTBALL" as const,
      reputation: 70,
      experience: 80,
      clubVisionFit: 90,
      relationshipFit: 60,
      budgetDiscipline: 85,
    };
    const first = rankExecutiveCandidate(input);
    expect(first).toEqual(rankExecutiveCandidate(input));
    expect(first.fitScore).toBeGreaterThan(70);
    expect(first.rationale).toHaveLength(3);
    const vacancy: StaffVacancy = {
      id: id("vacancy"),
      organisationType: "CLUB",
      clubId: id("club"),
      role: "DIRECTOR_OF_FOOTBALL",
      required: true,
      status: "VACANT",
    };
    expect(executiveJobListing(vacancy, first).fitScore).toBe(first.fitScore);
  });
});
