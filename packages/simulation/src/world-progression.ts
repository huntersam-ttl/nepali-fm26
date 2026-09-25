import { seasonEndMonth } from "./home-context.js";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  WorldRepository,
  updateSaveWorldDate,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { buildAiTacticalSetup } from "./ai-tactics.js";
import { heldCareerRoles } from "./career-control.js";
import { compactOldMatchEvents, compactResolvedInterviews } from "./storage-policy.js";
import { familiarityAfterTacticChange, validateSelection } from "./tactics.js";
import {
  createStableEntityId,
  type CompetitionSeason,
  type EntityId,
  type LeagueStanding,
  type SaveMetadata,
  type SeasonStatusView,
} from "@nepal-football-sim/shared-types";
import {
  clubIdForTeam,
  closeEconomySeasonPeriod,
  closeFederationSeasonPeriod,
  ensureFixtures,
  ensureWorldSystems,
  latestSeasonEnd,
  markSeasonState,
  processCareerExternalWorldSeason,
  processEconomyMonthTick,
  processFederationMonthTick,
  rolloverCompetitions,
  runTerritorialAndPreseasonStage,
  runTransferWindowStage,
  runYouthStage,
  runnableSeasons,
  seasonState,
  simulateCompetitionSeason,
  type RunnableSeason,
} from "./career-world.js";
import { processInternationalForSeasonPeriod } from "./international-football.js";
import { reconcileWorkforceSupply } from "./workforce-supply.js";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

