import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  InternationalFootballRepository,
  NationalTeamManagementRepository,
  openGameDatabase,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  DesktopApplicationService,
  ensureNepalDutyForEdition,
  initializeFederationGovernanceForSave,
  initializeInternationalFootballForSave,
  nationalTeamPoolStanding,
  processInternationalForSeasonPeriod,
} from "@nepal-football-sim/simulation";
import type { EntityId } from "@nepal-football-sim/shared-types";

/*
 * Phase 10D: the simulation writes the campaign and squad-registration state the
 * workspace reads. One campaign and one final registration per team and edition,
 * the squad is the simulation's own selection, statuses follow the edition, only
 * the champion has a placement, and group-stage draws stay draws.
 */

const registryPath = resolve("data/nepal/2026-08/club-registry.json");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const character = {
  fullName: "Lifecycle Tester",
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
  const directory = mkdtempSync(join(tmpdir(), `ntlife-${label}-`));
  dirs.push(directory);
  const service = new DesktopApplicationService({ savesDirectory: directory, worldDatasetPath: registryPath });
  const created = service.createCareer({ saveName: `NTL ${label}`, character });
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
       VALUES ('ntl-tenure', ?, ?, 'FEDERATION_PRESIDENT', ?, '2030-01-01', 'ACTIVE', 'SIMULATION_ONLY')`,
    ).run(personId, federationId(db), save.world_date);
  });
  expect(service.loadCareerByPath(savePath).ok).toBe(true);
  expect(service.switchActiveCareerRole("FEDERATION_PRESIDENT").ok).toBe(true);
  return { service, savePath, directory };
};

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

describe("campaign and registration written by the simulation (fixture editions)", () => {
  let service: DesktopApplicationService;
  let savePath: string;
  let directory: string;
  let ids: { men: EntityId; women: EntityId; u23: EntityId; u20: EntityId; u17: EntityId };
  const competitions = (id: EntityId) => {
    const view = service.getNationalTeamCompetitions(id);
    if (!view.ok) throw new Error(view.error.message);
    return view.data;
  };

  beforeAll(() => {
    ({ service, savePath, directory } = newPresident("fixture"));
    dirs.pop();
    const seeded = service.seedE2ENationalTeamCompetitionFixture();
    if (!seeded.ok) throw new Error(seeded.error.message);
    ids = seeded.data;
  }, 600_000);
  afterAll(() => {
    service.closeCareer();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  it("creates exactly one campaign per team and edition, linked to the edition, and never a duplicate", () => {
    const saff = competitions(ids.men).completed[0]!;
    withDb(savePath, (db) => {
      const management = new NationalTeamManagementRepository(db);
      const mine = management.campaigns(ids.men).filter((item) => item.competitionEditionId === saff.editionId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ name: `${saff.edition} campaign`, startedOn: saff.startDate, nationalTeamId: ids.men });
      // Entering again (as a later pass would) changes nothing.
      const edition = new InternationalFootballRepository(db).editions().find((item) => item.id === saff.editionId)!;
      const before = management.registrations().find((item) => item.competitionEditionId === saff.editionId)!;
      ensureNepalDutyForEdition(db, edition, "another-seed");
      expect(management.campaigns(ids.men).filter((item) => item.competitionEditionId === saff.editionId)).toHaveLength(1);
      const after = management.registrations().filter((item) => item.competitionEditionId === saff.editionId);
      expect(after).toHaveLength(1);
      expect(after[0]!.finalPlayerIds).toEqual(before.finalPlayerIds);
    });
  }, 300_000);

  it("keeps the campaign's record and status in step with the matches and the participant", () => {
    const saff = competitions(ids.men).completed[0]!;
    const played = saff.matches.filter((match) => match.status === "PLAYED");
    const goalsResult = (match: (typeof played)[number]) => (match.goalsFor! > match.goalsAgainst! ? "W" : match.goalsFor! < match.goalsAgainst! ? "L" : "D");
    expect(saff.campaign).toMatchObject({
      matchesPlayed: played.length,
      wins: played.filter((match) => goalsResult(match) === "W").length,
      draws: played.filter((match) => goalsResult(match) === "D").length,
      losses: played.filter((match) => goalsResult(match) === "L").length,
    });
    expect(saff.campaign!.qualificationStatus).toBe(saff.entryStatus === "CHAMPION" ? "COMPLETED" : "ELIMINATED");

    const u23 = competitions(ids.u23).active[0]!;
    expect(u23.campaign).toMatchObject({ qualificationStatus: "ACTIVE", matchesPlayed: u23.matches.filter((match) => match.status === "PLAYED").length });
    expect(u23.entryStatus).toMatch(/^(ACTIVE|HOST)$/);
  }, 300_000);

  it("registers the simulation's own selection as the team's final squad, a week before the edition", () => {
    for (const [teamId, entry] of [
      [ids.men, competitions(ids.men).completed[0]!],
      [ids.u23, competitions(ids.u23).active[0]!],
    ] as const) {
      const registration = entry.registration!;
      expect(registration).toMatchObject({ status: "FINAL", locked: true, deadline: addDays(entry.startDate, -7) });
      expect(registration.limits).toMatchObject({ final: 26 });
      expect(registration.playerCount).toBeGreaterThan(0);
      expect(registration.playerCount).toBeLessThanOrEqual(26);
      expect(new Set(registration.players.map((row) => row.player.id)).size).toBe(registration.playerCount);
      // Every registered player was eligible for this team on the registration date.
      const standing = withDb(savePath, (db) => nationalTeamPoolStanding(db, teamId, registration.deadline));
      for (const row of registration.players) {
        expect(standing.get(row.player.id)?.eligibility, `${row.player.label} on ${registration.deadline}`).toBe("ELIGIBLE");
      }
    }
  }, 300_000);

  it("keeps registrations and campaigns inside their own team", () => {
    withDb(savePath, (db) => {
      const management = new NationalTeamManagementRepository(db);
      const byEdition = new Map<string, Set<string>>();
      for (const item of management.registrations()) {
        byEdition.set(item.competitionEditionId, (byEdition.get(item.competitionEditionId) ?? new Set()).add(item.nationalTeamId));
      }
      for (const teams of byEdition.values()) expect(teams.size).toBe(1);
      const teamsWithCampaigns = new Set(management.campaigns().map((item) => item.nationalTeamId));
      expect([...teamsWithCampaigns].sort()).toEqual([ids.men, ids.u23].sort());
    });
    expect(competitions(ids.women).upcoming[0]).toMatchObject({ registration: undefined, campaign: undefined });
    for (const id of [ids.u20, ids.u17]) expect(competitions(id)).toMatchObject({ active: [], upcoming: [], completed: [] });
  }, 300_000);

  it("has no way for the President to change a registration", () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(methods.filter((name) => /nationalTeam\w*Regist|squadRegist|amendSquad|finaliz\w*Squad|withdrawFrom|enterCompetition|registerNationalTeam/i.test(name))).toEqual([]);
  });

  it("records the route only where the simulation knows it, and leaves the rest unknown", () => {
    withDb(savePath, (db) => {
      const repo = new InternationalFootballRepository(db);
      for (const edition of repo.editions()) {
        for (const participant of repo.participants(edition.id)) {
          const profile = repo.teamProfile(participant.teamProfileId)!;
          if (edition.hostCountryIds.includes(profile.countryId)) expect(participant.qualificationSource).toBe("Host nation");
          else expect(participant.qualificationSource).toBeUndefined();
        }
        expect(edition.qualificationLinks).toEqual([]);
      }
    });
    const saff = competitions(ids.men).completed[0]!;
    expect(saff.qualificationLinks).toEqual([]);
  }, 300_000);

  it("moves participants out of 'active' as they are eliminated, names one champion, and ranks nobody else", () => {
    withDb(savePath, (db) => {
      const repo = new InternationalFootballRepository(db);
      const saff = repo.editions().find((edition) => edition.name === "SAFF Championship 2026")!;
      const participants = repo.participants(saff.id);
      const champions = participants.filter((item) => item.entryStatus === "CHAMPION");
      expect(champions).toHaveLength(1);
      expect(champions[0]!.finalPlacement).toBe(1);
      for (const item of participants.filter((entry) => entry.entryStatus !== "CHAMPION")) {
        expect(item.entryStatus).toBe("ELIMINATED");
        expect(item.finalPlacement).toBeUndefined();
      }
      // Anyone who reached the knockout stage was still in after the group stage.
      const knockoutTeams = new Set(repo.matches(saff.id).filter((match) => !match.groupName).flatMap((match) => [match.homeTeamProfileId, match.awayTeamProfileId]));
      expect(knockoutTeams.size).toBeGreaterThan(0);
      expect(participants.filter((item) => !knockoutTeams.has(item.teamProfileId)).every((item) => item.entryStatus === "ELIMINATED")).toBe(true);

      // A partly played edition has nobody eliminated yet.
      const u23 = repo.editions().find((edition) => edition.name.includes("U23"))!;
      expect(repo.participants(u23.id).every((item) => item.entryStatus === "ACTIVE" || item.entryStatus === "HOST")).toBe(true);
    });
  }, 300_000);

  it("keeps group-stage draws as draws, records penalties only when played, and keeps the team's perspective", () => {
    withDb(savePath, (db) => {
      const repo = new InternationalFootballRepository(db);
      const saff = repo.editions().find((edition) => edition.name === "SAFF Championship 2026")!;
      const matches = repo.matches(saff.id).filter((match) => match.status === "PLAYED");
      for (const match of matches.filter((item) => item.groupName)) {
        expect(match.penaltiesPlayed).toBe(false);
        expect(match.extraTimePlayed).toBe(false);
        if (match.homeGoals === match.awayGoals) expect(match.winnerTeamProfileId).toBeUndefined();
        else expect(match.winnerTeamProfileId).toBe((match.homeGoals ?? 0) > (match.awayGoals ?? 0) ? match.homeTeamProfileId : match.awayTeamProfileId);
      }
      for (const match of matches.filter((item) => !item.groupName)) {
        expect(match.winnerTeamProfileId).toBeDefined();
        if (match.penaltiesPlayed) {
          expect(match.homePenaltyGoals).toBeDefined();
          expect(match.awayPenaltyGoals).toBeDefined();
        } else {
          expect(match.homePenaltyGoals).toBeUndefined();
        }
      }
    });
    // The same matches read from the team's side keep home and away straight.
    const saff = competitions(ids.men).completed[0]!;
    for (const match of saff.matches.filter((item) => item.status === "PLAYED" && item.stage === "Group Stage")) {
      if (match.goalsFor === match.goalsAgainst) expect(match.result).toBe("DRAW");
    }
  }, 300_000);

  it("plays the whole edition ahead of the calendar and says so, and reads active, upcoming and completed consistently", () => {
    const view = competitions(ids.men);
    const saff = view.completed[0]!;
    expect(saff.status).toBe("COMPLETED");
    expect(saff.simulatedAhead).toBe(true);
    const asOf = view.asOf;
    for (const match of saff.matches) {
      if (match.status === "PLAYED" && match.date > asOf) expect(match.simulatedAhead).toBe(true);
      else expect(match.simulatedAhead).toBeUndefined();
    }
    const fixtures = service.getNationalTeamFixtures(ids.men);
    if (!fixtures.ok) throw new Error(fixtures.error.message);
    for (const match of fixtures.data.results.filter((item) => item.date > asOf)) expect(match.simulatedAhead).toBe(true);
    // Each entry sits in exactly one section, and the sections agree with the status.
    const all = [...view.active, ...view.upcoming, ...view.completed];
    expect(new Set(all.map((entry) => entry.editionId)).size).toBe(all.length);
    for (const entry of view.completed) expect(entry.status).toBe("COMPLETED");
    for (const entry of [...view.active, ...view.upcoming]) expect(entry.status).not.toBe("COMPLETED");
    expect(competitions(ids.u23).active[0]!.simulatedAhead).toBe(false);
  }, 300_000);

  it("agrees between the overview and the competitions read", () => {
    const saff = competitions(ids.men).completed[0]!;
    const overview = service.getNationalTeamOverview(ids.men);
    if (!overview.ok) throw new Error(overview.error.message);
    const row = overview.data.competitions.find((item) => item.edition === saff.edition)!;
    expect(row.campaign).toMatchObject({ matchesPlayed: saff.campaign!.matchesPlayed, wins: saff.campaign!.wins, draws: saff.campaign!.draws, losses: saff.campaign!.losses });
    expect(row.registration).toEqual({
      status: saff.registration!.status,
      locked: saff.registration!.locked,
      playerCount: saff.registration!.playerCount,
      deadline: saff.registration!.deadline,
    });
  }, 300_000);
});

describe("the real season-batch path", () => {
  it("writes a campaign and a final registration for each of Nepal's entries, without any test-only creation", () => {
    const { service, savePath } = newPresident("batch");
    service.closeCareer();
    const run = () =>
      withDb(savePath, (db) => processInternationalForSeasonPeriod(db, { seasonEndDate: "2027-06-30", seed: "ntl-batch" }));
    run();
    const snapshot = () =>
      withDb(savePath, (db) => {
        const management = new NationalTeamManagementRepository(db);
        return {
          campaigns: management.campaigns().map((item) => `${item.nationalTeamId}:${item.competitionEditionId}:${item.qualificationStatus}:${item.matchesPlayed}`).sort(),
          registrations: management.registrations().map((item) => `${item.nationalTeamId}:${item.competitionEditionId}:${item.status}:${(item.finalPlayerIds ?? []).length}`).sort(),
        };
      });
    const first = snapshot();
    expect(first.campaigns.length).toBeGreaterThan(0);
    expect(first.registrations.length).toBe(first.campaigns.length);
    withDb(savePath, (db) => {
      const management = new NationalTeamManagementRepository(db);
      const repo = new InternationalFootballRepository(db);
      for (const campaign of management.campaigns()) {
        const edition = repo.editions().find((item) => item.id === campaign.competitionEditionId)!;
        expect(edition.status).toBe("COMPLETED");
        expect(["ELIMINATED", "COMPLETED"]).toContain(campaign.qualificationStatus);
        const registration = management.registrations().find((item) => item.competitionEditionId === edition.id && item.nationalTeamId === campaign.nationalTeamId)!;
        expect(registration).toMatchObject({ status: "FINAL", registrationDeadline: addDays(edition.startDate, -7) });
        expect(campaign.matchesPlayed).toBeGreaterThanOrEqual(1);
      }
      // A different Nepal team enters each edition; no team enters the same edition twice.
      const keys = management.campaigns().map((item) => `${item.nationalTeamId}:${item.competitionEditionId}`);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }, 900_000);
});
