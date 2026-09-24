import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FederationGovernanceRepository,
  InternationalFootballRepository,
  WorldRepository,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  initializeFederationGovernanceForSave,
  initializeInternationalFootballForSave,
  nationalTeamOutcomes,
  playNationalTeamFixture,
  closeFederationFinancialSeason,
  scheduleFriendly,
  selectNationalTeamSquad,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 10B: the national-team player pool, the head-coach appointment (the one
 * operation the President canonically owns) and one consistent fixture
 * perspective. Squad selection, friendlies and match play stay with the
 * simulation, so they are deliberately not exposed as commands.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "National Team Operator",
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
  const directory = mkdtempSync(join(tmpdir(), `ntops-${label}-`));
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
  (db
    .prepare("SELECT id FROM teams WHERE federation_id=? AND club_id IS NULL AND level=? AND gender=? ORDER BY id LIMIT 1")
    .get(federationId(db), level, gender) as { id: EntityId }).id;

const worldDate = (savePath: string): string =>
  withDb(savePath, (db) => (db.prepare("SELECT world_date FROM saves LIMIT 1").get() as { world_date: string }).world_date);

const newPresident = (label: string) => {
  const service = newService(label);
  const created = service.createCareer({ saveName: `NTO ${label}`, character });
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
       VALUES ('nto-tenure', ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run(personId, federationId(db), save.world_date);
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath };
};

const addCoach = (db: GameDatabase, id: string, licence: string | undefined): EntityId => {
  const personId = id as EntityId;
  const world = new WorldRepository(db);
  const countryId = (db.prepare("SELECT country_id FROM federations WHERE id=?").get(federationId(db)) as { country_id: EntityId }).country_id;
  world.insertPerson({
    id: personId,
    fullName: `Coach ${id}`,
    displayName: `Coach ${id}`,
    dateOfBirth: "1976-03-04",
    nationalityCountryId: countryId,
    genderPresentation: "unknown",
    languages: ["Nepali"],
  });
  world.insertPersonRole({ id: `${id}-role` as EntityId, personId, role: "STAFF", activeFrom: "2026-08-01" });
  world.insertStaffProfile({
    id: `${id}-profile` as EntityId,
    personId,
    preferredRole: "NATIONAL_TEAM_HEAD_COACH",
    salaryExpectation: "NATIONAL_TEAM_SCALE",
    reputation: "SIMULATION_ONLY",
    countryKnowledge: [countryId],
    clubKnowledge: [],
    availability: "AVAILABLE",
    workEligibilityStatus: "ELIGIBLE",
  });
  if (licence)
    world.insertStaffLicence({ id: `${id}-licence` as EntityId, personId, licenceType: licence, issuer: "ANFA", status: "VERIFIED" });
  return personId;
};

