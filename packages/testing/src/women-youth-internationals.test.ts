import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  InternationalFootballRepository,
  openGameDatabase,
} from "@nepal-football-sim/database";
import { createStableEntityId, type EntityId } from "@nepal-football-sim/shared-types";
import {
  advanceInternationalCompetition,
  createInternationalCompetitionEdition,
  createNepalSave,
  generateYouthCohort,
  getNationalTeamHistory,
  initializeInternationalFootballForSave,
  issueComplianceSanction,
  scheduleFriendly,
  selectNationalTeamSquad,
  simulateNepalCareer,
} from "@nepal-football-sim/simulation";

const dirs: string[] = [];
const registryPath = resolve(process.cwd(), "data/nepal/2026-08/club-registry.json");

const preparedDatabase = (seed: string) => {
  const dir = mkdtempSync(join(tmpdir(), "women-youth-internationals-"));
  dirs.push(dir);
  const databasePath = join(dir, "career.sqlite");
  createNepalSave({
    databasePath,
    dataset: JSON.parse(readFileSync(registryPath, "utf8")) as unknown,
    saveName: seed,
    gameVersion: "test",
    randomSeed: seed,
    globalSeedPath: null,
  });
  const db = openGameDatabase(databasePath);
  simulateNepalCareer({ db, seasons: 0, seed, internationalEnabled: true });
  initializeInternationalFootballForSave({ db, worldDate: "2026-08-01", seed });
  return { db, databasePath };
};

const ids = (db: ReturnType<typeof openGameDatabase>) => {
  const federation = db
    .prepare(
      `SELECT f.id
       FROM federations f
       JOIN countries c ON c.id = f.country_id
       WHERE c.iso_code IN ('NPL', 'NP')
       ORDER BY CASE WHEN c.iso_code = 'NPL' THEN 0 ELSE 1 END, f.name
       LIMIT 1`,
    )
    .get() as { id: EntityId };
  const women = db.prepare("SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'senior' AND gender = 'women'").get(federation.id) as { id: EntityId };
  const seniorMen = db.prepare("SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'senior' AND gender = 'men'").get(federation.id) as { id: EntityId };
  const u17 = db.prepare("SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'u17' AND gender = 'men'").get(federation.id) as { id: EntityId };
  const u20 = db.prepare("SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'u20' AND gender = 'men'").get(federation.id) as { id: EntityId };
  const u23 = db.prepare("SELECT id FROM teams WHERE federation_id = ? AND club_id IS NULL AND level = 'u23' AND gender = 'men'").get(federation.id) as { id: EntityId };
  return { federationId: federation.id, womenId: women.id, seniorMenId: seniorMen.id, u17Id: u17.id, u20Id: u20.id, u23Id: u23.id };
};

afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("women and youth international football", () => {
  it("runs the women pool, selection, fixtures, competition history, and reload through shared systems", () => {
    const { db, databasePath } = preparedDatabase("women-e2e");
    const { federationId, womenId } = ids(db);
    const coach = db
      .prepare(
        `SELECT p.full_name FROM staff_appointments sa
         JOIN persons p ON p.id = sa.person_id
         WHERE sa.team_id = ? AND sa.role = 'NATIONAL_TEAM_HEAD_COACH'
           AND sa.employment_status = 'ACTIVE'`,
      )
      .get(womenId) as { full_name: string } | undefined;
    expect(coach?.full_name).toBe("Nabin Neupane");
    const selected = selectNationalTeamSquad(db, { federationId, nationalTeamId: womenId, date: "2028-08-25", programme: "Women SAFF call-up", seed: "women-e2e", size: 23 });
    expect(selected).toHaveLength(23);
    const coverage = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN pa.primary_position='GK' THEN 1 ELSE 0 END) AS goalkeepers, SUM(CASE WHEN pa.primary_position IN ('CB','LB','RB') THEN 1 ELSE 0 END) AS defenders, SUM(CASE WHEN pa.primary_position IN ('DM','CM','AM') THEN 1 ELSE 0 END) AS midfielders, SUM(CASE WHEN pa.primary_position IN ('LW','RW','ST') THEN 1 ELSE 0 END) AS attackers FROM player_attributes pa JOIN persons p ON p.id=pa.person_id WHERE p.id IN (${selected.map(() => "?").join(",")})`).get(...selected.map((callup) => callup.playerId)) as { total: number; goalkeepers: number; defenders: number; midfielders: number; attackers: number };
    expect(coverage.total).toBe(23);
    expect(coverage.goalkeepers).toBeGreaterThan(0);
    expect(coverage.defenders).toBeGreaterThan(0);
    expect(coverage.midfielders).toBeGreaterThan(0);
    expect(coverage.attackers).toBeGreaterThan(0);

    const injuredId = selected[0]!.playerId;
    db.prepare("INSERT INTO injuries (id, person_id, injury_type, date_occurred, expected_recovery_date, severity) VALUES (?, ?, ?, ?, ?, ?)").run(createStableEntityId("injury", injuredId), injuredId, "Test injury", "2028-08-20", "2028-09-30", "MODERATE");
    const ineligibleId = selected[1]!.playerId;
    new FederationGovernanceRepository(db).upsertInternationalEligibility({ id: createStableEntityId("international-eligibility", `${federationId}:${ineligibleId}`), playerId: ineligibleId, federationId, status: "INELIGIBLE", documentationStatus: "CONFIRMED", discoveredVia: "NATIONALITY", lastReviewedAt: "2028-08-25", provenanceStatus: "SIMULATION_ONLY" });
    const filtered = selectNationalTeamSquad(db, { federationId, nationalTeamId: womenId, date: "2028-08-25", programme: "Women SAFF filtered", seed: "women-e2e", size: 23 });
    expect(filtered.map((callup) => callup.playerId)).not.toContain(injuredId);
    expect(filtered.map((callup) => callup.playerId)).not.toContain(ineligibleId);

    const edition = createInternationalCompetitionEdition(db, { competitionKey: "SAFF_WOMEN", cycle: "2028", startDate: "2028-09-01", seed: "women-e2e" });
    const completed = advanceInternationalCompetition(db, edition.id, "women-e2e");
    const history = getNationalTeamHistory(db, womenId);
    expect(completed.edition.status).toBe("COMPLETED");
    expect(completed.matches.some((match) => match.status === "PLAYED")).toBe(true);
    expect(history.matches).not.toHaveLength(0);
    expect(history.capsLeaders).not.toHaveLength(0);
    const before = { matches: completed.matches.length, caps: history.capsLeaders.reduce((total, row) => total + row.caps, 0) };
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const replay = advanceInternationalCompetition(reloaded, edition.id, "women-e2e");
    const reloadedHistory = getNationalTeamHistory(reloaded, womenId);
    expect(replay.matches).toHaveLength(before.matches);
    expect(reloadedHistory.capsLeaders.reduce((total, row) => total + row.caps, 0)).toBe(before.caps);
    reloaded.close();
  });

  it("uses canonical generated youth identities across age eligibility, senior priority, competition, history, and senior progression", () => {
    const { db, databasePath } = preparedDatabase("youth-e2e");
    const { federationId, seniorMenId, u17Id, u20Id, u23Id } = ids(db);
    const source = db.prepare("SELECT t.id AS team_id, c.id AS club_id, c.country_id FROM teams t JOIN clubs c ON c.id=t.club_id WHERE t.level='senior' AND t.gender='men' ORDER BY t.id LIMIT 1").get() as { team_id: EntityId; club_id: EntityId; country_id: EntityId };
    generateYouthCohort({ db, countryId: source.country_id, clubId: source.club_id, teamId: source.team_id, date: "2027-06-01", seasonLabel: "2027", seed: "youth-e2e", count: 36, gender: "male", cohortKey: "international-proof" });
    const first = selectNationalTeamSquad(db, { federationId, nationalTeamId: u17Id, date: "2027-07-01", programme: "U17 window", seed: "youth-e2e", size: 23 });
    expect(first.length).toBeGreaterThan(2);
    const generatedCount = db
      .prepare(
        `SELECT COUNT(*) AS count FROM generated_player_origins WHERE player_id IN (${first
          .map(() => "?")
          .join(",")})`,
      )
      .get(...first.map((callup) => callup.playerId)) as { count: number };
    expect(generatedCount.count).toBeGreaterThan(0);
    const generatedU17 = first.find((callup) => Boolean(db.prepare("SELECT 1 FROM generated_player_origins WHERE player_id=?").get(callup.playerId)))!;
    expect(generatedU17).toBeTruthy();

    const unavailableId = first[0]!.playerId;
    db.prepare("INSERT INTO player_availability_states (person_id, team_id, fitness, morale_modifier, form_modifier, availability, updated_on) VALUES (?, ?, ?, ?, ?, ?, ?)").run(unavailableId, source.team_id, 100, 0, 0, "SUSPENDED", "2027-06-30");
    const conflictId = first[1]!.playerId;
    new FederationGovernanceRepository(db).upsertNationalTeamCallup({ id: createStableEntityId("national-team-callup", `${seniorMenId}:${conflictId}:2027-07-01:priority`), nationalTeamId: seniorMenId, playerId: conflictId, callupDate: "2027-07-01", programme: "Senior priority", squadType: "FINAL", status: "CALLED_UP", provenanceStatus: "SIMULATION_ONLY" });
    const filtered = selectNationalTeamSquad(db, { federationId, nationalTeamId: u17Id, date: "2027-07-01", programme: "U17 filtered", seed: "youth-e2e", size: 23 });
    expect(filtered.map((callup) => callup.playerId)).not.toContain(unavailableId);
    expect(filtered.map((callup) => callup.playerId)).not.toContain(conflictId);
    db.prepare("UPDATE persons SET date_of_birth='1990-01-01' WHERE id=?").run(generatedU17.playerId);
    const agedOut = selectNationalTeamSquad(db, { federationId, nationalTeamId: u17Id, date: "2027-07-01", programme: "U17 age check", seed: "youth-e2e", size: 23 });
    expect(agedOut.map((callup) => callup.playerId)).not.toContain(generatedU17.playerId);
    expect(selectNationalTeamSquad(db, { federationId, nationalTeamId: u20Id, date: "2027-07-01", programme: "U20 window", seed: "youth-e2e", size: 23 })).not.toHaveLength(0);
    expect(selectNationalTeamSquad(db, { federationId, nationalTeamId: u23Id, date: "2027-07-01", programme: "U23 window", seed: "youth-e2e", size: 23 })).not.toHaveLength(0);

    const edition = createInternationalCompetitionEdition(db, { competitionKey: "SAFF_U17", cycle: "2027", startDate: "2027-10-04", seed: "youth-e2e" });
    advanceInternationalCompetition(db, edition.id, "youth-e2e");
    expect(getNationalTeamHistory(db, u17Id).matches).not.toHaveLength(0);
    const pathwayId = first[2]!.playerId;
    const attributes = db.prepare("SELECT technical_json, mental_json, physical_json, goalkeeping_json FROM player_attributes WHERE person_id=?").get(pathwayId) as Record<string, string>;
    const elite = (json: string) => JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(json)).map((key) => [key, 20])));
    db.prepare("UPDATE persons SET date_of_birth='2002-01-01' WHERE id=?").run(pathwayId);
    db.prepare("UPDATE player_attributes SET technical_json=?, mental_json=?, physical_json=?, goalkeeping_json=? WHERE person_id=?").run(elite(attributes.technical_json), elite(attributes.mental_json), elite(attributes.physical_json), elite(attributes.goalkeeping_json), pathwayId);
    const senior = selectNationalTeamSquad(db, { federationId, nationalTeamId: seniorMenId, date: "2030-07-01", programme: "Senior pathway", seed: "youth-e2e", size: 23 });
    expect(senior.map((callup) => callup.playerId)).toContain(pathwayId);
    db.close();

    const reloaded = openGameDatabase(databasePath);
    const matches = new InternationalFootballRepository(reloaded).matches(edition.id);
    const appearances = new FederationGovernanceRepository(reloaded).nationalTeamAppearances(u17Id);
    expect(matches.every((match) => match.status === "PLAYED")).toBe(true);
    expect(appearances.length).toBeGreaterThan(0);
    reloaded.close();
  });

  it("applies a federation participation sanction equally to women and youth pathways", () => {
    const { db } = preparedDatabase("international-sanction");
    const { federationId, womenId, u17Id } = ids(db);
    issueComplianceSanction(db, { federationId, date: "2028-01-01", authority: "FIFA", category: "TEST_SUSPENSION", reason: "Deterministic test sanction", requirementsForResolution: ["Resolve test"], affectedProgrammes: ["NATIONAL_TEAM"], consequences: ["NATIONAL_TEAM_PARTICIPATION_BLOCKED"] });
    expect(selectNationalTeamSquad(db, { federationId, nationalTeamId: womenId, date: "2028-02-01", programme: "Blocked women", seed: "international-sanction" })).toEqual([]);
    expect(selectNationalTeamSquad(db, { federationId, nationalTeamId: u17Id, date: "2028-02-01", programme: "Blocked youth", seed: "international-sanction" })).toEqual([]);
    expect(scheduleFriendly(db, { federationId, nationalTeamId: womenId, opponentName: "India Senior Women", date: "2028-02-07", seed: "international-sanction" }).status).toBe("CANCELLED");
    const edition = createInternationalCompetitionEdition(db, { competitionKey: "SAFF_WOMEN", cycle: "2028-blocked", startDate: "2028-09-01", seed: "international-sanction" });
    const profiles = new InternationalFootballRepository(db);
    expect(profiles.participants(edition.id).map((participant) => profiles.teamProfile(participant.teamProfileId)?.nationalTeamId)).not.toContain(womenId);
    db.close();
  });
});