/** Runs `run` atomically: everything it wrote is kept together or, if it throws, undone. Nests safely. */
export const inSavepoint = <T>(db: GameDatabase, name: string, run: () => T): T => {
  db.exec(`SAVEPOINT ${name};`);
  try {
    const result = run();
    db.exec(`RELEASE ${name};`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO ${name};`);
    db.exec(`RELEASE ${name};`);
    throw error;
  }
};

const cursor = (db: GameDatabase, key: string): string | undefined =>
  (db.prepare("SELECT value FROM world_progress_cursors WHERE key = ?").get(key) as { value: string } | undefined)?.value;

const setCursor = (db: GameDatabase, key: string, value: string): void => {
  db.prepare(
    `INSERT INTO world_progress_cursors (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
};

const previousMonth = (month: string): string => {
  const [year, calendarMonth] = month.split("-").map(Number) as [number, number];
  return calendarMonth === 1 ? `${year - 1}-12` : `${year}-${String(calendarMonth - 1).padStart(2, "0")}`;
};

const nextMonth = (month: string): string => {
  const [year, calendarMonth] = month.split("-").map(Number) as [number, number];
  return calendarMonth === 12 ? `${year + 1}-01` : `${year}-${String(calendarMonth + 1).padStart(2, "0")}`;
};

/** The latest month whose processing date (its 28th) is on or before the given world date. */
const latestDueMonth = (worldDate: string): string =>
  Number(worldDate.slice(8, 10)) >= 28 ? worldDate.slice(0, 7) : previousMonth(worldDate.slice(0, 7));

/* -------------------------------------------------------------------------- */
/* World catch-up: fixtures and months as time passes                          */
/* -------------------------------------------------------------------------- */

const MONTH_CURSOR = "world_month";
const SYSTEMS_CURSOR = "world_systems_ready";
const MAX_MONTHS_PER_CATCH_UP = 14;

export type WorldCatchUpOptions = {
  /** Teams a human coaches right now: the world leaves their fixtures from today on to the human. */
  humanTeamIds?: readonly EntityId[];
  /** Teams of a club a human owns: treated the same way. */
  ownerTeamIds?: readonly EntityId[];
};

export type WorldCatchUpResult = {
  fixturesPlayed: number;
  monthsProcessed: string[];
  timingsMs: { systems: number; fixtures: number; months: number };
};

/**
 * Brings the world's systems into existence and materialises every
 * competition's schedule before officiating supply is first reconciled. It runs
 * once per save, before anything else moves the calendar.
 */
export const prepareWorldForPlay = (db: GameDatabase, save: SaveMetadata): void => worldSystemsReady(db, save);

const worldSystemsReady = (db: GameDatabase, save: SaveMetadata): void => {
  if (cursor(db, SYSTEMS_CURSOR)) return;
  inSavepoint(db, "world_systems", () => {
    ensureWorldSystems(db, {
      worldDate: save.worldDate,
      seed: save.randomSeed,
      economyEnabled: true,
      federationEnabled: true,
      internationalEnabled: true,
      youthEnabled: true,
      transfersEnabled: true,
    });
    // Every competition's schedule must exist before officiating supply is
    // reconciled, so supply sees the whole volume and peak matchday load.
    const seasons = runnableSeasons(db, undefined, []);
    for (const season of seasons) {
      ensureFixtures(db, { ...season, seed: `${save.randomSeed}:season:0:${season.season.id}` });
    }
    if (seasons[0]) {
      reconcileWorkforceSupply({
        db,
        date: seasons[0].ruleSet.seasonStartDate,
        seed: `${save.randomSeed}:workforce:0`,
        seasonLabel: seasons[0].ruleSet.seasonStartDate.slice(0, 4),
      });
    }
    setCursor(db, SYSTEMS_CURSOR, save.worldDate);
  });
};

/**
 * The clubs and federation a human runs, whatever role is active: the world's
 * AI planning and compliance routines leave these to the human.
 */
const humanScope = (db: GameDatabase, save: SaveMetadata): { clubIds: EntityId[]; federationIds: EntityId[] } => {
  const character = save.playerCharacterId ? new WorldRepository(db).getCareerCharacter(save.playerCharacterId) : undefined;
  const clubIds: EntityId[] = [];
  const federationIds: EntityId[] = [];
  if (!character) return { clubIds, federationIds };
  for (const role of heldCareerRoles(db, character.personId)) {
    if (!role.targetId) continue;
    if (role.role === "MANAGER") {
      const club = clubIdForTeam(db, role.targetId);
      if (club) clubIds.push(club);
    } else if (role.role === "CHAIRMAN_OWNER") clubIds.push(role.targetId);
    else if (role.role === "FEDERATION_PRESIDENT") federationIds.push(role.targetId);
  }
  return { clubIds: [...new Set(clubIds)], federationIds };
};

/**
 * Processes every unprocessed month up to `through` (or the latest month due at
 * the world date): club economy and federation, once each, in order. The
 * cursor only advances together with the month's own writes.
 */
export const processWorldMonths = (
  db: GameDatabase,
  save: SaveMetadata,
  through?: string,
): string[] => {
  const target = through ?? latestDueMonth(save.worldDate);
  const last = cursor(db, MONTH_CURSOR);
  if (last === undefined) {
    // A save's first tick starts from now on; the months before it belong to the past.
    setCursor(db, MONTH_CURSOR, latestDueMonth(save.worldDate));
    return [];
  }
  const processed: string[] = [];
  const scope = humanScope(db, save);
  let month = nextMonth(last);
  while (month <= target && processed.length < MAX_MONTHS_PER_CATCH_UP) {
    const current = month;
    inSavepoint(db, "world_month", () => {
      const seed = `${save.randomSeed}:month:${current}`;
      processEconomyMonthTick(db, save, { month: current, seed, protectedClubIds: scope.clubIds });
      processFederationMonthTick(db, { month: current, seed, protectedFederationIds: scope.federationIds });
      setCursor(db, MONTH_CURSOR, current);
    });
    processed.push(current);
    month = nextMonth(current);
  }
  return processed;
};

const fixtureIdsForTeams = (
  db: GameDatabase,
  teamIds: readonly EntityId[],
  fromDate?: string,
): Set<EntityId> => {
  const ids = new Set<EntityId>();
  for (const teamId of teamIds) {
    const rows = (
      fromDate
        ? db
            .prepare("SELECT id FROM fixtures WHERE (home_team_id = ? OR away_team_id = ?) AND scheduled_date >= ?")
            .all(teamId, teamId, fromDate)
        : db.prepare("SELECT id FROM fixtures WHERE home_team_id = ? OR away_team_id = ?").all(teamId, teamId)
    ) as Array<{ id: EntityId }>;
    for (const row of rows) ids.add(row.id);
  }
  return ids;
};

/**
 * Lets the world catch up to the save's world date, whoever the human is: every
 * fixture dated on or before today is played (the human's own excepted), and
 * each month that has come round is processed once.
 */
export const catchUpWorld = (
  db: GameDatabase,
  save: SaveMetadata,
  options: WorldCatchUpOptions = {},
): WorldCatchUpResult => {
  const timings = { systems: 0, fixtures: 0, months: 0 };
  let started = Date.now();
  worldSystemsReady(db, save);
  timings.systems = Date.now() - started;

  started = Date.now();
  const skipped: Parameters<typeof runnableSeasons>[2] = [];
  const playedBefore = (db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'").get() as { n: number }).n;
  const exclude = new Set<EntityId>([
    // A human's own fixtures dated today or later stay with the human; one that
    // has slipped into the past is played by the world so the season can finish.
    ...fixtureIdsForTeams(db, [...(options.humanTeamIds ?? []), ...(options.ownerTeamIds ?? [])], save.worldDate),
  ]);
  const horizon = addDays(save.worldDate, 60);
  for (const season of runnableSeasons(db, undefined, skipped)) {
    if (season.season.startDate > horizon) continue;
    inSavepoint(db, "world_fixtures", () => {
      simulateCompetitionSeason(db, {
        ...season,
        seed: `${save.randomSeed}:world:${season.season.id}`,
        save,
        economyEnabled: true,
        untilDate: save.worldDate,
        excludeFixtureIds: exclude,
        incremental: true,
      });
    });
  }
  const playedAfter = (db.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status = 'played'").get() as { n: number }).n;
  timings.fixtures = Date.now() - started;

  started = Date.now();
  const monthsProcessed = processWorldMonths(db, save);
  timings.months = Date.now() - started;
  return { fixturesPlayed: playedAfter - playedBefore, monthsProcessed, timingsMs: timings };
};

/* -------------------------------------------------------------------------- */
/* Season status                                                               */
/* -------------------------------------------------------------------------- */

type CycleSeason = { id: EntityId; name: string; endDate: string; status: string };

/**
 * The seasons still to be closed: every competition season the world runs (it
 * has a lifecycle state, fixtures and a rule set) that is not yet rolled over.
 * Competitions that run their own lifecycle, such as the territorial
 * championships, have no lifecycle state here and never hold a season open.
 */
const cycleSeasons = (db: GameDatabase): CycleSeason[] =>
  (
    db
      .prepare(
        `SELECT cs.id AS id, cs.name AS name, cs.end_date AS endDate, s.status AS status
         FROM competition_seasons cs
         JOIN competition_season_states s ON s.competition_season_id = cs.id
         WHERE s.status != 'ROLLED_OVER'
           AND EXISTS (SELECT 1 FROM fixtures f WHERE f.competition_season_id = cs.id)
           AND EXISTS (SELECT 1 FROM competition_rules r WHERE r.competition_season_id = cs.id)
         ORDER BY cs.start_date, cs.id`,
      )
      .all() as CycleSeason[]
  );

const unplayedFixtureCount = (db: GameDatabase, seasonIds: readonly EntityId[]): number => {
  if (seasonIds.length === 0) return 0;
  const placeholders = seasonIds.map(() => "?").join(",");
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM fixtures WHERE competition_season_id IN (${placeholders}) AND status != 'played'`)
      .get(...seasonIds) as { n: number }
  ).n;
};

type TransitionRow = {
  id: EntityId;
  season_key: string;
  from_season_end_date: string;
  season_ids_json: string;
  status: "RUNNING" | "FAILED" | "COMPLETED";
  total_stages: number;
  completed_stages: number;
  current_stage: string | null;
  stage_timings_json: string;
  error_message: string | null;
};

const openTransition = (db: GameDatabase): TransitionRow | undefined =>
  db
    .prepare("SELECT * FROM season_transitions WHERE status IN ('RUNNING', 'FAILED') ORDER BY started_at DESC LIMIT 1")
    .get() as TransitionRow | undefined;

export type TransitionStageDefinition = {
  key: string;
  label: string;
  run: (context: TransitionContext) => void;
};

export type TransitionContext = {
  db: GameDatabase;
  save: SaveMetadata;
  seasonIds: EntityId[];
  seasonEndDate: string;
  seed: string;
};

const seasonsByIds = (db: GameDatabase, ids: readonly EntityId[]): RunnableSeason[] => {
  const world = new WorldRepository(db);
  const competitions = new CompetitionRepository(db);
  const result: RunnableSeason[] = [];
  for (const id of ids) {
    const season = world.getCompetitionSeason(id) as CompetitionSeason | undefined;
    const ruleSet = competitions.getRuleSet(id);
    if (!season || !ruleSet) continue;
    const name = (db.prepare("SELECT name FROM competitions WHERE id = ?").get(season.competitionId) as { name: string } | undefined)?.name ?? String(season.competitionId);
    result.push({ season, competitionName: name, ruleSet, teamIds: world.teamsForCompetitionSeason(id).map((team) => team.id) });
  }
  return result;
};

/**
 * The staged season transition, in dependency order. Each stage is atomic and
 * safe to run again if it did not finish; a stage that finished is never re-run.
 */
export const SEASON_TRANSITION_STAGES: TransitionStageDefinition[] = [
  {
    key: "close-competitions",
    label: "Closing the season's competitions",
    run: ({ db, save, seasonIds, seed }) => {
      for (const season of seasonsByIds(db, seasonIds)) {
        if (seasonState(db, season.season.id)?.status === "COMPLETED") continue;
        simulateCompetitionSeason(db, { ...season, seed, save, economyEnabled: true, incremental: true });
        if (seasonState(db, season.season.id)?.status !== "COMPLETED") {
          throw new Error(`${season.competitionName} still has fixtures to play.`);
        }
      }
    },
  },
  {
    key: "promotion-relegation",
    label: "Licensing, promotion and relegation",
    run: ({ db, seasonIds }) => {
      const seasons = seasonsByIds(db, seasonIds);
      const repo = new CompetitionRepository(db);
      const completed = seasons.map((item) => ({
        season: item.season,
        ruleSet: item.ruleSet,
        standings: repo.standings(item.season.id) as readonly LeagueStanding[],
      }));
      rolloverCompetitions(db, seasons, completed);
    },
  },
  {
    key: "transfers",
    label: "Transfer window",
    run: ({ db, seasonEndDate, seed }) => runTransferWindowStage(db, { seasonEndDate, seed }),
  },
  {
    key: "youth-retirement",
    label: "Youth intake and retirement",
    run: ({ db, seasonEndDate, seed }) => {
      runYouthStage(db, { seasonEndDate, seed });
    },
  },
  {
    key: "monthly-processing",
    label: "Club and federation months",
    run: ({ db, save, seasonEndDate }) => {
      // Every month of the season period is processed exactly once, whether live or here.
      while (processWorldMonths(db, save, `${seasonEndDate.slice(0, 4)}-${seasonEndMonth(db)}`).length > 0) {
        // keep going until the cursor reaches July
      }
    },
  },
  {
    key: "club-finance",
    label: "Club finances and ownership",
    run: ({ db, seasonEndDate, seed }) => closeEconomySeasonPeriod(db, { seasonEndDate, seed }),
  },
  {
    key: "federation",
    label: "Federation season close",
    run: ({ db, seasonEndDate }) => closeFederationSeasonPeriod(db, { seasonEndDate }),
  },
  {
    key: "international",
    label: "International competitions",
    run: ({ db, seasonEndDate, seed }) => processInternationalForSeasonPeriod(db, { seasonEndDate, seed }),
  },
  {
    key: "external-world",
    label: "The wider football world",
    run: ({ db, seasonEndDate, seed }) => processCareerExternalWorldSeason({ db, seasonEndDate, seed }),
  },
  {
    key: "next-season",
    label: "Creating the next season",
    run: ({ db, save, seasonIds, seasonEndDate, seed }) => {
      const old = seasonsByIds(db, seasonIds);
      const nextSeasons = new Map<EntityId, EntityId>();
      for (const item of old) {
        const nextStart = addYear(item.ruleSet.seasonStartDate);
        nextSeasons.set(item.season.competitionId, createStableEntityId("competition-season", `${item.season.competitionId}:${nextStart}`));
      }
      runTerritorialAndPreseasonStage(db, {
        seasonEndDate,
        territorialSeed: `${seed}:territorial`,
        preseasonSeed: `${seed}:preseason`,
        nextSeasonIds: [...nextSeasons.values()],
      });
      const next = runnableSeasons(db, undefined, []).filter((season) => [...nextSeasons.values()].includes(season.season.id));
      for (const season of next) {
        simulateCompetitionSeason(db, {
          ...season,
          seed: `${seed}:next:${season.season.id}`,
          save,
          economyEnabled: true,
          untilDate: "0000-00-00",
          incremental: true,
        });
      }
      if (next.length > 0) {
        reconcileWorkforceSupply({
          db,
          date: next[0]!.ruleSet.seasonStartDate,
          seed: `${seed}:workforce`,
          seasonLabel: next[0]!.ruleSet.seasonStartDate.slice(0, 4),
        });
      }
    },
  },
  {
    key: "storage",
    label: "Tidying older match detail",
    run: ({ db, seasonEndDate }) => {
      compactOldMatchEvents(db, seasonEndDate);
      compactResolvedInterviews(db, seasonEndDate);
    },
  },
  {
    key: "finalize",
    label: "Starting the new season",
    run: ({ db, save, seasonEndDate }) => {
      repairHumanLineup(db, save);
      if (seasonEndDate > save.worldDate) updateSaveWorldDate(db, save, seasonEndDate);
    },
  },
];

/**
 * A season turns players over: contracts end, players leave or retire. If the
 * human manager's saved selection now names players who are no longer in the
 * squad, the assistant re-picks it (through the same tactical builder every
 * club uses) and says so, so the first match of the new season can be played.
 * A selection that is still valid is left exactly as the manager set it.
 */
const repairHumanLineup = (db: GameDatabase, save: SaveMetadata): void => {
  if (!save.playerCharacterId) return;
  const character = new WorldRepository(db).getCareerCharacter(save.playerCharacterId);
  if (!character) return;
  const managers = new ManagerRepository(db);
  const profile = managers.getProfileByPerson(character.personId);
  const teamId = profile ? managers.activeContract(profile.id)?.teamId : undefined;
  if (!profile || !teamId) return;
  const setup = managers.tacticalSetups(teamId)[0];
  if (!setup) return;
  const players = new PlayerRepository(db).attributesForTeam(teamId);
  if (validateSelection({ setup, players, benchLimit: 7 }).isValid) return;
  const rebuilt = buildAiTacticalSetup(teamId, players, { managerProfileId: profile.id, manager: profile });
  managers.insertTacticalSetup({
    ...rebuilt,
    id: setup.id,
    name: setup.name,
    familiarity: familiarityAfterTacticChange(setup, rebuilt),
  });
  managers.insertInboxItem({
    id: createStableEntityId("inbox", `lineup-repaired:${teamId}:${save.worldDate}`),
    createdOn: save.worldDate,
    type: "COMPETITION_UPDATE",
    title: "Your lineup has been updated",
    body: "Players from last season's selection have left the squad, so your assistant has picked a new lineup. Review it on the Tactics screen.",
    read: false,
  });
};

const addYear = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
  return parsed.toISOString().slice(0, 10);
};

const stageViews = (row: TransitionRow | undefined): SeasonStatusView["stages"] => {
  const timings = row ? (JSON.parse(row.stage_timings_json) as Array<{ key: string; ms: number }>) : [];
  return SEASON_TRANSITION_STAGES.map((stage, index) => {
    const done = row ? index < row.completed_stages : false;
    const state: SeasonStatusView["stages"][number]["state"] = done
      ? "DONE"
      : row && index === row.completed_stages
        ? row.status === "FAILED"
          ? "FAILED"
          : "CURRENT"
        : "PENDING";
    return { key: stage.key, label: stage.label, state, durationMs: timings.find((entry) => entry.key === stage.key)?.ms };
  });
};

const summaryFor = (db: GameDatabase, seasons: readonly CycleSeason[], humanTeamId?: EntityId): SeasonStatusView["summary"] => {
  const pick = (humanTeamId && seasons.find((season) => (db.prepare("SELECT 1 FROM league_standings WHERE competition_season_id = ? AND team_id = ?").get(season.id, humanTeamId)))) || seasons[0];
  if (!pick) return undefined;
  const standings = new CompetitionRepository(db).standings(pick.id);
  const teamName = (teamId: EntityId): string | undefined =>
    (db.prepare("SELECT COALESCE(c.name, t.name) AS name FROM teams t LEFT JOIN clubs c ON c.id = t.club_id WHERE t.id = ?").get(teamId) as { name?: string } | undefined)?.name;
  const winner = db.prepare("SELECT team_id AS teamId FROM competition_winners WHERE competition_season_id = ?").get(pick.id) as { teamId?: EntityId } | undefined;
  const humanIndex = humanTeamId ? standings.findIndex((row) => row.teamId === humanTeamId) : -1;
  return {
    competition: pick.name,
    champion: winner?.teamId ? teamName(winner.teamId) : undefined,
    humanClubPosition: humanIndex >= 0 ? humanIndex + 1 : undefined,
    humanClub: humanIndex >= 0 && humanTeamId ? teamName(humanTeamId) : undefined,
    teams: standings.length,
  };
};

/** Where the season stands: in progress, complete and waiting for its transition, or mid-transition. */
export const getSeasonStatus = (db: GameDatabase, humanTeamId?: EntityId): SeasonStatusView => {
  const open = openTransition(db);
  if (open) {
    const ids = JSON.parse(open.season_ids_json) as EntityId[];
    const stage = SEASON_TRANSITION_STAGES[open.completed_stages];
    return {
      phase: open.status === "FAILED" ? "TRANSITION_FAILED" : "TRANSITIONING",
      seasonEndDate: open.from_season_end_date,
      competitions: { total: ids.length, completed: ids.length },
      transition: {
        status: open.status === "FAILED" ? "FAILED" : "RUNNING",
        completedStages: open.completed_stages,
        totalStages: open.total_stages,
        currentStageKey: stage?.key,
        currentStageLabel: stage?.label,
        error: open.error_message ?? undefined,
      },
      stages: stageViews(open),
    };
  }
  const seasons = cycleSeasons(db);
  const completed = seasons.filter((season) => season.status === "COMPLETED").length;
  const unplayed = unplayedFixtureCount(db, seasons.map((season) => season.id));
  const complete = seasons.length > 0 && completed === seasons.length && unplayed === 0;
  const endDate = seasons.map((season) => season.endDate).sort().at(-1);
  return {
    phase: complete ? "COMPLETE" : "IN_PROGRESS",
    seasonName: seasons[0]?.name,
    seasonEndDate: endDate,
    competitions: { total: seasons.length, completed },
    stages: stageViews(undefined),
    summary: complete ? summaryFor(db, seasons, humanTeamId) : undefined,
  };
};

/**
 * One step of world time for a human whose own fixtures are done: on to the next
 * unplayed fixture in the season (at most `maxDays`), so the rest of the league
 * can finish.
 */
export const worldOnlyStep = (
  db: GameDatabase,
  worldDate: string,
  maxDays = 14,
): { worldDate: string; daysAdvanced: number } => {
  const ids = cycleSeasons(db).map((season) => season.id);
  let step = maxDays;
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const next = db
      .prepare(
        `SELECT MIN(scheduled_date) AS d FROM fixtures
         WHERE competition_season_id IN (${placeholders}) AND status != 'played' AND scheduled_date > ?`,
      )
      .get(...ids, worldDate) as { d: string | null };
    if (next.d) {
      const days = Math.round((Date.parse(`${next.d}T00:00:00Z`) - Date.parse(`${worldDate}T00:00:00Z`)) / 86_400_000);
      step = Math.max(1, Math.min(maxDays, days));
    }
  }
  return { worldDate: addDays(worldDate, step), daysAdvanced: step };
};

/* -------------------------------------------------------------------------- */
/* Season transition                                                           */
/* -------------------------------------------------------------------------- */

export class SeasonTransitionError extends Error {
  constructor(
    readonly code: "SEASON_NOT_COMPLETE" | "TRANSITION_FAILED",
    message: string,
  ) {
    super(message);
  }
}

/** Starts the transition for a completed season, or returns the one already in progress. Never starts one early or twice. */
const beginTransition = (db: GameDatabase, save: SaveMetadata): TransitionRow => {
  const existing = openTransition(db);
  if (existing) return existing;
  const status = getSeasonStatus(db);
  if (status.phase !== "COMPLETE") {
    throw new SeasonTransitionError("SEASON_NOT_COMPLETE", "The season is not complete yet.");
  }
  const seasons = cycleSeasons(db);
  const ids = seasons.map((season) => season.id);
  const seasonEndDate = latestSeasonEnd(seasonsByIds(db, ids));
  const key = createStableEntityId("season-transition", ids.join("|"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO season_transitions
     (id, season_key, from_season_end_date, season_ids_json, status, total_stages, completed_stages, started_at, updated_at)
     VALUES (?, ?, ?, ?, 'RUNNING', ?, 0, ?, ?)`,
  ).run(key, key, seasonEndDate, JSON.stringify(ids), SEASON_TRANSITION_STAGES.length, now, now);
  void save;
  return openTransition(db)!;
};

export type SeasonTransitionProgress = { status: SeasonStatusView; finished: boolean };

/**
 * Runs the next stage of the season transition (starting it if the season is
 * complete). One stage per call keeps every call short and lets the caller show
 * progress between stages. A failed stage is rolled back and reported; calling
 * again retries that same stage.
 */
export const advanceSeasonTransition = (db: GameDatabase, save: SaveMetadata): SeasonTransitionProgress => {
  const row = beginTransition(db, save);
  const stage = SEASON_TRANSITION_STAGES[row.completed_stages];
  if (!stage) {
    db.prepare("UPDATE season_transitions SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      new Date().toISOString(),
      row.id,
    );
    return { status: getSeasonStatus(db), finished: true };
  }
  const ids = JSON.parse(row.season_ids_json) as EntityId[];
  const startedAt = Date.now();
  try {
    inSavepoint(db, "season_stage", () => {
      stage.run({
        db,
        save,
        seasonIds: ids,
        seasonEndDate: row.from_season_end_date,
        seed: `${save.randomSeed}:transition:${row.from_season_end_date}:${stage.key}`,
      });
      const timings = JSON.parse(row.stage_timings_json) as Array<{ key: string; ms: number }>;
      timings.push({ key: stage.key, ms: Date.now() - startedAt });
      const finishing = row.completed_stages + 1 >= row.total_stages;
      db.prepare(
        `UPDATE season_transitions
         SET completed_stages = ?, current_stage = ?, stage_timings_json = ?, status = ?, error_message = NULL,
             updated_at = ?, completed_at = ?
         WHERE id = ?`,
      ).run(
        row.completed_stages + 1,
        SEASON_TRANSITION_STAGES[row.completed_stages + 1]?.key ?? null,
        JSON.stringify(timings),
        finishing ? "COMPLETED" : "RUNNING",
        new Date().toISOString(),
        finishing ? new Date().toISOString() : null,
        row.id,
      );
    });
  } catch (error) {
    db.prepare("UPDATE season_transitions SET status = 'FAILED', error_message = ?, updated_at = ? WHERE id = ?").run(
      error instanceof Error ? error.message : String(error),
      new Date().toISOString(),
      row.id,
    );
    return { status: getSeasonStatus(db), finished: false };
  }
  const after = openTransition(db);
  return { status: getSeasonStatus(db), finished: !after };
};

/** Runs a complete transition (used by tests and tools): one stage at a time until it finishes or a stage fails. */
export const runSeasonTransitionToEnd = (
  db: GameDatabase,
  save: SaveMetadata,
  onStage?: (status: SeasonStatusView) => void,
): SeasonStatusView => {
  for (;;) {
    const current = { ...save, worldDate: (db.prepare("SELECT world_date AS d FROM saves LIMIT 1").get() as { d: string }).d };
    const step = advanceSeasonTransition(db, current);
    onStage?.(step.status);
    if (step.finished || step.status.phase === "TRANSITION_FAILED") return step.status;
  }
};

export { markSeasonState };
