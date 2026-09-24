import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InternationalFootballRepository, openGameDatabase, type GameDatabase } from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  initializeFederationGovernanceForSave,
  initializeInternationalFootballForSave,
  playNationalTeamFixture,
  scheduleFriendly,
  selectNationalTeamSquad,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 10A: the President's national-team workspace reads. Matches are shown
 * from the team's own perspective, teams never leak into each other, and no
 * hidden simulation value leaves the backend.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "National Team Tester",
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
  const directory = mkdtempSync(join(tmpdir(), `ntwork-${label}-`));
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

const teamId = (db: GameDatabase, level: string, gender: string): EntityId =>
  (db.prepare("SELECT id FROM teams WHERE federation_id=? AND club_id IS NULL AND level=? AND gender=? ORDER BY id LIMIT 1").get(federationId(db), level, gender) as { id: EntityId }).id;

const newPresident = (label: string) => {
  const service = newService(label);
  const created = service.createCareer({ saveName: `NT ${label}`, character });
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
       VALUES ('nt-tenure', ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run(personId, federationId(db), save.world_date);
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath };
};

const worldDate = (savePath: string): string =>
  withDb(savePath, (db) => (db.prepare("SELECT world_date FROM saves LIMIT 1").get() as { world_date: string }).world_date);

