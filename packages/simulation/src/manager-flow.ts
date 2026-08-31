import {
  createEntityId,
  type CompetitionRuleSet,
  type EntityId,
  type FixtureRecord,
  type InboxItem,
  type LeagueStanding,
  type MatchResult,
  type PlayerAttributeSet,
  type QuickSimResult,
  type SaveMetadata,
  type TacticalSetup,
} from "@nepal-football-sim/shared-types";
import {
  CompetitionRepository,
  ManagerRepository,
  PlayerRepository,
  SaveRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import { simulateMatch } from "./match-engine.js";
import { settleFederationInjuryWelfare, settleMatchInjuryInsurance } from "./insurance.js";
import { calculateStandings, summarizePlayerStats, summarizeTeamStats } from "./standings.js";
import { analyzeTacticalShape, validateSelection } from "./tactics.js";

export type QuickSimInput = {
  fixture: FixtureRecord;
  competitionTeamIds: readonly EntityId[];
  ruleSet: CompetitionRuleSet;
  homePlayers: readonly PlayerAttributeSet[];
  awayPlayers: readonly PlayerAttributeSet[];
  homeTacticalSetup?: TacticalSetup;
  awayTacticalSetup?: TacticalSetup;
  seed: string;
  save?: SaveMetadata;
};

export const quickSimManagerMatch = (input: QuickSimInput): QuickSimResult => {
  const managedSetup =
    input.homeTacticalSetup?.teamId === input.fixture.homeTeamId
      ? input.homeTacticalSetup
      : input.awayTacticalSetup;
  const managedPlayers =
    managedSetup?.teamId === input.fixture.homeTeamId ? input.homePlayers : input.awayPlayers;
  const validation = managedSetup
    ? validateSelection({ setup: managedSetup, players: managedPlayers ?? [], benchLimit: 7 })
    : { isValid: true, blockingErrors: [], warnings: [] };
  if (!validation.isValid) {
    throw new Error(`Cannot quick sim: ${validation.blockingErrors.join(" ")}`);
  }
  const result = simulateMatch({
    fixture: input.fixture,
    homePlayers: input.homePlayers,
    awayPlayers: input.awayPlayers,
    homeTacticalSetup: input.homeTacticalSetup,
    awayTacticalSetup: input.awayTacticalSetup,
    seed: input.seed,
  });
  const standings = calculateStandings({
    competitionSeasonId: input.fixture.competitionSeasonId!,
    teamIds: input.competitionTeamIds,
    ruleSet: input.ruleSet,
    results: [result],
  });
  const inboxItems = createMatchInboxItems(input.fixture, result);
  return {
    result,
    standings,
    inboxItems,
    tacticalShape: managedSetup
      ? analyzeTacticalShape(managedSetup.formation)
      : {
          width: 0,
          centralDensity: 0,
          defensiveCoverage: 0,
          midfieldControl: 0,
          attackingNumbers: 0,
          restDefense: 0,
          pressingStructure: 0,
          warnings: [],
        },
    validation,
  };
};

export const persistQuickSimResult = (
  db: GameDatabase,
  input: QuickSimInput,
  output: QuickSimResult,
): void => {
  const competition = new CompetitionRepository(db);
  const managers = new ManagerRepository(db);
  const players = new PlayerRepository(db);
  competition.insertMatch(output.result.match);
  competition.markFixturePlayed(output.result.match.fixtureId);
  for (const event of output.result.events) {
    competition.insertMatchEvent(event);
  }
  for (const standing of output.standings) {
    competition.upsertStanding(standing);
  }
  for (const stat of summarizeTeamStats(input.fixture.competitionSeasonId!, output.standings)) {
    competition.upsertTeamSeasonStat(stat);
  }
  for (const stat of summarizePlayerStats(input.fixture.competitionSeasonId!, [output.result])) {
    competition.upsertPlayerSeasonStat(stat);
  }
  for (const item of output.inboxItems) {
    managers.insertInboxItem(item);
  }
  for (const state of output.result.playerStates) {
    players.upsertAvailabilityState({
      personId: state.personId,
      teamId: state.teamId,
      fitness: state.currentFitness,
      moraleModifier: state.moraleModifier,
      formModifier: state.formModifier,
      availability: state.injuryDuringMatch ? "INJURED" : state.redCard ? "SUSPENDED" : "AVAILABLE",
      updatedOn: output.result.match.playedDate ?? input.fixture.scheduledDate,
    });
    if (state.injuryDuringMatch) {
      players.insertInjury(state.injuryDuringMatch);
      const clubId = (db.prepare("SELECT club_id AS clubId FROM teams WHERE id = ?").get(state.teamId) as { clubId?: EntityId } | undefined)?.clubId;
      if (clubId) {
        const insuranceClaim = settleMatchInjuryInsurance(db, { clubId, injury: state.injuryDuringMatch, date: state.injuryDuringMatch.dateOccurred });
        settleFederationInjuryWelfare(db, { clubId, injury: state.injuryDuringMatch, date: state.injuryDuringMatch.dateOccurred, insuranceClaim });
      }
    }
  }
  if (input.save) {
    new SaveRepository(db).upsert({
      ...input.save,
      worldDate: nextDay(input.fixture.scheduledDate),
      lastSavedAt: new Date().toISOString(),
    });
  }
};

export const nextFixtureForTeam = (
  fixtures: readonly FixtureRecord[],
  teamId: EntityId,
  worldDate: string,
): FixtureRecord | undefined =>
  fixtures.find(
    (fixture) =>
      fixture.status === "scheduled" &&
      fixture.scheduledDate >= worldDate &&
      (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId),
  );

/**
 * A manager's unresolved fixture on or before today is a hard stop. Keeping
 * this separate from nextFixtureForTeam makes the Continue and match-command
 * gates use the same definition without changing future scheduling queries.
 */
export const userMatchRequiresAction = (
  fixtures: readonly FixtureRecord[],
  teamId: EntityId,
  worldDate: string,
): FixtureRecord | undefined =>
  fixtures.find(
    (fixture) =>
      fixture.status === "scheduled" &&
      fixture.scheduledDate <= worldDate &&
      (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId),
  );

export const continueToNextFixtureDate = (
  save: SaveMetadata,
  fixtures: readonly FixtureRecord[],
  teamId: EntityId,
): SaveMetadata => {
  const next = nextFixtureForTeam(fixtures, teamId, save.worldDate);
  return next
    ? { ...save, worldDate: next.scheduledDate, lastSavedAt: new Date().toISOString() }
    : save;
};

export const tableMovementSummary = (
  standings: readonly LeagueStanding[],
  teamId: EntityId,
): string => {
  const index = standings.findIndex((standing) => standing.teamId === teamId);
  return index >= 0 ? `${index + 1}${ordinal(index + 1)}` : "unranked";
};

const createMatchInboxItems = (fixture: FixtureRecord, result: MatchResult): InboxItem[] => {
  const score = `${result.match.homeGoals ?? 0}-${result.match.awayGoals ?? 0}`;
  const injuries = result.events.filter((event) => event.type === "INJURY");
  const redCards = result.events.filter((event) => event.type === "RED_CARD");
  return [
    {
      id: createEntityId(),
      createdOn: result.match.playedDate ?? fixture.scheduledDate,
      type: "MATCH_RESULT",
      title: `Match result: ${score}`,
      body: `Quick sim completed with ${result.homeStats.shots}-${result.awayStats.shots} shots and ${result.homeStats.xg}-${result.awayStats.xg} xG.`,
      relatedEntity: { type: "match", id: result.match.id },
      read: false,
    },
    ...injuries.map((injury) => ({
      id: createEntityId(),
      createdOn: result.match.playedDate ?? fixture.scheduledDate,
      type: "INJURY" as const,
      title: "Player injury",
      body: `A player suffered ${String(injury.data?.injuryType ?? "a match injury")}.`,
      relatedEntity: injury.primaryPersonId
        ? ({ type: "person" as const, id: injury.primaryPersonId } as const)
        : undefined,
      read: false,
    })),
    ...redCards.map((card) => ({
      id: createEntityId(),
      createdOn: result.match.playedDate ?? fixture.scheduledDate,
      type: "SUSPENSION" as const,
      title: "Red card suspension pending",
      body: "A player was sent off and should be reviewed for suspension handling.",
      relatedEntity: card.primaryPersonId
        ? ({ type: "person" as const, id: card.primaryPersonId } as const)
        : undefined,
      read: false,
    })),
  ];
};

const nextDay = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
};

const ordinal = (value: number): string => {
  if (value >= 11 && value <= 13) return "th";
  return value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
};
