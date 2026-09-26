import { describe, expect, it } from "vitest";
import {
  CompetitionRepository,
  TerritorialFootballRepository,
  migrateDatabase,
  openGameDatabase,
} from "@nepal-football-sim/database";
import {
  initializeTerritorialStructure,
  initializeTerritorialCompetition,
} from "@nepal-football-sim/simulation";
import type { EntityId, TerritorialCompetitionConfig } from "@nepal-football-sim/shared-types";

const id = (value: string) => value as EntityId;

const config: TerritorialCompetitionConfig = {
  id: id("territorial-national"),
  name: "National Territorial Championship",
  level: "NATIONAL",
  participantType: "PROVINCE",
  format: "LEAGUE",
  qualifierCount: 1,
  seasonStartDate: "2027-01-01",
  seasonEndDate: "2027-02-28",
  roundSpacingDays: 3,
  winnerRequired: false,
  eligibility: { developmentRegistration: true },
  provenanceStatus: "SIMULATION_ONLY",
};

describe("territorial representative competition pathway", () => {
  it("initializes seven province teams and idempotent fixtures", () => {
    const db = openGameDatabase(":memory:");
    migrateDatabase(db);
    db.prepare("INSERT INTO countries (id,name,iso_code) VALUES ('np','Nepal','NP')").run();
    db.prepare(
      "INSERT INTO federations (id,country_id,name) VALUES ('fed','np','Simulation Federation')",
    ).run();
    initializeTerritorialStructure(db, "2027-01-01");
    const first = initializeTerritorialCompetition(db, {
      config,
      seasonLabel: "2027",
      seed: "territorial",
    });
    const second = initializeTerritorialCompetition(db, {
      config,
      seasonLabel: "2027",
      seed: "different-seed",
    });
    const repo = new TerritorialFootballRepository(db);
    expect(first.id).toBe(second.id);
    expect(first.participantTeamIds).toHaveLength(7);
    expect(repo.teams()).toHaveLength(7);
    expect(new CompetitionRepository(db).fixtures(first.id)).toHaveLength(21);
    expect(repo.competitionSeasons()).toHaveLength(1);
    db.close();
  });
});