describe("role boundary", () => {
  it("a Manager cannot open the national-team workspace reads", () => {
    const service = newService("manager");
    expect(service.createCareer({ saveName: "NT manager", character }).ok).toBe(true);
    for (const result of [
      service.getNationalTeamOverview("x" as EntityId),
      service.getNationalTeamStaff("x" as EntityId),
      service.getNationalTeamFixtures("x" as EntityId),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  }, 240_000);

  it("an Owner cannot open the national-team workspace reads", () => {
    const service = newService("owner");
    const clubs = service.listStartingClubs();
    if (!clubs.ok) throw new Error(clubs.error.message);
    expect(service.createCareer({ careerMode: "OWNER", saveName: "NT owner", joinTeamId: clubs.data[0]!.teamId, character }).ok).toBe(true);
    for (const result of [
      service.getNationalTeamOverview("x" as EntityId),
      service.getNationalTeamStaff("x" as EntityId),
      service.getNationalTeamFixtures("x" as EntityId),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  }, 240_000);

  it("the President cannot read a team that is not a national team of the federation", () => {
    const { service, savePath } = newPresident("scope");
    const clubTeam = withDb(savePath, (db) => (db.prepare("SELECT id FROM teams WHERE club_id IS NOT NULL LIMIT 1").get() as { id: EntityId }).id);
    for (const id of [clubTeam, "no-such-team" as EntityId]) {
      const result = service.getNationalTeamOverview(id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_SELECTION");
    }
    service.closeCareer();
  }, 240_000);
});

describe("identity, staff and separation", () => {
  it("maps every national team with its own type, staff and empty squad and fixtures", () => {
    const { service, savePath } = newPresident("identity");
    const ids = withDb(savePath, (db) => ({
      men: teamId(db, "senior", "men"),
      women: teamId(db, "senior", "women"),
      u23: teamId(db, "u23", "men"),
      u20: teamId(db, "u20", "men"),
      u17: teamId(db, "u17", "men"),
    }));
    const labels = { men: "Senior men", women: "Senior women", u23: "Under-23 men", u20: "Under-20 men", u17: "Under-17 men" } as const;
    for (const [key, id] of Object.entries(ids) as Array<[keyof typeof ids, EntityId]>) {
      const overview = service.getNationalTeamOverview(id);
      if (!overview.ok) throw new Error(overview.error.message);
      expect(overview.data.team).toMatchObject({ id, typeLabel: labels[key], federation: { name: "All Nepal Football Association" } });
      expect(overview.data.headCoach?.entityType).toBe("STAFF");
      expect(overview.data.staffCount).toBe(5);
      expect(overview.data.squad.squadSize).toBe(0);
      expect(overview.data.nextMatch).toBeUndefined();
      expect(overview.data.recent).toEqual([]);
      expect(overview.data.attention.map((item) => item.key)).toEqual(["squad"]);
      const staff = service.getNationalTeamStaff(id);
      if (!staff.ok) throw new Error(staff.error.message);
      expect(staff.data.members.map((member) => member.roleLabel)).toEqual([
        "Head coach",
        "Assistant coach",
        "Performance coach",
        "Medical lead",
        "Analyst",
      ]);
      expect(staff.data.headCoachVacant).toBe(false);
      const fixtures = service.getNationalTeamFixtures(id);
      if (!fixtures.ok) throw new Error(fixtures.error.message);
      expect(fixtures.data.upcoming).toEqual([]);
      expect(fixtures.data.results).toEqual([]);
    }
    expect(ids.women.length).toBeGreaterThan(0);
    service.closeCareer();
  }, 240_000);

  it("reports a truthful head-coach vacancy and attention", () => {
    const { service, savePath } = newPresident("vacancy");
    service.closeCareer();
    const id = withDb(savePath, (db) => {
      const men = teamId(db, "senior", "men");
      db.prepare("UPDATE staff_appointments SET employment_status='FORMER', end_date='2026-08-02' WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH'").run(men);
      return men;
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const staff = service.getNationalTeamStaff(id);
    if (!staff.ok) throw new Error(staff.error.message);
    expect(staff.data.headCoachVacant).toBe(true);
    expect(staff.data.members.map((member) => member.role)).not.toContain("NATIONAL_TEAM_HEAD_COACH");
    const overview = service.getNationalTeamOverview(id);
    if (!overview.ok) throw new Error(overview.error.message);
    expect(overview.data.headCoach).toBeUndefined();
    expect(overview.data.attention.map((item) => item.key)).toContain("coach");
    service.closeCareer();
  }, 240_000);
});

describe("squad, matches and competitions", () => {
  it("maps competition context from the team's own participation and campaign only", () => {
    const { service, savePath } = newPresident("competition");
    service.closeCareer();
    const ids = withDb(savePath, (db) => {
      const men = teamId(db, "senior", "men");
      const women = teamId(db, "senior", "women");
      const federation = federationId(db);
      const international = new InternationalFootballRepository(db);
      const own = international.teamProfiles().find((profile) => profile.nationalTeamId === men)!;
      const competitionId = (db.prepare("SELECT id FROM international_competitions LIMIT 1").get() as { id: EntityId }).id;
      international.upsertEdition({
        id: "nt-edition" as EntityId,
        competitionId,
        name: "SAFF Championship 2026",
        cycle: "2026",
        startDate: "2026-09-01" as never,
        endDate: "2026-09-20" as never,
        status: "SCHEDULED",
        hostCountryIds: [],
        qualificationLinks: [],
        ruleProvenanceStatus: "SIMULATION_ONLY",
      });
      international.upsertParticipant({
        id: "nt-participant" as EntityId,
        editionId: "nt-edition" as EntityId,
        teamProfileId: own.id,
        entryStatus: "QUALIFIED",
        seedRating: 50,
        groupName: "Group A",
        provenanceStatus: "SIMULATION_ONLY",
      });
      db.prepare(
        `INSERT INTO national_team_campaigns (id, federation_id, national_team_id, competition_edition_id, name, started_on, matches_played, wins, draws, losses, qualification_status, objectives_json, status)
         VALUES ('nt-campaign', ?, ?, 'nt-edition', 'SAFF 2026 campaign', '2026-08-01', 2, 1, 1, 0, 'ACTIVE', '{}', 'SIMULATION_ONLY')`,
      ).run(federation, men);
      return { men, women };
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const men = service.getNationalTeamOverview(ids.men);
    const women = service.getNationalTeamOverview(ids.women);
    if (!men.ok || !women.ok) throw new Error("overview failed");
    expect(men.data.competitions).toEqual([
      {
        edition: "SAFF Championship 2026",
        status: "SCHEDULED",
        startDate: "2026-09-01",
        endDate: "2026-09-20",
        entryStatus: "QUALIFIED",
        group: "Group A",
        campaign: { name: "SAFF 2026 campaign", matchesPlayed: 2, wins: 1, draws: 1, losses: 0, qualificationStatus: "ACTIVE" },
      },
    ]);
    expect(women.data.competitions).toEqual([]);
    service.closeCareer();
  }, 240_000);

  it("summarises the called-up squad and keeps it out of other teams", () => {
    const { service, savePath } = newPresident("squad");
    service.closeCareer();
    const ids = withDb(savePath, (db) => {
      const men = teamId(db, "senior", "men");
      selectNationalTeamSquad(db, {
        federationId: federationId(db),
        nationalTeamId: men,
        date: worldDate(savePath),
        programme: "SENIOR_MENS",
        seed: "nt-squad",
        size: 23,
      });
      return { men, women: teamId(db, "senior", "women") };
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const men = service.getNationalTeamOverview(ids.men);
    const women = service.getNationalTeamOverview(ids.women);
    if (!men.ok || !women.ok) throw new Error("overview failed");
    expect(men.data.squad.squadSize).toBeGreaterThan(0);
    expect(men.data.squad.selectedCount).toBe(men.data.squad.squadSize);
    expect(men.data.attention.map((item) => item.key)).not.toContain("squad");
    expect(women.data.squad.squadSize).toBe(0);
    const squad = service.getNationalTeamSquad(ids.men);
    if (!squad.ok) throw new Error(squad.error.message);
    expect(squad.data.players).toHaveLength(men.data.squad.squadSize);
    expect(JSON.stringify([men.data, squad.data.players])).not.toMatch(/simulationStrength|formRating|familiarity|cohesion|potential|currentAbility|selectionScore/i);
    service.closeCareer();
  }, 240_000);

  it("shows friendlies and competition matches from the team's own perspective without duplicates", () => {
    const { service, savePath } = newPresident("matches");
    service.closeCareer();
    const today = worldDate(savePath);
    const men = withDb(savePath, (db) => {
      const id = teamId(db, "senior", "men");
      const federation = federationId(db);
      selectNationalTeamSquad(db, { federationId: federation, nationalTeamId: id, date: today, programme: "SENIOR_MENS", seed: "nt-matches", size: 23 });
      const friendly = scheduleFriendly(db, { federationId: federation, nationalTeamId: id, opponentName: "Bhutan", date: today, seed: "nt-friendly" });
      playNationalTeamFixture(db, friendly.id, "nt-friendly");
      scheduleFriendly(db, { federationId: federation, nationalTeamId: id, opponentName: "Maldives", date: "2026-11-01", seed: "nt-next" });

      // An away competition match that Nepal won 2-0, plus the mirror row the simulation writes for it.
      const international = new InternationalFootballRepository(db);
      const own = international.teamProfiles().find((profile) => profile.nationalTeamId === id)!;
      const opponent = international.teamProfiles().find((profile) => profile.id !== own.id)!;
      international.upsertMatch({
        id: "nt-away-match" as EntityId,
        matchDate: "2026-08-20" as never,
        homeTeamProfileId: opponent.id,
        awayTeamProfileId: own.id,
        neutralVenue: false,
        status: "PLAYED",
        homeGoals: 0,
        awayGoals: 2,
        extraTimePlayed: false,
        penaltiesPlayed: false,
        importance: "QUALIFIER",
        provenanceStatus: "SIMULATION_ONLY",
      });
      db.prepare(
        `INSERT INTO national_team_fixtures (id, federation_id, national_team_id, opponent_name, fixture_date, fixture_type, venue_id, status, home_goals, away_goals, estimated_cost, estimated_revenue, currency, provenance_status)
         VALUES ('nt-mirror', ?, ?, ?, '2026-08-20', 'QUALIFIER', NULL, 'PLAYED', 0, 2, 0, 0, 'NPR', 'SIMULATION_ONLY')`,
      ).run(federation, id, opponent.name);
      return { id, opponentName: opponent.name };
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    const fixtures = service.getNationalTeamFixtures(men.id);
    if (!fixtures.ok) throw new Error(fixtures.error.message);
    expect(fixtures.data.upcoming.map((match) => match.opponent)).toEqual(["Maldives"]);
    expect(fixtures.data.upcoming[0]).toMatchObject({ status: "SCHEDULED", venueSide: "NOT_RECORDED", kind: "FRIENDLY" });
    const away = fixtures.data.results.find((match) => match.id === "nt-away-match");
    expect(away).toMatchObject({ opponent: men.opponentName, venueSide: "AWAY", goalsFor: 2, goalsAgainst: 0, result: "WIN", kind: "QUALIFIER" });
    expect(fixtures.data.results.filter((match) => match.opponent === men.opponentName && match.date === "2026-08-20")).toHaveLength(1);
    const friendly = fixtures.data.results.find((match) => match.opponent === "Bhutan");
    expect(friendly?.status).toBe("PLAYED");
    expect(friendly?.goalsFor).toBeDefined();
    const dates = fixtures.data.results.map((match) => match.date);
    expect([...dates].sort().reverse()).toEqual(dates);

    const overview = service.getNationalTeamOverview(men.id);
    if (!overview.ok) throw new Error(overview.error.message);
    expect(overview.data.nextMatch?.opponent).toBe("Maldives");
    expect(overview.data.recent.length).toBe(fixtures.data.results.filter((match) => match.status === "PLAYED").length);

    const dashboard = service.getFederationPresidentDashboard();
    if (!dashboard.ok) throw new Error(dashboard.error.message);
    const summary = dashboard.data.nationalTeams.find((team) => team.id === men.id);
    expect(summary?.nextFixture).toEqual({ opponent: "Maldives", date: "2026-11-01" });
    service.closeCareer();
  }, 240_000);
});