describe("role boundary", () => {
  it("a Manager cannot read the pool or candidates, or appoint a coach", () => {
    const service = newService("manager");
    expect(service.createCareer({ saveName: "NTO manager", character }).ok).toBe(true);
    for (const result of [
      service.getNationalTeamPlayerPool("x" as EntityId),
      service.getNationalTeamCoachCandidates("x" as EntityId),
      service.appointNationalTeamHeadCoach("x" as EntityId, "y" as EntityId),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  }, 240_000);

  it("an Owner cannot read the pool or candidates, or appoint a coach", () => {
    const service = newService("owner");
    const clubs = service.listStartingClubs();
    if (!clubs.ok) throw new Error(clubs.error.message);
    expect(service.createCareer({ careerMode: "OWNER", saveName: "NTO owner", joinTeamId: clubs.data[0]!.teamId, character }).ok).toBe(true);
    for (const result of [
      service.getNationalTeamPlayerPool("x" as EntityId),
      service.getNationalTeamCoachCandidates("x" as EntityId),
      service.appointNationalTeamHeadCoach("x" as EntityId, "y" as EntityId),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ROLE_NOT_AUTHORIZED");
    }
    service.closeCareer();
  }, 240_000);

  it("the President cannot use a team that is not a national team of the federation", () => {
    const { service, savePath } = newPresident("scope");
    const clubTeam = withDb(savePath, (db) => (db.prepare("SELECT id FROM teams WHERE club_id IS NOT NULL LIMIT 1").get() as { id: EntityId }).id);
    for (const id of [clubTeam, "no-such-team" as EntityId]) {
      for (const result of [
        service.getNationalTeamPlayerPool(id),
        service.getNationalTeamCoachCandidates(id),
        service.appointNationalTeamHeadCoach(id, "y" as EntityId),
      ]) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("INVALID_SELECTION");
      }
    }
    service.closeCareer();
  }, 240_000);
});

describe("player pool", () => {
  it("shows every selected player as selectable, keeps categories apart and exposes no hidden value", () => {
    const { service, savePath } = newPresident("pool");
    service.closeCareer();
    const ids = withDb(savePath, (db) => {
      const men = teamId(db, "senior", "men");
      selectNationalTeamSquad(db, { federationId: federationId(db), nationalTeamId: men, date: worldDate(savePath), programme: "SENIOR_MENS", seed: "nto-pool", size: 23 });
      return { men, women: teamId(db, "senior", "women"), u17: teamId(db, "u17", "men"), u23: teamId(db, "u23", "men") };
    });
    const eligibilityRowsBefore = withDb(savePath, (db) => (db.prepare("SELECT COUNT(*) AS n FROM player_international_eligibilities").get() as { n: number }).n);
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    const pool = service.getNationalTeamPlayerPool(ids.men, { onlyEligible: true });
    if (!pool.ok) throw new Error(pool.error.message);
    const squad = service.getNationalTeamSquad(ids.men);
    if (!squad.ok) throw new Error(squad.error.message);
    expect(squad.data.players.length).toBeGreaterThan(0);
    expect(pool.data.poolCount).toBeGreaterThanOrEqual(pool.data.matchingCount);
    expect(pool.data.selectableCount).toBeGreaterThanOrEqual(squad.data.players.length);
    const full = service.getNationalTeamPlayerPool(ids.men, { onlyEligible: false });
    if (!full.ok) throw new Error(full.error.message);
    const inPool = new Map(full.data.players.map((row) => [row.player.id, row]));
    for (const player of squad.data.players.filter((item) => item.selectionStatus === "CALLED_UP")) {
      const row = inPool.get(player.personId);
      expect(row, `${player.displayName} is in the pool`).toBeDefined();
      expect(row!.selection).toBe("CALLED_UP");
      expect(row!.eligibility).toBe("ELIGIBLE");
      expect(row!.selectable).toBe(true);
    }
    expect(JSON.stringify(pool.data)).not.toMatch(/"(currentAbility|potentialAbility|ability|potential|selectionScore|internationalSelectionScore|strength|rating|formWeight|preference)"/i);

    const women = service.getNationalTeamPlayerPool(ids.women);
    const u17 = service.getNationalTeamPlayerPool(ids.u17, { onlyEligible: true });
    const u23 = service.getNationalTeamPlayerPool(ids.u23, { onlyEligible: true });
    if (!women.ok || !u17.ok || !u23.ok) throw new Error("pool failed");
    const womenIds = new Set(women.data.players.map((row) => row.player.id));
    expect(full.data.players.filter((row) => womenIds.has(row.player.id))).toEqual([]);
    for (const row of u17.data.players) expect(row.age === undefined || row.age <= 17).toBe(true);
    for (const row of u23.data.players) expect(row.age === undefined || row.age <= 23).toBe(true);
    for (const row of u17.data.players) expect(row.eligibility).toBe("ELIGIBLE");

    service.closeCareer();
    const eligibilityRowsAfter = withDb(savePath, (db) => (db.prepare("SELECT COUNT(*) AS n FROM player_international_eligibilities").get() as { n: number }).n);
    expect(eligibilityRowsAfter).toBe(eligibilityRowsBefore);
  }, 300_000);

  it("reads without recording anything and shows injuries and retirements as ineligible or unavailable", () => {
    const { service, savePath } = newPresident("pool-state");
    service.closeCareer();
    const picked = withDb(savePath, (db) => {
      const men = teamId(db, "senior", "men");
      selectNationalTeamSquad(db, { federationId: federationId(db), nationalTeamId: men, date: worldDate(savePath), programme: "SENIOR_MENS", seed: "nto-state", size: 23 });
      const players = new FederationGovernanceRepository(db).nationalTeamCallups(men).map((callup) => callup.playerId);
      const injured = players[0]!;
      const retired = players[1]!;
      db.prepare(
        `INSERT INTO injuries (id, person_id, injury_type, severity, date_occurred, expected_recovery_date) VALUES ('nto-injury', ?, 'HAMSTRING', 'MINOR', ?, '2099-01-01')`,
      ).run(injured, worldDate(savePath));
      db.prepare(
        `INSERT INTO international_retirements (id, player_id, national_team_id, status, decided_on, reason, provenance_status) VALUES ('nto-retired', ?, ?, 'RETIRED_INTERNATIONAL', ?, 'test', 'SIMULATION_ONLY')`,
      ).run(retired, men, worldDate(savePath));
      return { men, injured, retired };
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const pool = service.getNationalTeamPlayerPool(picked.men);
    if (!pool.ok) throw new Error(pool.error.message);
    const find = (id: EntityId) => {
      for (const position of pool.data.positions) {
        const rows = service.getNationalTeamPlayerPool(picked.men, { position });
        if (rows.ok) {
          const row = rows.data.players.find((item) => item.player.id === id);
          if (row) return row;
        }
      }
      return undefined;
    };
    const injuredRow = find(picked.injured);
    expect(injuredRow?.availability).toBe("INJURED");
    expect(injuredRow?.selectable).toBe(false);
    const retiredRow = find(picked.retired);
    expect(retiredRow?.eligibility).toBe("RETIRED_INTERNATIONAL");
    expect(retiredRow?.selectable).toBe(false);
    service.closeCareer();
  }, 300_000);
});

describe("head-coach appointment", () => {
  it("lists eligible candidates for a vacant seat, appoints one canonically and refuses a second", () => {
    const { service, savePath } = newPresident("coach");
    service.closeCareer();
    const ids = withDb(savePath, (db) => {
      const men = teamId(db, "senior", "men");
      db.prepare("UPDATE staff_appointments SET employment_status='FORMER', end_date=? WHERE team_id=? AND role='NATIONAL_TEAM_HEAD_COACH' AND employment_status='ACTIVE'").run(worldDate(savePath), men);
      return {
        men,
        good: addCoach(db, "nto-good-coach", "AFC_B"),
        second: addCoach(db, "nto-second-coach", "AFC_B"),
        unlicensed: addCoach(db, "nto-unlicensed-coach", undefined),
      };
    });
    expect(service.loadCareerByPath(savePath).ok).toBe(true);

    const before = service.getNationalTeamCoachCandidates(ids.men);
    if (!before.ok) throw new Error(before.error.message);
    expect(before.data.vacant).toBe(true);
    expect(before.data.candidates.length).toBeGreaterThan(1);
    const listed = before.data.candidates.map((candidate) => candidate.person.id);
    expect(listed).not.toContain(ids.unlicensed);
    for (const candidate of before.data.candidates) {
      expect(candidate.availability).toBe("AVAILABLE");
      expect(candidate.licence).toBeDefined();
    }
    expect(JSON.stringify(before.data)).not.toMatch(/"(ability|currentAbility|potential|score|fitScore|fit|rating|reputation|ranking|rank)"/i);
    const good = listed[0]!;
    const second = listed[1]!;

    const refused = service.appointNationalTeamHeadCoach(ids.men, ids.unlicensed);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("INVALID_SELECTION");

    const appointed = service.appointNationalTeamHeadCoach(ids.men, good);
    if (!appointed.ok) throw new Error(appointed.error.message);
    expect(appointed.data).toEqual({ appointedPersonId: good, nationalTeamId: ids.men });
    const staff = service.getNationalTeamStaff(ids.men);
    if (!staff.ok) throw new Error(staff.error.message);
    expect(staff.data.headCoachVacant).toBe(false);
    expect(staff.data.members.filter((member) => member.role === "NATIONAL_TEAM_HEAD_COACH")).toHaveLength(1);
    expect(staff.data.members.find((member) => member.role === "NATIONAL_TEAM_HEAD_COACH")?.person.id).toBe(good);
    const after = service.getNationalTeamCoachCandidates(ids.men);
    if (!after.ok) throw new Error(after.error.message);
    expect(after.data).toMatchObject({ vacant: false, candidates: [] });

    const again = service.appointNationalTeamHeadCoach(ids.men, second);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("INVALID_SELECTION");

    service.closeCareer();
    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const reloaded = service.getNationalTeamStaff(ids.men);
    if (!reloaded.ok) throw new Error(reloaded.error.message);
    expect(reloaded.data.members.find((member) => member.role === "NATIONAL_TEAM_HEAD_COACH")?.person.id).toBe(good);
    service.closeCareer();
  }, 300_000);

  it("does not offer candidates for a team that already has a head coach", () => {
    const { service, savePath } = newPresident("filled");
    const men = withDb(savePath, (db) => teamId(db, "senior", "men"));
    const view = service.getNationalTeamCoachCandidates(men);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.data).toMatchObject({ vacant: false, candidates: [] });
    service.closeCareer();
  }, 240_000);
});

describe("fixture perspective", () => {
  it("counts home and away wins, losses and draws from the national team's side, in one place", () => {
    const { service, savePath } = newPresident("perspective");
    service.closeCareer();
    const men = withDb(savePath, (db) => {
      const id = teamId(db, "senior", "men");
      const federation = federationId(db);
      const international = new InternationalFootballRepository(db);
      const own = international.teamProfiles().find((profile) => profile.nationalTeamId === id)!;
      const opponents = international.teamProfiles().filter((profile) => profile.id !== own.id).slice(0, 6);
      // [Nepal is home, home goals, away goals]
      const cases: Array<[boolean, number, number]> = [
        [true, 2, 0], // home win
        [true, 0, 1], // home loss
        [false, 0, 2], // away win
        [false, 3, 1], // away loss
        [true, 1, 1], // draw
        [false, 0, 1], // second away win: the old home-goals reading missed it
      ];
      cases.forEach(([nepalHome, homeGoals, awayGoals], index) => {
        const opponent = opponents[index]!;
        const date = `2026-08-${String(10 + index).padStart(2, "0")}`;
        international.upsertMatch({
          id: `nto-match-${index}` as EntityId,
          matchDate: date as never,
          homeTeamProfileId: nepalHome ? own.id : opponent.id,
          awayTeamProfileId: nepalHome ? opponent.id : own.id,
          neutralVenue: false,
          status: "PLAYED",
          homeGoals,
          awayGoals,
          extraTimePlayed: false,
          penaltiesPlayed: false,
          importance: "QUALIFIER",
          provenanceStatus: "SIMULATION_ONLY",
        });
        // The simulation mirrors each match into the federation record with the match's own home/away goals.
        db.prepare(
          `INSERT INTO national_team_fixtures (id, federation_id, national_team_id, opponent_name, fixture_date, fixture_type, venue_id, status, home_goals, away_goals, estimated_cost, estimated_revenue, currency, provenance_status)
           VALUES (?, ?, ?, ?, ?, 'QUALIFIER', NULL, 'PLAYED', ?, ?, 0, 0, 'NPR', 'SIMULATION_ONLY')`,
        ).run(`nto-mirror-${index}`, federation, id, opponent.name, date, homeGoals, awayGoals);
      });
      return id;
    });

    const results = withDb(savePath, (db) => nationalTeamOutcomes(db, withDb(savePath, federationId)).filter((item) => item.teamId === men));
    expect(results.map((item) => item.result).sort()).toEqual(["DRAW", "LOSS", "LOSS", "WIN", "WIN", "WIN"]);
    expect(results.filter((item) => item.result === "WIN").map((item) => `${item.goalsFor}-${item.goalsAgainst}`).sort()).toEqual(["1-0", "2-0", "2-0"]);
    expect(results.filter((item) => item.result === "LOSS").map((item) => `${item.goalsFor}-${item.goalsAgainst}`).sort()).toEqual(["0-1", "1-3"]);

    withDb(savePath, (db) => closeFederationFinancialSeason(db, { seasonLabel: "2026", date: "2026-12-31" }));
    const wins = withDb(savePath, (db) =>
      new FederationGovernanceRepository(db)
        .kpis(federationId(db))
        .filter((item) => item.metric === "INTERNATIONAL_WINS")
        .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0]?.value,
    );
    expect(wins).toBe(3);

    expect(service.loadCareerByPath(savePath).ok).toBe(true);
    const fixtures = service.getNationalTeamFixtures(men);
    if (!fixtures.ok) throw new Error(fixtures.error.message);
    expect(fixtures.data.results.filter((match) => match.result === "WIN")).toHaveLength(3);
    service.closeCareer();
  }, 300_000);

  it("counts a played friendly from the national team's side", () => {
    const { service, savePath } = newPresident("friendly-outcome");
    service.closeCareer();
    const outcome = withDb(savePath, (db) => {
      const id = teamId(db, "senior", "men");
      const federation = federationId(db);
      selectNationalTeamSquad(db, { federationId: federation, nationalTeamId: id, date: worldDate(savePath), programme: "SENIOR_MENS", seed: "nto-friendly", size: 23 });
      const friendly = scheduleFriendly(db, { federationId: federation, nationalTeamId: id, opponentName: "Bhutan", date: worldDate(savePath), seed: "nto-friendly" });
      const played = playNationalTeamFixture(db, friendly.id, "nto-friendly");
      const mine = nationalTeamOutcomes(db, federation).filter((item) => item.teamId === id);
      return { played, mine };
    });
    expect(outcome.mine).toHaveLength(1);
    expect(outcome.mine[0]).toMatchObject({ goalsFor: outcome.played.homeGoals, goalsAgainst: outcome.played.awayGoals });
  }, 300_000);
});

