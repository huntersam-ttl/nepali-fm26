import { describe, expect, it } from "vitest";
import { migrateDatabase, openGameDatabase } from "@nepal-football-sim/database";
import {
  calculateContinentalCoefficient,
  processCompletedContinentalSeason,
  rollingContinentalCoefficient,
} from "@nepal-football-sim/simulation";
import {
  backroomSummary,
  decideStaffJob,
  managerJobMarketReadModel,
  assessStaffCooperation,
  assessStaffDeparture,
  assessStaffDevelopmentWillingness,
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
    expect(value).toEqual({
      coefficient: 6,
      resultPoints: 12,
      participatingClubs: 2,
      clubContributions: { [id("club:a")]: 9, [id("club:b")]: 3 },
    });
  });

  it("ingests completed continental fixtures once and ignores domestic fixtures", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    const country = id("country"),
      federation = id("federation"),
      competition = id("continental"),
      domestic = id("domestic"),
      season = id("season"),
      domesticSeason = id("domestic-season"),
      home = id("home"),
      away = id("away"),
      homeTeam = id("home-team"),
      awayTeam = id("away-team"),
      fixture = id("fixture"),
      domesticFixture = id("domestic-fixture"),
      match = id("match"),
      domesticMatch = id("domestic-match");
    db.prepare("INSERT INTO countries (id,name,iso_code) VALUES (?,?,?)").run(
      country,
      "Nepal",
      "NPL",
    );
    db.prepare("INSERT INTO federations (id,country_id,name) VALUES (?,?,?)").run(
      federation,
      country,
      "Nepal FA",
    );
    db.prepare("INSERT INTO clubs (id,name,country_id,ownership_type) VALUES (?,?,?,?)").run(
      home,
      "Home",
      country,
      "PRIVATE",
    );
    db.prepare("INSERT INTO clubs (id,name,country_id,ownership_type) VALUES (?,?,?,?)").run(
      away,
      "Away",
      country,
      "PRIVATE",
    );
    db.prepare("INSERT INTO teams (id,club_id,name,level,gender) VALUES (?,?,?,?,?)").run(
      homeTeam,
      home,
      "Home XI",
      "senior",
      "men",
    );
    db.prepare("INSERT INTO teams (id,club_id,name,level,gender) VALUES (?,?,?,?,?)").run(
      awayTeam,
      away,
      "Away XI",
      "senior",
      "men",
    );
    db.prepare("INSERT INTO competitions (id,federation_id,name,scope) VALUES (?,?,?,?)").run(
      competition,
      federation,
      "Asian Cup",
      "continental",
    );
    db.prepare("INSERT INTO competitions (id,federation_id,name,scope) VALUES (?,?,?,?)").run(
      domestic,
      federation,
      "Nepal League",
      "domestic",
    );
    db.prepare(
      "INSERT INTO competition_seasons (id,competition_id,name,start_date,end_date) VALUES (?,?,?,?,?)",
    ).run(season, competition, "Asian Cup 2027", "2027-01-01", "2027-05-01");
    db.prepare(
      "INSERT INTO competition_seasons (id,competition_id,name,start_date,end_date) VALUES (?,?,?,?,?)",
    ).run(domesticSeason, domestic, "League 2027", "2027-01-01", "2027-05-01");
    db.prepare(
      "INSERT INTO fixtures (id,competition_season_id,home_team_id,away_team_id,scheduled_date,status) VALUES (?,?,?,?,?,?)",
    ).run(fixture, season, homeTeam, awayTeam, "2027-04-01", "played");
    db.prepare(
      "INSERT INTO matches (id,fixture_id,played_date,home_goals,away_goals) VALUES (?,?,?,?,?)",
    ).run(match, fixture, "2027-04-01", 2, 0);
    db.prepare(
      "INSERT INTO fixtures (id,competition_season_id,home_team_id,away_team_id,scheduled_date,status) VALUES (?,?,?,?,?,?)",
    ).run(domesticFixture, domesticSeason, homeTeam, awayTeam, "2027-04-02", "played");
    db.prepare(
      "INSERT INTO matches (id,fixture_id,played_date,home_goals,away_goals) VALUES (?,?,?,?,?)",
    ).run(domesticMatch, domesticFixture, "2027-04-02", 0, 0);
    const first = processCompletedContinentalSeason(db, {
      competitionSeasonId: season,
      calculatedOn: "2027-05-01",
    });
    const second = processCompletedContinentalSeason(db, {
      competitionSeasonId: season,
      calculatedOn: "2027-05-01",
    });
    expect(first?.resultPoints).toBe(3);
    expect(second?.resultPoints).toBe(3);
    expect(first?.clubContributions[home]).toBe(3);
    expect(first?.clubContributions[away]).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM continental_coefficient_snapshots").get(),
    ).toEqual({ count: 1 });
    db.close();
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

  it("derives deterministic, bounded staff behavior from canonical personality inputs", () => {
    const eager = assessStaffDevelopmentWillingness({
      professionalism: 9,
      ambition: 9,
      adaptability: 8,
      clubSupport: 8,
      managerTrust: 8,
    });
    const reluctant = assessStaffDevelopmentWillingness({
      professionalism: 2,
      ambition: 2,
      adaptability: 2,
      clubSupport: 2,
      managerTrust: 2,
      currentQualification: 4,
    });
    expect(eager.decision).toBe("PURSUE");
    expect(reluctant.decision).toBe("DECLINE");
    expect(eager).toEqual(
      assessStaffDevelopmentWillingness({
        professionalism: 9,
        ambition: 9,
        adaptability: 8,
        clubSupport: 8,
        managerTrust: 8,
      }),
    );

    const cooperation = assessStaffCooperation({ trust: 80, respect: 75, tension: 10 });
    expect(cooperation.label).toBe("STRONG");
    expect(cooperation.trainingModifier).toBeGreaterThanOrEqual(-5);
    expect(cooperation.trainingModifier).toBeLessThanOrEqual(5);

    expect(
      assessStaffDeparture({ ambition: 9, loyalty: 2, opportunity: 50, tenureMonths: 2 }).decision,
    ).toBe("STAY");
    expect(
      assessStaffDeparture({ ambition: 9, loyalty: 2, opportunity: 50, tenureMonths: 24 }).decision,
    ).toBe("LEAVE");
  });
});
