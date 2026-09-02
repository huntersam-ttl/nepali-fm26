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
  agentClientStrategies,
  effectiveAgentPlayerPreferences,
  settleAgentFee,
  setAgentClientStrategy,
  signAgentClient,
} from "@nepal-football-sim/simulation";
import { ClubEconomyRepository } from "@nepal-football-sim/database";
import {
  createStableEntityId,
  type AgentProfile,
  type Person,
  type PlayerSquadRole,
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
    const strategy = setAgentClientStrategy(db, {
      agentId: profile.id,
      playerId: player.id,
      objective: "PLAYING_TIME",
      date: "2027-01-03",
    });
    expect(strategy.status).toBe("ACTIVE");
    expect(
      agentClientStrategies(db, player.id).filter((item) => item.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(
      effectiveAgentPlayerPreferences<{
        securityPreference: number;
        expectedPlayingTime?: PlayerSquadRole;
      }>(db, player.id, { securityPreference: 6 }).expectedPlayingTime,
    ).toBe("FIRST_TEAM");
    const clubId = id("club");
    db.prepare("INSERT INTO clubs (id,name,country_id,ownership_type) VALUES (?,?,?,?)").run(
      clubId,
      "Test Club",
      id("country"),
      "COMMUNITY",
    );
    new ClubEconomyRepository(db).upsertFinancialAccount({
      clubId,
      currency: "NPR",
      cashBalance: 1000000,
      restrictedCash: 0,
      receivables: 0,
      payables: 0,
      debtBalance: 0,
      equityBalance: 0,
      seasonRevenue: 0,
      seasonExpenses: 0,
      seasonProfitLoss: 0,
      financialHealth: "STABLE",
      lastUpdatedAt: "2027-01-03",
      status: "SIMULATION_ONLY",
    });
    const settlement = settleAgentFee(db, {
      playerId: player.id,
      payerClubId: clubId,
      amount: 25000,
      sourceEntityId: id("completed-transfer"),
      eventType: "TRANSFER",
      date: "2027-01-03",
    });
    expect(settlement?.amount).toBe(25000);
    expect(
      settleAgentFee(db, {
        playerId: player.id,
        payerClubId: clubId,
        amount: 25000,
        sourceEntityId: id("completed-transfer"),
        eventType: "TRANSFER",
        date: "2027-01-04",
      }),
    ).toBeUndefined();
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
    expect(timeline).toHaveLength(2);
    expect(careerTimeline(db, { personId: person.id }).map((event) => event.occurredOn)).toEqual([
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2028-01-01",
    ]);
    db.close();
  });
});
