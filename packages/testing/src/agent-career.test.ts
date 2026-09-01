import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import {
  agentReputationLabel,
  careerTimeline,
  createAgentCareer,
  recordCareerTimelineEvent,
  signAgentClient,
} from "@nepal-football-sim/simulation";
import {
  createStableEntityId,
  type AgentProfile,
  type Person,
} from "@nepal-football-sim/shared-types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const id = (value: string) => createStableEntityId("agent-career-test", value);

describe("agent career and interactive timeline", () => {
  it("derives bounded reputation labels", () => {
    expect(agentReputationLabel(25)).toBe("EMERGING");
    expect(agentReputationLabel(55)).toBe("ESTABLISHED");
    expect(agentReputationLabel(90)).toBe("RESPECTED");
  });

  it("creates a human agent, enforces one active representative, and persists timeline filters", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-career-"));
    dirs.push(dir);
    const db = openGameDatabase(join(dir, "career.sqlite"));
    migrateDatabase(db);
    db.prepare("INSERT INTO countries (id,name,iso_code) VALUES (?,?,?)").run(
      id("country"),
      "Nepal",
      "NPL",
    );
    const person: Person = {
      id: id("agent"),
      fullName: "Human Agent",
      nationalityCountryId: id("country"),
      languages: ["en"],
    };
    const profile: AgentProfile = {
      id: id("agent-profile"),
      personId: person.id,
      agencyName: "Himalayan Representation",
      reputation: 55,
      negotiationSkill: 65,
      negotiationStyle: "BALANCED",
      aggressiveness: 35,
      loyaltyPreference: 60,
      feeExpectation: 5,
      careerAmbition: 70,
      networkScope: "NEPAL_DOMESTIC",
      preferredMarkets: ["NEPAL"],
      status: "SIMULATION_ONLY",
    };
    expect(createAgentCareer(db, { person, profile, date: "2027-01-01" }).careerRole).toBe("AGENT");
    const player: Person = {
      id: id("player"),
      fullName: "Client Player",
      nationalityCountryId: person.nationalityCountryId,
      languages: ["en"],
    };
    db.prepare(
      "INSERT INTO persons (id,full_name,nationality_country_id,languages_json) VALUES (?,?,?,?)",
    ).run(player.id, player.fullName, player.nationalityCountryId, JSON.stringify(["en"]));
    expect(
      signAgentClient(db, { agentId: profile.id, playerId: player.id, date: "2027-01-02" }).status,
    ).toBe("ACTIVE");
    expect(() =>
      signAgentClient(db, { agentId: profile.id, playerId: player.id, date: "2027-01-03" }),
    ).toThrow("active representation");
    recordCareerTimelineEvent(db, {
      id: id("later"),
      personId: person.id,
      occurredOn: "2028-01-01",
      role: "AGENT",
      category: "REPRESENTATION",
      title: "Client signed",
      importance: "HIGH",
      sourceEntityId: player.id,
      seasonLabel: "2027-28",
      provenanceStatus: "SIMULATION_ONLY",
    });
    recordCareerTimelineEvent(db, {
      id: id("earlier"),
      personId: person.id,
      occurredOn: "2027-01-01",
      role: "AGENT",
      category: "APPOINTMENT",
      title: "Agent career started",
      importance: "MEDIUM",
      seasonLabel: "2026-27",
      provenanceStatus: "SIMULATION_ONLY",
    });
    const timeline = careerTimeline(db, {
      personId: person.id,
      role: "AGENT",
      category: "REPRESENTATION",
    });
    expect(timeline).toHaveLength(1);
    expect(careerTimeline(db, { personId: person.id }).map((event) => event.occurredOn)).toEqual([
      "2027-01-01",
      "2028-01-01",
    ]);
    db.close();
  });
});
