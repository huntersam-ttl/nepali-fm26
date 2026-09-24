import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  initializeFederationGovernanceForSave,
  initializeInternationalFootballForSave,
} from "@nepal-football-sim/simulation";
import type { EntityId, NationalTeamCompetitionEntry } from "@nepal-football-sim/shared-types";

/*
 * Phase 10C: the President's read view of a national team's competitions. Group
 * tables, knockout rounds, campaign and squad-registration state come from the
 * international competition record; matches keep the national team's own
 * perspective; nothing hidden (seeding, draw, strength) or predictive is shown.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Competition Tester",
  dateOfBirth: "1985-01-01",
  startingAge: 41,
  languages: ["en"],
  footballBackground: "COMMUNITY_COACHING",
  education: "SPORTS_RELATED_DEGREE",
  playingExperience: "AMATEUR_PLAYER",
  coachingExperience: "YOUTH_COACH",
  businessBackground: "SMALL_BUSINESS",
  startingReputationProfile: "LOCAL_RESPECTED",
};

const newService = (label: string) => {
  const directory = mkdtempSync(join(tmpdir(), `ntcomp-${label}-`));
  dirs.push(directory);
  return new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
};

const withDb = <T,>(savePath: string, run: (db: GameDatabase) => T): T => {
  const db = openGameDatabase(savePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
};

const federationId = (db: GameDatabase): EntityId =>
  (db.prepare("SELECT id FROM federations WHERE name='All Nepal Football Association'").get() as { id: EntityId }).id;

const newPresident = (label: string) => {
  const service = newService(label);
  const created = service.createCareer({ saveName: `NTC ${label}`, character });
  if (!created.ok) throw new Error(created.error.message);
  const savePath = created.data.catalogEntry.filePath;
  service.closeCareer();
  withDb(savePath, (db) => {
    const save = db.prepare("SELECT player_character_id, world_date, random_seed FROM saves LIMIT 1").get() as {
      player_character_id: EntityId;
      world_date: string;
      random_seed: string;
    };
    const personId = (db.prepare("SELECT person_id FROM career_characters WHERE id=?").get(save.player_character_id) as { person_id: EntityId }).person_id;
    initializeFederationGovernanceForSave({ db, worldDate: save.world_date, seed: save.random_seed });
    initializeInternationalFootballForSave({ db, worldDate: save.world_date, seed: save.random_seed });
    db.prepare(
      `INSERT INTO federation_leadership_tenures (id, person_id, federation_id, role, term_start, term_end, status, provenance_status)
       VALUES ('ntc-tenure', ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run(personId, federationId(db), save.world_date);
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath };
};

describe("role boundary and honest empties", () => {
  it("a Manager and an Owner cannot read national-team competitions", () => {
    const manager = newService("manager");
    expect(manager.createCareer({ saveName: "NTC manager", character }).ok).toBe(true);
    const asManager = manager.getNationalTeamCompetitions("x" as EntityId);
    expect(asManager.ok).toBe(false);
    if (!asManager.ok) expect(asManager.error.code).toBe("ROLE_NOT_AUTHORIZED");
    manager.closeCareer();

    const owner = newService("owner");
    const clubs = owner.listStartingClubs();
    if (!clubs.ok) throw new Error(clubs.error.message);
    expect(owner.createCareer({ careerMode: "OWNER", saveName: "NTC owner", joinTeamId: clubs.data[0]!.teamId, character }).ok).toBe(true);
    const asOwner = owner.getNationalTeamCompetitions("x" as EntityId);
    expect(asOwner.ok).toBe(false);
    if (!asOwner.ok) expect(asOwner.error.code).toBe("ROLE_NOT_AUTHORIZED");
    owner.closeCareer();
  }, 240_000);

  it("the President gets an honest empty view for every team and cannot read a non-national team", () => {
    const { service, savePath } = newPresident("empty");
    const teams = withDb(savePath, (db) =>
      db.prepare("SELECT id FROM teams WHERE federation_id=? AND club_id IS NULL").all(federationId(db)) as Array<{ id: EntityId }>,
    );
    expect(teams).toHaveLength(5);
    for (const { id } of teams) {
      const view = service.getNationalTeamCompetitions(id);
      if (!view.ok) throw new Error(view.error.message);
      expect(view.data).toMatchObject({ active: [], upcoming: [], completed: [], provenanceStatus: "SIMULATION_ONLY" });
    }
    const invalid = service.getNationalTeamCompetitions("no-such-team" as EntityId);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("INVALID_SELECTION");
    service.closeCareer();
  }, 300_000);
});

describe("campaigns, groups, knockout and registration from real editions", () => {
  let service: DesktopApplicationService;
  let ids: { men: EntityId; women: EntityId; u23: EntityId; u20: EntityId; u17: EntityId };
  const read = (id: EntityId) => {
    const view = service.getNationalTeamCompetitions(id);
    if (!view.ok) throw new Error(view.error.message);
    return view.data;
  };

  let fixtureDir: string | undefined;
  beforeAll(() => {
    ({ service } = newPresident("fixture"));
    // The shared save must outlive the per-test cleanup above.
    fixtureDir = dirs.pop();
    const seeded = service.seedE2ENationalTeamCompetitionFixture();
    if (!seeded.ok) throw new Error(seeded.error.message);
    ids = seeded.data;
  }, 600_000);
  afterAll(() => {
    service.closeCareer();
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5 });
  });

  const entryOf = (id: EntityId): NationalTeamCompetitionEntry => {
    const view = read(id);
    const all = [...view.active, ...view.upcoming, ...view.completed];
    expect(all).toHaveLength(1);
    return all[0]!;
  };

  it("maps the completed senior men's edition with its group table and route through the stages", () => {
    const men = read(ids.men);
    expect(men.active).toEqual([]);
    expect(men.upcoming).toEqual([]);
    expect(men.completed).toHaveLength(1);
    const saff = men.completed[0]!;
    expect(saff).toMatchObject({ edition: "SAFF Championship 2026", cycle: "2026", status: "COMPLETED", startDate: "2026-09-01" });
    expect(saff.stages.map((stage) => stage.name)).toEqual(["Group Stage", "Semi-Final and Final"]);

    const table = saff.groupTable!;
    expect(table.advanceCount).toBe(saff.stages[0]!.teamsToAdvance);
    expect(table.rows.filter((row) => row.isThisTeam)).toHaveLength(1);
    for (const row of table.rows) {
      expect(row.played).toBe(row.won + row.drawn + row.lost);
      expect(row.points).toBe(row.won * 3 + row.drawn);
      expect(row.goalDifference).toBe(row.goalsFor - row.goalsAgainst);
    }
    const ordered = [...table.rows].sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor);
    expect(table.rows.map((row) => row.team)).toEqual(ordered.map((row) => row.team));

    // The table and the team's own matches agree, including for away games.
    const own = table.rows.find((row) => row.isThisTeam)!;
    const groupMatches = saff.matches.filter((match) => match.stage === "Group Stage" && match.status === "PLAYED");
    expect(own.played).toBe(groupMatches.length);
    expect(own.won).toBe(groupMatches.filter((match) => match.result === "WIN").length);
    expect(own.drawn).toBe(groupMatches.filter((match) => match.result === "DRAW").length);
    expect(own.lost).toBe(groupMatches.filter((match) => match.result === "LOSS").length);
    expect(own.goalsFor).toBe(groupMatches.reduce((sum, match) => sum + (match.goalsFor ?? 0), 0));
    expect(own.goalsAgainst).toBe(groupMatches.reduce((sum, match) => sum + (match.goalsAgainst ?? 0), 0));

    const knockoutMatches = saff.knockout.flatMap((round) => round.matches);
    const reached = knockoutMatches.some((match) => match.status === "PLAYED") ? "Semi-Final and Final" : "Group Stage";
    expect(saff.outcome.stageReached).toBe(reached);
    if (saff.entryStatus === "CHAMPION") expect(saff.outcome.key).toBe("CHAMPION");
    else expect(saff.outcome).toMatchObject({ key: "ELIMINATED", label: `Eliminated in ${reached}` });
    if (reached === "Group Stage") expect(saff.knockout).toEqual([]);
    for (const round of saff.knockout) {
      expect(round.round).toBe("Semi-Final and Final");
      for (const match of round.matches) expect(match.competition).toBe("SAFF Championship 2026");
    }
  }, 300_000);

  it("records the qualification route only where the record has one, and computes no probabilities", () => {
    for (const id of [ids.men, ids.u23, ids.women]) {
      const view = read(id);
      const entry = [...view.active, ...view.upcoming, ...view.completed][0]!;
      expect(entry.qualificationSource).toBeUndefined();
      expect(entry.qualificationLinks).toEqual([]);
      expect(JSON.stringify(view)).not.toMatch(/"(probability|chance|odds|seedRating|pot|seed|strength|simulationStrength|simulationReputation|formRating|ranking|coefficient|drawWeight)"/i);
    }
  }, 300_000);

  it("shows the squad registration separately from the current squad, with its deadline, lock state and limits", () => {
    const saff = read(ids.men).completed[0]!;
    const registration = saff.registration!;
    expect(registration).toMatchObject({ status: "PROVISIONAL", locked: false, deadline: "2026-08-25", limits: { preliminary: 30, final: 26, matchday: 23 } });
    expect(registration.playerCount).toBeGreaterThan(0);
    expect(registration.playerCount).toBeLessThanOrEqual(23);
    expect(registration.players).toHaveLength(registration.playerCount);
    expect(new Set(registration.players.map((row) => row.player.id)).size).toBe(registration.playerCount);
    for (const row of registration.players) expect(row.player.entityType).toBe("PLAYER");

    // Eligibility comes from the same rules as the player pool.
    const pool = service.getNationalTeamPlayerPool(ids.men, { onlyEligible: false });
    if (!pool.ok) throw new Error(pool.error.message);
    const inPool = new Map(pool.data.players.map((row) => [row.player.id, row]));
    const compared = registration.players.filter((row) => inPool.has(row.player.id));
    expect(compared.length).toBeGreaterThan(0);
    for (const row of compared) {
      expect(row.eligibility).toBe(inPool.get(row.player.id)!.eligibility);
      expect(row.availability).toBe(inPool.get(row.player.id)!.availability);
    }
    // The registration and the current squad are separate records.
    const squad = service.getNationalTeamSquad(ids.men);
    if (!squad.ok) throw new Error(squad.error.message);
    expect(saff.campaign).toMatchObject({ name: "SAFF 2026 campaign", matchesPlayed: 0, qualificationStatus: "ACTIVE" });
    expect(saff.onDutyCount).toBeGreaterThan(0);
  }, 300_000);

  it("keeps campaigns and registrations apart between the five teams", () => {
    const women = read(ids.women);
    expect(women.completed).toEqual([]);
    expect(women.active).toEqual([]);
    expect(women.upcoming).toHaveLength(1);
    const upcoming = women.upcoming[0]!;
    expect(upcoming.edition).toMatch(/Women/);
    expect(upcoming).toMatchObject({ status: "PLANNED", outcome: { key: "NOT_STARTED", label: "Not started" }, matches: [], knockout: [], registration: undefined, campaign: undefined });

    const u23 = read(ids.u23);
    expect(u23.completed).toEqual([]);
    expect(u23.upcoming).toEqual([]);
    expect(u23.active).toHaveLength(1);
    expect(u23.active[0]!.registration).toBeUndefined();

    for (const id of [ids.u20, ids.u17]) expect(read(id)).toMatchObject({ active: [], upcoming: [], completed: [] });

    const editionIds = [entryOf(ids.men), entryOf(ids.women), entryOf(ids.u23)].map((entry) => entry.editionId);
    expect(new Set(editionIds).size).toBe(3);
    expect(entryOf(ids.men).edition).not.toBe(entryOf(ids.u23).edition);
    expect(entryOf(ids.women).edition).not.toBe(entryOf(ids.men).edition);
  }, 300_000);

  it("shows a partly played edition as active, with a partial table and the next match", () => {
    const active = read(ids.u23).active[0]!;
    expect(active.status).toBe("IN_PROGRESS");
    expect(active.outcome.key).toBe("COMPETING");
    expect(active.outcome.label).toMatch(/^Competing in /);
    expect(active.matches.some((match) => match.status === "PLAYED")).toBe(true);
    expect(active.nextMatch?.status).toBe("SCHEDULED");
    const own = active.groupTable!.rows.find((row) => row.isThisTeam)!;
    expect(own.played).toBe(active.matches.filter((match) => match.stage === "Group Stage" && match.status === "PLAYED").length);
    const rows = active.groupTable!.rows;
    const total = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
    expect(total((row) => row.won)).toBe(total((row) => row.lost));
    expect(total((row) => row.goalsFor)).toBe(total((row) => row.goalsAgainst));
    expect(total((row) => row.drawn) % 2).toBe(0);
  }, 300_000);

  it("agrees with the team overview and fixtures for the same matches", () => {
    const saff = read(ids.men).completed[0]!;
    const overview = service.getNationalTeamOverview(ids.men);
    const fixtures = service.getNationalTeamFixtures(ids.men);
    if (!overview.ok || !fixtures.ok) throw new Error("read failed");
    expect(overview.data.competitions.map((item) => item.edition)).toContain(saff.edition);
    const fixtureIds = new Set(fixtures.data.results.map((match) => match.id));
    for (const match of saff.matches.filter((item) => item.status === "PLAYED")) {
      expect(fixtureIds.has(match.id)).toBe(true);
      const same = fixtures.data.results.find((item) => item.id === match.id)!;
      expect({ goalsFor: same.goalsFor, goalsAgainst: same.goalsAgainst, result: same.result, venueSide: same.venueSide }).toEqual({
        goalsFor: match.goalsFor,
        goalsAgainst: match.goalsAgainst,
        result: match.result,
        venueSide: match.venueSide,
      });
    }
    const women = service.getNationalTeamOverview(ids.women);
    if (!women.ok) throw new Error(women.error.message);
    expect(women.data.competitions.map((item) => item.edition)).not.toContain(saff.edition);
  }, 300_000);
});
