import { describe, expect, it } from "vitest";
import {
  RefereeAssignmentRepository,
  WorkforceSupplyRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { assignOfficialsToFixture, createMatchState } from "@nepal-football-sim/simulation";
import type {
  EntityId,
  FixtureRecord,
  OfficialSimulationProfile,
} from "@nepal-football-sim/shared-types";

const id = (value: string) => value as EntityId;
const fixture = (value: string, date = "2027-01-01"): FixtureRecord => ({
  id: id(value),
  competitionSeasonId: id("season"),
  homeTeamId: id("home"),
  awayTeamId: id("away"),
  scheduledDate: date,
  status: "scheduled",
  round: 1,
});

const official = (
  personId: string,
  profileId: string,
  role: OfficialSimulationProfile["role"],
): OfficialSimulationProfile => ({
  personId: id(personId),
  refereeProfileId: id(profileId),
  countryId: id("nepal"),
  role,
  gender: "male",
  level: 1,
  quality: 70,
  potential: 80,
  experience: 60,
  fitness: 90,
  seasonAppointments: 0,
  careerAppointments: 0,
  debutOn: "2020-01-01",
  status: "ACTIVE",
  provenanceStatus: "SIMULATION_ONLY",
});

const setup = () => {
  const db = openGameDatabase(":memory:");
  migrateDatabase(db);
  db.prepare("INSERT INTO countries (id,name,iso_code) VALUES ('nepal','Nepal','NP')").run();
  db.prepare(
    "INSERT INTO clubs (id,name,country_id,ownership_type) VALUES ('club','Club','nepal','PRIVATE')",
  ).run();
  db.prepare(
    "INSERT INTO teams (id,club_id,name,level,gender) VALUES ('home','club','Home','A','MALE'),('away','club','Away','A','MALE')",
  ).run();
  db.prepare(
    "INSERT INTO competitions (id,name,scope) VALUES ('competition','League','DOMESTIC')",
  ).run();
  db.prepare(
    "INSERT INTO competition_seasons (id,competition_id,name,start_date,end_date) VALUES ('season','competition','2027','2027-01-01','2027-12-31')",
  ).run();
  for (const [person, profile, role] of [
    ["ref1", "rp1", "REFEREE"],
    ["ref2", "rp2", "REFEREE"],
    ["a1", "ap1", "ASSISTANT_REFEREE"],
    ["a2", "ap2", "ASSISTANT_REFEREE"],
    ["a3", "ap3", "ASSISTANT_REFEREE"],
    ["a4", "ap4", "ASSISTANT_REFEREE"],
    ["var1", "vp1", "VAR_OFFICIAL"],
  ] as const) {
    db.prepare(
      "INSERT INTO persons (id,full_name,nationality_country_id,languages_json) VALUES (?,?,?,'[]')",
    ).run(person, person, "nepal");
    db.prepare(
      "INSERT INTO referee_profiles (id,person_id,primary_role,competitions_eligible_json,fifa_listed) VALUES (?,?,?,'[]',0)",
    ).run(profile, person, role);
    new WorkforceSupplyRepository(db).upsertOfficial(official(person, profile, role));
  }
  db.prepare(
    "INSERT INTO fixtures (id,competition_season_id,home_team_id,away_team_id,scheduled_date,status,round) VALUES ('fixture-1','season','home','away','2027-01-01','scheduled',1),('fixture-2','season','away','home','2027-01-01','scheduled',1)",
  ).run();
  return db;
};

describe("fixture referee assignment", () => {
  it("is persisted, deterministic, neutral, and workload-aware", () => {
    const db = setup();
    const first = assignOfficialsToFixture(db, fixture("fixture-1"), { usesVar: true });
    const again = assignOfficialsToFixture(db, fixture("fixture-1"));
    const second = assignOfficialsToFixture(db, fixture("fixture-2"));
    expect(first.status).toBe("ASSIGNED");
    expect(first.varPersonId).toBe("var1");
    expect(again).toEqual(first);
    expect(second.status).toBe("ASSIGNED");
    expect(second.refereePersonId).not.toBe(first.refereePersonId);
    expect(
      new Set([
        first.refereePersonId,
        first.assistantReferee1PersonId,
        first.assistantReferee2PersonId,
      ]).size,
    ).toBe(3);
    expect(new RefereeAssignmentRepository(db).forFixture(id("fixture-1"))).toEqual(first);
    db.close();
  });

  it("carries the persisted official into resumable match state", () => {
    const db = setup();
    const assignment = assignOfficialsToFixture(db, fixture("fixture-1"));
    const state = createMatchState({
      fixture: fixture("fixture-1"),
      refereeAssignment: assignment,
      homePlayers: [],
      awayPlayers: [],
      seed: "test",
    });
    expect(state.refereeAssignment).toEqual(assignment);
    expect(state.environment.refereeStrictness).toBeGreaterThan(1);
    db.close();
  });
});
