import {
  createStableEntityId,
  type CompetitionRuleSet,
  type CompetitionSeason,
  type EntityId,
  type FixtureRecord,
  type LeagueStanding,
  type MatchResult,
  type PlayerAttributeSet,
  type PlayerSeasonStat,
  type SaveMetadata,
  type TeamSeasonStat,
} from "@nepal-football-sim/shared-types";
import {
  CompetitionRepository,
  PlayerRepository,
  SupporterCultureRepository,
  FootballHistoryRepository,
  WorldRepository,
  loadSave,
  updateSaveWorldDate,
  type GameDatabase,
} from "@nepal-football-sim/database";
import {
  closeClubFinancialSeason,
  initializeClubEconomyForSave,
  postCompetitionPrizeMoney,
  acceptCompetitionMediaRights,
  generateCompetitionMediaRightsOffer,
  postMatchdayEconomy,
  processClubEconomyMonth,
} from "./club-economy.js";
import { generateLeagueFixtures } from "./fixture-generation.js";
import {
  closeFederationFinancialSeason,
  initializeFederationGovernanceForSave,
  processFederationMonth,
} from "./federation-governance.js";
import {
  initializeFederationComplianceForSave,
  runFederationComplianceAiForAllFederations,
} from "./federation-compliance.js";
import {
  initializeInternationalFootballForSave,
  processInternationalForSeasonPeriod,
} from "./international-football.js";
import { simulateMatch } from "./match-engine.js";
import { requireFixtureOfficials } from "./referee-assignment.js";
import {
  repairPreseasonContinuity,
  type PreseasonContinuityReport,
} from "./preseason-continuity.js";
import { updatePlayerDevelopment } from "./player-development.js";
import {
  computeDevelopmentEnvironment,
  ensureSensibleDevelopmentPlan,
  trainingAvailabilityFor,
} from "./player-development-plans.js";
import { progressPyramidSeason, persistPyramidProgression } from "./pyramid-progression.js";
import {
  initializeRecruitmentForSave,
  recordMatchObservation,
  simulateScoutingDay,
} from "./scouting.js";
import { calculateStandings, sortStandings, summarizePlayerStats } from "./standings.js";
import { initializeTransferMarketForSave, simulateTransferWindow } from "./transfer-market.js";
import { runClubAiSeasonPlanning } from "./ai-club-strategy.js";
import { ensureAiStaffAssigned, evaluateAllStaffContracts } from "./staff-market.js";
import { settleFederationInjuryWelfare, settleMatchInjuryInsurance } from "./insurance.js";
import { processInternationalTrials } from "./international-trials.js";
import { processExternalFootballWorldSeason } from "./external-football-world.js";
import { proposeAnnualGovernmentFunding } from "./government.js";
import { settleFederationMediaRightsForCompetition } from "./media-rights.js";
import { settleApprovedCompetitionDistributions } from "./competition-distribution.js";
import {
  initializeForeignFootballWorldForSave,
  processForeignFootballWorldSeason,
} from "./foreign-football-world.js";
import {
  initializeYouthSystemForSave,
  runAnnualYouthAndRetirementCycle,
  type YouthAnnualReport,
} from "./youth-intake.js";
import { ensureWomensFootballWorldForSave } from "./womens-youth.js";
import { completeYouthDevelopmentPartnerships, planYouthDevelopmentPartnerships } from "./youth-partnerships.js";
import {
  reconcileWorkforceSupply,
  type WorkforceReconciliationReport,
} from "./workforce-supply.js";
import { processOwnershipContinuity } from "./ownership.js";
import { ensureFederationLeadershipContinuity } from "./federation-politics.js";
import { advanceMacroEconomyForWorldDate } from "./macro-economy.js";
import { recordCompetitionSeasonHistory, recordFootballMatchHistory } from "./football-history.js";
import { processClubLicensingForSeason } from "./licensing.js";
import { advanceTerritorialDevelopment } from "./territorial-football.js";
import {
  evolveSupporterCultureSeason,
  initializeSupporterCultureForSave,
} from "./supporter-culture.js";

export type CompetitionSeasonLifecycleStatus =
  | "NOT_STARTED"
  | "READY"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ROLLED_OVER"
  | "INVALID_MEMBERSHIP"
  | "SUSPENDED";

export type CareerSeasonReport = {
  seasonId: EntityId;
  seasonName: string;
  competitionName: string;
  status: "played" | "skipped";
  skipReason?: string;
  fixturesGenerated: number;
  matchesPlayed: number;
  goals: number;
  goalsPerMatch: number;
  homeWinPercentage: number;
  drawPercentage: number;
  awayWinPercentage: number;
  averageShots: number;
  averageXg: number;
  cards: number;
  injuries: number;
  championTeamId?: EntityId;
  championClubId?: EntityId;
  topScorer?: PlayerAwardReport;
  mostAssists?: PlayerAwardReport;
  bestGoalkeeper?: PlayerAwardReport;
  playerOfSeason?: PlayerAwardReport;
  pointsSpread: number;
  playerAppearances: number;
  developedPlayers: number;
  promotions: number;
  relegations: number;
  squadHealth: SquadHealthReport;
};

export type PlayerAwardReport = {
  personId: EntityId;
  teamId: EntityId;
  value: number;
};

export type SquadHealthReport = {
  clubsWithValidXi: number;
  clubsWithValidBench: number;
  emergencyLineupCases: number;
  playersUnavailable: number;
  clubsWithPositionShortages: number;
};

export type CareerSimulationReport = {
  savePath?: string;
  worldDate: string;
  seasonsRequested: number;
  seasons: CareerSeasonReport[];
  youthReports: YouthAnnualReport[];
  workforceReports: WorkforceReconciliationReport[];
  preseasonReports: PreseasonContinuityReport[];
  runnableCompetitions: string[];
  skippedCompetitions: SkippedCompetitionReport[];
};

export type SkippedCompetitionReport = {
  seasonId: EntityId;
  seasonName: string;
  competitionName: string;
  reason: string;
  membershipTeams: number;
  playableTeams: number;
  minimumRequiredTeams: number;
  clubsBelowMinimumSquad: number;
  clubsWithoutGoalkeeper: number;
};

type RunnableSeason = {
  season: CompetitionSeason;
  competitionName: string;
  ruleSet: CompetitionRuleSet;
  teamIds: EntityId[];
};

/**
 * The canonical external-world phase used by the career season rollover.
 * Keeping this tiny seam explicit lets production-flow tests exercise the
 * real caller boundary without simulating a full Nepal season.
 */
export const processCareerExternalWorldSeason = (input: {
  db: GameDatabase;
  seasonEndDate: string;
  seed: string;
}): void => {
  processForeignFootballWorldSeason(input);
};

const entityCache = new WeakMap<GameDatabase, { persons: Set<EntityId>; teams: Set<EntityId> }>();

export const simulateNepalCareer = (input: {
  db: GameDatabase;
  seasons: number;
  seed: string;
  competitionSeasonId?: EntityId;
  savePath?: string;
  maxFixturesPerSeason?: number;
  transfersEnabled?: boolean;
  youthEnabled?: boolean;
  economyEnabled?: boolean;
  federationEnabled?: boolean;
  internationalEnabled?: boolean;
}): CareerSimulationReport => {
  const save = loadSave(input.db);
  const reports: CareerSeasonReport[] = [];
  const youthReports: YouthAnnualReport[] = [];
  const workforceReports: WorkforceReconciliationReport[] = [];
  const preseasonReports: PreseasonContinuityReport[] = [];
  const skippedCompetitions: CareerSimulationReport["skippedCompetitions"] = [];
  const economyEnabled = input.economyEnabled !== false;
  const federationEnabled = input.federationEnabled !== false;
  const internationalEnabled = input.internationalEnabled !== false;

  ensureRecruitmentFoundation(input.db, save.worldDate, input.seed);
  if (federationEnabled) {
    initializeFederationGovernanceForSave({
      db: input.db,
      worldDate: save.worldDate,
      seed: input.seed,
    });
    initializeFederationComplianceForSave(input.db, save.worldDate);
  }
  if (internationalEnabled) {
    initializeInternationalFootballForSave({
      db: input.db,
      worldDate: save.worldDate,
      seed: input.seed,
    });
  }
  // An applied global dataset is the authoritative external world for this
  // save. Legacy saves without the marker retain the generated 11-market
  // bootstrap for backwards compatibility.
  const hasAppliedGlobalDataset = Boolean(
    (input.db.prepare("SELECT 1 FROM global_dataset_imports WHERE status = 'ACTIVE' LIMIT 1").get() as { 1?: number } | undefined),
  );
  if (!hasAppliedGlobalDataset) {
    initializeForeignFootballWorldForSave({
      db: input.db,
      worldDate: save.worldDate,
      seed: `${input.seed}:foreign-world`,
    });
  }
  if (economyEnabled) {
    advanceMacroEconomyForWorldDate(input.db, { date: save.worldDate, seed: input.seed });
    initializeClubEconomyForSave({ db: input.db, worldDate: save.worldDate, seed: input.seed });
    initializeSupporterCultureForSave({
      db: input.db,
      worldDate: save.worldDate,
      seed: input.seed,
    });
  }
  if (input.youthEnabled) {
    initializeYouthSystemForSave({ db: input.db, worldDate: save.worldDate, seed: input.seed });
  }
  if (input.transfersEnabled) {
    initializeTransferMarketForSave({ db: input.db, worldDate: save.worldDate, seed: input.seed });
  }
  ensureWomensFootballWorldForSave(input.db, { worldDate: save.worldDate });
  preseasonReports.push(
    ...repairPreseasonContinuity({
      db: input.db,
      competitionSeasonIds: pendingCompetitionSeasonIds(input.db, input.competitionSeasonId),
      date: save.worldDate,
      seed: `${input.seed}:preseason:initial`,
    }),
  );

  let activeSeasons = runnableSeasons(input.db, input.competitionSeasonId, skippedCompetitions);
  const runnableCompetitions = [...new Set(activeSeasons.map((season) => season.competitionName))];

  for (let index = 0; index < input.seasons; index += 1) {
    if (activeSeasons.length === 0) {
      break;
    }
    /* Materialize the known season schedules before officiating reconciliation
     * so supply sees both total volume and peak matchday concurrency. */
    for (const season of activeSeasons) {
      ensureFixtures(input.db, {
        ...season,
        seed: `${input.seed}:season:${index}:${season.season.id}`,
      });
    }
    workforceReports.push(
      reconcileWorkforceSupply({
        db: input.db,
        date: activeSeasons[0]!.ruleSet.seasonStartDate,
        seed: `${input.seed}:workforce:${index}`,
        seasonLabel: activeSeasons[0]!.ruleSet.seasonStartDate.slice(0, 4),
      }),
    );
    entityCache.delete(input.db);
    const completed: Array<{
      season: CompetitionSeason;
      ruleSet: CompetitionRuleSet;
      standings: readonly LeagueStanding[];
    }> = [];

    for (const season of activeSeasons) {
      const report = simulateCompetitionSeason(input.db, {
        ...season,
        seed: `${input.seed}:season:${index}:${season.season.id}`,
        maxFixtures: input.maxFixturesPerSeason,
        economyEnabled,
      });
      reports.push(report);
      const standings = new CompetitionRepository(input.db).standings(season.season.id);
      if (standings.length > 0 && report.matchesPlayed === report.fixturesGenerated) {
        completed.push({ season: season.season, ruleSet: season.ruleSet, standings });
      }
    }

    if (completed.length !== activeSeasons.length) {
      break;
    }

    const nextSeasons = createNextSeasons(input.db, activeSeasons);
    const licensingEligible = new Set<EntityId>();
    for (const item of completed) {
      const licensing = processClubLicensingForSeason(input.db, {
        competitionSeasonId: item.season.id,
        date: item.season.endDate,
        seasonLabel: item.season.startDate.slice(0, 4),
      });
      for (const clubId of licensing.eligibleClubIds) licensingEligible.add(clubId);
    }
    const movementCounts = applyProgression(input.db, activeSeasons, completed, nextSeasons, licensingEligible);
    const movements = completed.flatMap((item) =>
      new CompetitionRepository(input.db)
        .movements(item.season.id)
        .filter((movement) => movement.status === "APPLIED"),
    );
    for (const item of completed) {
      const standings = item.standings;
      for (const [position, standing] of standings.entries()) {
        const clubId = clubIdForTeam(input.db, standing.teamId);
        if (!clubId) continue;
        const movement = movements.find(
          (candidate) =>
            candidate.fromCompetitionSeasonId === item.season.id && candidate.clubId === clubId,
        );
        const profile = new SupporterCultureRepository(input.db).profile(clubId, "men");
        if (!profile) continue;
        evolveSupporterCultureSeason(input.db, clubId, {
          date: item.season.endDate,
          tier: profile.tier,
          finishShare: position / Math.max(1, standings.length - 1),
          promoted: movement?.movementType === "PROMOTION",
          relegated: movement?.movementType === "RELEGATION",
          trophies: standing.teamId === item.standings[0]?.teamId ? 1 : 0,
        });
      }
    }
    for (const report of reports.slice(-activeSeasons.length)) {
      const counts = movementCounts.get(report.seasonId);
      if (counts) {
        report.promotions = counts.promotions;
        report.relegations = counts.relegations;
      }
    }
    for (const season of activeSeasons) {
      markSeasonState(input.db, season.season, "ROLLED_OVER", {
        rolledOverAt: season.ruleSet.seasonEndDate,
      });
    }
    if (input.transfersEnabled) {
      simulateTransferWindow({
        db: input.db,
        worldDate: addDays(latestSeasonEnd(activeSeasons), 1),
        seed: `${input.seed}:transfers:${index}`,
        maxClubActions: 10,
      });
    }
    if (input.youthEnabled) {
      const youthDate = addDays(latestSeasonEnd(activeSeasons), 45);
      completeYouthDevelopmentPartnerships(input.db, youthDate);
      const youthClubs = input.db
        .prepare("SELECT DISTINCT club_id FROM youth_player_statuses WHERE club_id IS NOT NULL ORDER BY club_id")
        .all() as Array<{ club_id: EntityId }>;
      for (const youthClub of youthClubs) {
        planYouthDevelopmentPartnerships(input.db, { clubId: youthClub.club_id, worldDate: youthDate });
      }
      youthReports.push(
        runAnnualYouthAndRetirementCycle({
          db: input.db,
          worldDate: youthDate,
          seed: `${input.seed}:youth:${index}`,
          seasonLabel: String(
            new Date(`${latestSeasonEnd(activeSeasons)}T00:00:00.000Z`).getUTCFullYear(),
          ),
        }),
      );
    }
    if (economyEnabled) {
      processEconomyForSeasonPeriod(input.db, save, {
        seasonEndDate: latestSeasonEnd(activeSeasons),
        seed: `${input.seed}:economy:${index}`,
      });
    }
    if (federationEnabled) {
      processFederationForSeasonPeriod(input.db, {
        seasonEndDate: latestSeasonEnd(activeSeasons),
        seed: `${input.seed}:federation:${index}`,
      });
    }
    if (internationalEnabled) {
      processInternationalForSeasonPeriod(input.db, {
        seasonEndDate: latestSeasonEnd(activeSeasons),
        seed: `${input.seed}:international:${index}`,
      });
    }
    processCareerExternalWorldSeason({
      db: input.db,
      seasonEndDate: latestSeasonEnd(activeSeasons),
      seed: `${input.seed}:foreign-world:${index}`,
    });
    advanceTerritorialDevelopment(input.db, {
      date: latestSeasonEnd(activeSeasons),
      seed: `${input.seed}:territorial:${index}`,
    });
    preseasonReports.push(
      ...repairPreseasonContinuity({
        db: input.db,
        competitionSeasonIds: [...nextSeasons.values()].map((season) => season.id),
        date: addDays(latestSeasonEnd(activeSeasons), 60),
        seed: `${input.seed}:preseason:${index}`,
      }),
    );
    activeSeasons = runnableSeasons(
      input.db,
      input.competitionSeasonId,
      skippedCompetitions,
    ).filter((season) => nextSeasons.has(season.season.id));
  }

  const latestEndDate =
    reports.length > 0
      ? (
          input.db
            .prepare("SELECT MAX(completed_at) AS endDate FROM competition_season_states")
            .get() as { endDate: string | null }
        ).endDate
      : save.worldDate;
  updateSaveWorldDate(input.db, save, latestEndDate || save.worldDate);

  return {
    savePath: input.savePath,
    worldDate: latestEndDate || save.worldDate,
    seasonsRequested: input.seasons,
    seasons: reports,
    youthReports,
    workforceReports,
    preseasonReports,
    runnableCompetitions,
    skippedCompetitions,
  };
};

const latestSeasonEnd = (seasons: readonly RunnableSeason[]): string =>
  seasons
    .map((season) => season.ruleSet.seasonEndDate)
    .sort()
    .at(-1) ?? "2026-08-01";

const processEconomyForSeasonPeriod = (
  db: GameDatabase,
  save: SaveMetadata,
  input: { seasonEndDate: string; seed: string },
): void => {
  const endYear = Number(input.seasonEndDate.slice(0, 4));
  const startYear = endYear - 1;
  for (const month of [8, 9, 10, 11, 12]) {
    if (month === 8)
      advanceMacroEconomyForWorldDate(db, { date: `${startYear}-08-01`, seed: input.seed });
    processClubEconomyMonth(db, {
      date: `${startYear}-${String(month).padStart(2, "0")}-28`,
      seed: `${input.seed}:${month}`,
    });
    if (month === 8)
      processExternalFootballWorldSeason(db, { seasonLabel: String(startYear), seed: input.seed });
    runClubAiSeasonPlanning(db, {
      date: `${startYear}-${String(month).padStart(2, "0")}-28`,
      seed: input.seed,
    });
    if (month === 8) {
      runAiStaffPlanning(db, save, `${startYear}-${String(month).padStart(2, "0")}-28`);
    }
  }
  for (const month of [1, 2, 3, 4, 5, 6, 7]) {
    if (month === 1)
      advanceMacroEconomyForWorldDate(db, { date: `${endYear}-01-01`, seed: input.seed });
    processClubEconomyMonth(db, {
      date: `${endYear}-${String(month).padStart(2, "0")}-28`,
      seed: `${input.seed}:${month}`,
    });
    if (month === 1)
      processExternalFootballWorldSeason(db, { seasonLabel: String(endYear), seed: input.seed });
    runClubAiSeasonPlanning(db, {
      date: `${endYear}-${String(month).padStart(2, "0")}-28`,
      seed: input.seed,
    });
  }
  closeClubFinancialSeason(db, {
    seasonLabel: String(endYear),
    date: input.seasonEndDate,
  });
  processOwnershipContinuity(db, { date: input.seasonEndDate, seed: `${input.seed}:ownership` });
};

const runAiStaffPlanning = (db: GameDatabase, save: SaveMetadata, date: string): void => {
  const planningSave = { ...save, worldDate: date };
  evaluateAllStaffContracts(db, planningSave);
  ensureAiStaffAssigned(db, planningSave, undefined);
};

const processFederationForSeasonPeriod = (
  db: GameDatabase,
  input: { seasonEndDate: string; seed: string },
): void => {
  const endYear = Number(input.seasonEndDate.slice(0, 4));
  const startYear = endYear - 1;
  for (const month of [8, 9, 10, 11, 12]) {
    const date = `${startYear}-${String(month).padStart(2, "0")}-28`;
    ensureFederationLeadershipContinuity(db, { date, seed: `${input.seed}:federation-leadership` });
    processFederationMonth(db, { date, seed: `${input.seed}:${month}` });
    if (month === 8) proposeAnnualGovernmentFunding(db, { date, seed: input.seed });
    runFederationComplianceAiForAllFederations(db, date);
  }
  for (const month of [1, 2, 3, 4, 5, 6, 7]) {
    const date = `${endYear}-${String(month).padStart(2, "0")}-28`;
    ensureFederationLeadershipContinuity(db, { date, seed: `${input.seed}:federation-leadership` });
    processFederationMonth(db, { date, seed: `${input.seed}:${month}` });
    runFederationComplianceAiForAllFederations(db, date);
  }
  closeFederationFinancialSeason(db, {
    seasonLabel: String(endYear),
    date: input.seasonEndDate,
  });
};

const simulateCompetitionSeason = (
  db: GameDatabase,
  input: RunnableSeason & { seed: string; maxFixtures?: number; economyEnabled?: boolean },
): CareerSeasonReport => {
  const competitions = new CompetitionRepository(db);
  const players = new PlayerRepository(db);
  ensureSeasonState(db, input.season);
  const fixtures = ensureFixtures(db, input);
  markSeasonState(db, input.season, "SCHEDULED", { currentRound: 0 });

  let playedThisRun = 0;
  const allResults: MatchResult[] = [];
  const squadHealth = blankSquadHealth();
  // Team assignments and player attributes do not change during one
  // competition season. Keep the static roster projection local to this
  // bounded pass; availability and suspensions remain fixture-date queries.
  const attributesByTeam = new Map<EntityId, PlayerAttributeSet[]>();
  const attributesForMatch = (teamId: EntityId): PlayerAttributeSet[] => {
    const cached = attributesByTeam.get(teamId);
    if (cached) return cached;
    const attributes = players.attributesForTeam(teamId);
    attributesByTeam.set(teamId, attributes);
    return attributes;
  };
  // A fixture's match row is immutable once written. Load the existing
  // fixture IDs once, then update this set as the current pass persists
  // results instead of issuing one existence query per fixture twice.
  const completedFixtureIds = new Set<EntityId>(
    (db.prepare(
      "SELECT m.fixture_id FROM matches m JOIN fixtures f ON f.id = m.fixture_id WHERE f.competition_season_id = ?",
    ).all(input.season.id) as Array<{ fixture_id: EntityId }>).map((row) => row.fixture_id),
  );
  for (const fixture of fixtures) {
    if (fixture.status === "played" || completedFixtureIds.has(fixture.id)) {
      continue;
    }
    if (input.maxFixtures !== undefined && playedThisRun >= input.maxFixtures) {
      break;
    }
    markSeasonState(db, input.season, "IN_PROGRESS", { currentRound: fixture.round });
    const unavailable = unavailablePlayers(db, input.season.id, fixture.scheduledDate);
    const homePlayers = availablePlayers(
      attributesForMatch(fixture.homeTeamId),
      unavailable,
    );
    const awayPlayers = availablePlayers(
      attributesForMatch(fixture.awayTeamId),
      unavailable,
    );
    recordSquadHealth(squadHealth, homePlayers, unavailable);
    recordSquadHealth(squadHealth, awayPlayers, unavailable);
    const result = simulateMatch({
      fixture,
      refereeAssignment: requireFixtureOfficials(db, fixture, {
        seed: `${input.seed}:officials:${fixture.id}`,
        competitionLevel: input.ruleSet.competitionType,
        usesVar: Boolean(
          (input.ruleSet.specialRules as Record<string, unknown> | undefined)?.usesVAR,
        ),
      }),
      homePlayers,
      awayPlayers,
      seed: `${input.seed}:match:${fixture.round}:${fixture.id}`,
      requiresWinner: Boolean(
        input.ruleSet.matchesRequireWinner && (!fixture.tieId || fixture.leg === 2),
      ),
      winnerResolution: input.ruleSet.winnerResolution,
      allowExtraTime: input.ruleSet.allowExtraTime,
      allowPenalties: input.ruleSet.allowPenalties,
      aggregateFirstLeg: firstLegScoreFor(db, fixture),
    });
    allResults.push(result);
    persistMatchResult(db, result, input.season.id, fixture.scheduledDate, input.ruleSet, fixture);
    completedFixtureIds.add(fixture.id);
    recordFootballMatchHistory(db, fixture, result, fixture.scheduledDate);
    if (input.economyEnabled) {
      postMatchdayEconomy(db, fixture, fixture.scheduledDate, input.seed);
    }
    recordMatchKnowledge(db, fixture, result, fixture.scheduledDate, input.seed);
    simulateScoutingDay({ db, worldDate: fixture.scheduledDate, seed: input.seed });
    processInternationalTrials(db, { worldDate: fixture.scheduledDate });
    playedThisRun += 1;
  }

  const results = matchResultsForStandings(db, input.season.id);
  const diagnosticResults = allResults.length > 0 ? allResults : results;
  const standings = calculateStandings({
    competitionSeasonId: input.season.id,
    teamIds: input.teamIds,
    ruleSet: input.ruleSet,
    results,
  });
  for (const standing of standings) {
    competitions.upsertStanding(standing);
  }
  for (const stat of summarizeTeamStatsWithCleanSheets(input.season.id, standings, results)) {
    competitions.upsertTeamSeasonStat(stat);
  }

  const finalPlayerStats = playerSeasonStats(db, input.season.id);
  const champion = standings[0];
  if (fixtures.every((fixture) => fixture.status === "played" || completedFixtureIds.has(fixture.id))) {
    persistChampionAndAwards(db, input, champion, finalPlayerStats);
    recordCompetitionSeasonHistory(db, {
      seasonId: input.season.id,
      seasonName: input.season.name,
      championTeamId: champion?.teamId,
      championClubId: champion ? clubIdForTeam(db, champion.teamId) : undefined,
      date: input.ruleSet.seasonEndDate,
    });
    markSeasonState(db, input.season, "COMPLETED", {
      currentRound: Math.max(...fixtures.map((fixture) => fixture.round), 0),
      championClubId: champion ? clubIdForTeam(db, champion.teamId) : undefined,
      completedAt: input.ruleSet.seasonEndDate,
    });
    if (input.economyEnabled) {
      const competitionRights = generateCompetitionMediaRightsOffer(db, {
        competitionSeasonId: input.season.id,
        date: input.ruleSet.seasonEndDate,
        seed: input.seed,
      });
      if (competitionRights.contractStatus === "OFFERED") {
        acceptCompetitionMediaRights(db, competitionRights.id, input.ruleSet.seasonEndDate);
      }
      const federationId = (db.prepare("SELECT federation_id AS id FROM competitions WHERE id = (SELECT competition_id FROM competition_seasons WHERE id = ?)").get(input.season.id) as { id?: EntityId } | undefined)?.id;
      if (federationId) {
        settleFederationMediaRightsForCompetition(db, {
          federationId,
          competitionSeasonId: input.season.id,
          date: input.ruleSet.seasonEndDate,
          seed: input.seed,
        });
      }
      postCompetitionPrizeMoney(db, {
        competitionSeasonId: input.season.id,
        date: input.ruleSet.seasonEndDate,
      });
      settleApprovedCompetitionDistributions(db, {
        competitionSeasonId: input.season.id,
        date: input.ruleSet.seasonEndDate,
      });
    }
  }

  const goals = results.reduce(
    (total, result) => total + (result.match.homeGoals ?? 0) + (result.match.awayGoals ?? 0),
    0,
  );
  const homeWins = results.filter(
    (result) => (result.match.homeGoals ?? 0) > (result.match.awayGoals ?? 0),
  ).length;
  const draws = results.filter(
    (result) => result.match.homeGoals === result.match.awayGoals,
  ).length;
  const cards = diagnosticResults.reduce(
    (total, result) =>
      total +
      result.homeStats.yellowCards +
      result.awayStats.yellowCards +
      result.homeStats.redCards +
      result.awayStats.redCards,
    0,
  );
  const injuries = diagnosticResults.reduce(
    (total, result) => total + result.events.filter((event) => event.type === "INJURY").length,
    0,
  );
  const shots = diagnosticResults.reduce(
    (total, result) => total + result.homeStats.shots + result.awayStats.shots,
    0,
  );
  const xg = diagnosticResults.reduce(
    (total, result) => total + result.homeStats.xg + result.awayStats.xg,
    0,
  );
  const sorted = sortStandings(standings, input.ruleSet.tiebreakers);

  return {
    seasonId: input.season.id,
    seasonName: input.season.name,
    competitionName: input.competitionName,
    status: "played",
    fixturesGenerated: fixtures.length,
    matchesPlayed: results.length,
    goals,
    goalsPerMatch: round(goals / Math.max(1, results.length)),
    homeWinPercentage: round((homeWins / Math.max(1, results.length)) * 100),
    drawPercentage: round((draws / Math.max(1, results.length)) * 100),
    awayWinPercentage: round(
      ((results.length - homeWins - draws) / Math.max(1, results.length)) * 100,
    ),
    averageShots: round(shots / Math.max(1, diagnosticResults.length)),
    averageXg: round(xg / Math.max(1, diagnosticResults.length)),
    cards,
    injuries,
    championTeamId: champion?.teamId,
    championClubId: champion ? clubIdForTeam(db, champion.teamId) : undefined,
    topScorer: awardFromStats(finalPlayerStats, "goals"),
    mostAssists: awardFromStats(finalPlayerStats, "assists"),
    bestGoalkeeper: awardFromStats(
      finalPlayerStats.filter((stat) => stat.cleanSheets > 0),
      "cleanSheets",
    ),
    playerOfSeason: awardFromStats(finalPlayerStats, "averageRating"),
    pointsSpread: sorted.length > 1 ? sorted[0]!.points - sorted[sorted.length - 1]!.points : 0,
    playerAppearances: finalPlayerStats.reduce((total, stat) => total + stat.appearances, 0),
    developedPlayers:
      playedThisRun > 0
        ? developPlayers(db, input.season.id, input.ruleSet.seasonEndDate, input.seed)
        : 0,
    promotions: 0,
    relegations: 0,
    squadHealth,
  };
};

function ensureRecruitmentFoundation(db: GameDatabase, worldDate: string, seed: string): void {
  const existing = (
    db.prepare("SELECT COUNT(*) AS count FROM club_recruitment_profiles").get() as {
      count: number;
    }
  ).count;
  if (existing === 0) {
    initializeRecruitmentForSave({ db, worldDate, seed });
  }
}

function recordMatchKnowledge(
  db: GameDatabase,
  fixture: FixtureRecord,
  result: MatchResult,
  playedDate: string,
  seed: string,
): void {
  const homeClubId = clubIdForTeam(db, fixture.homeTeamId);
  const awayClubId = clubIdForTeam(db, fixture.awayTeamId);
  if (homeClubId && awayClubId) {
    recordMatchObservation(
      db,
      homeClubId,
      result.playerStates
        .filter((state) => state.teamId === fixture.awayTeamId)
        .map((state) => state.personId),
      playedDate,
      seed,
    );
    recordMatchObservation(
      db,
      awayClubId,
      result.playerStates
        .filter((state) => state.teamId === fixture.homeTeamId)
        .map((state) => state.personId),
      playedDate,
      seed,
    );
  }
}

const ensureFixtures = (
  db: GameDatabase,
  input: RunnableSeason & { seed: string },
): FixtureRecord[] => {
  const competitions = new CompetitionRepository(db);
  const existing = competitions.fixtures(input.season.id);
  if (existing.length > 0) {
    return existing;
  }
  const fixtures = generateLeagueFixtures({
    competitionSeasonId: input.season.id,
    teamIds: input.teamIds,
    ruleSet: input.ruleSet,
    seed: `${input.seed}:fixtures`,
  });
  for (const fixture of fixtures) {
    competitions.insertFixture(fixture);
  }
  return competitions.fixtures(input.season.id);
};

const firstLegScoreFor = (
  db: GameDatabase,
  fixture: FixtureRecord,
): { homeGoals: number; awayGoals: number } | undefined => {
  if (!fixture.tieId || fixture.leg !== 2) return undefined;
  const firstLeg = db
    .prepare(
      `SELECT m.home_goals AS home_goals, m.away_goals AS away_goals,
              f.home_team_id AS home_team_id
       FROM fixtures f JOIN matches m ON m.fixture_id = f.id
       WHERE f.tie_id = ? AND f.leg = 1 AND f.id != ? LIMIT 1`,
    )
    .get(fixture.tieId, fixture.id) as
    { home_goals?: number; away_goals?: number; home_team_id?: EntityId } | undefined;
  if (!firstLeg) return undefined;
  return String(firstLeg.home_team_id) === String(fixture.homeTeamId)
    ? { homeGoals: Number(firstLeg.home_goals ?? 0), awayGoals: Number(firstLeg.away_goals ?? 0) }
    : { homeGoals: Number(firstLeg.away_goals ?? 0), awayGoals: Number(firstLeg.home_goals ?? 0) };
};

const persistMatchResult = (
  db: GameDatabase,
  result: MatchResult,
  competitionSeasonId: EntityId,
  playedDate: string,
  ruleSet: CompetitionRuleSet,
  fixture: FixtureRecord,
): void => {
  const requiresWinner = Boolean(
    ruleSet.matchesRequireWinner && (!fixture.tieId || fixture.leg === 2),
  );
  if (requiresWinner && !result.match.winnerTeamId) {
    throw new Error(`Winner-required fixture ${fixture.id} completed without a winner`);
  }
  const competitions = new CompetitionRepository(db);
  const players = new PlayerRepository(db);
  competitions.insertMatch({ ...result.match, playedDate });
  competitions.markFixturePlayed(result.match.fixtureId);
  for (const event of result.events) {
    competitions.insertMatchEvent(event);
    if (
      event.type === "INJURY" &&
      event.data &&
      typeof event.data === "object" &&
      "personId" in event.data &&
      personExists(db, event.data.personId as EntityId)
    ) {
      players.insertInjury(event.data as any);
      const injury = event.data as any;
      const clubId = event.teamId ? clubIdForTeam(db, event.teamId) : undefined;
      if (clubId) {
        const insuranceClaim = settleMatchInjuryInsurance(db, { clubId, injury, date: injury.dateOccurred });
        settleFederationInjuryWelfare(db, { clubId, injury, date: injury.dateOccurred, insuranceClaim });
      }
    }
    if (event.type === "RED_CARD" && event.personId && personExists(db, event.personId)) {
      players.insertSuspension({
        id: createStableEntityId(
          "suspension",
          `${competitionSeasonId}:${event.personId}:${result.match.id}`,
        ),
        personId: event.personId,
        competitionSeasonId,
        reason: "redCard",
        matchesRemaining: 1,
      });
    }
  }
  decrementSuspensions(
    db,
    competitionSeasonId,
    result.playerStates.map((state) => state.personId),
  );
  for (const stat of summarizePlayerStats(competitionSeasonId, [result])) {
    addPlayerSeasonStat(db, stat);
    addPlayerCareerStat(db, stat);
  }
};

const runnableSeasons = (
  db: GameDatabase,
  requestedSeasonId: EntityId | undefined,
  skipped: CareerSimulationReport["skippedCompetitions"],
): RunnableSeason[] => {
  const competitionRepo = new CompetitionRepository(db);
  const world = new WorldRepository(db);
  const players = new PlayerRepository(db);
  const skippedKeys = new Set(skipped.map((item) => item.seasonId));
  const seasons = allCompetitionSeasons(db).filter(
    (season) =>
      requestedSeasonId === undefined ||
      season.id === requestedSeasonId ||
      season.id === createStableEntityId("competition-season", requestedSeasonId),
  );
  const runnable: RunnableSeason[] = [];
  for (const season of seasons) {
    if (seasonState(db, season.id)?.status === "ROLLED_OVER") {
      continue;
    }
    const competition = competitionName(db, season.competitionId);
    const ruleSet = competitionRepo.getRuleSet(season.id);
    const membershipTeamIds = world.teamsForCompetitionSeason(season.id).map((team) => team.id);
    const squadDiagnostics = membershipTeamIds.map((teamId) => {
      const attributes = players.attributesForTeam(teamId);
      return {
        teamId,
        players: attributes.length,
        goalkeepers: attributes.filter((player) => player.primaryPosition === "GK").length,
      };
    });
    const teamIds = squadDiagnostics
      .filter((diagnostic) => diagnostic.players >= 11)
      .map((diagnostic) => diagnostic.teamId);
    if (!ruleSet) {
      if (!skippedKeys.has(season.id)) {
        skipped.push({
          seasonId: season.id,
          seasonName: season.name,
          competitionName: competition,
          reason: "missing rule set",
          membershipTeams: membershipTeamIds.length,
          playableTeams: teamIds.length,
          minimumRequiredTeams: 2,
          clubsBelowMinimumSquad: squadDiagnostics.filter((diagnostic) => diagnostic.players < 11)
            .length,
          clubsWithoutGoalkeeper: squadDiagnostics.filter(
            (diagnostic) => diagnostic.goalkeepers === 0,
          ).length,
        });
      }
      continue;
    }
    if (teamIds.length < 2) {
      if (!skippedKeys.has(season.id)) {
        skipped.push({
          seasonId: season.id,
          seasonName: season.name,
          competitionName: competition,
          reason:
            membershipTeamIds.length < 2
              ? "fewer than two active membership teams"
              : "fewer than two playable squads after preseason repair",
          membershipTeams: membershipTeamIds.length,
          playableTeams: teamIds.length,
          minimumRequiredTeams: 2,
          clubsBelowMinimumSquad: squadDiagnostics.filter((diagnostic) => diagnostic.players < 11)
            .length,
          clubsWithoutGoalkeeper: squadDiagnostics.filter(
            (diagnostic) => diagnostic.goalkeepers === 0,
          ).length,
        });
      }
      continue;
    }
    runnable.push({
      season,
      competitionName: competition,
      ruleSet,
      teamIds,
    });
  }
  return runnable;
};

const pendingCompetitionSeasonIds = (
  db: GameDatabase,
  requestedSeasonId: EntityId | undefined,
): EntityId[] =>
  allCompetitionSeasons(db)
    .filter(
      (season) =>
        requestedSeasonId === undefined ||
        season.id === requestedSeasonId ||
        season.id === createStableEntityId("competition-season", requestedSeasonId),
    )
    .filter((season) => seasonState(db, season.id)?.status !== "ROLLED_OVER")
    .map((season) => season.id);

const createNextSeasons = (
  db: GameDatabase,
  seasons: readonly RunnableSeason[],
): Map<EntityId, CompetitionSeason> => {
  const world = new WorldRepository(db);
  const nextByCompetition = new Map<EntityId, CompetitionSeason>();
  for (const item of seasons) {
    const nextStart = addYears(item.ruleSet.seasonStartDate, 1);
    const nextEnd = addYears(item.ruleSet.seasonEndDate, 1);
    const nextSeason: CompetitionSeason = {
      id: createStableEntityId("competition-season", `${item.season.competitionId}:${nextStart}`),
      competitionId: item.season.competitionId,
      name: nextSeasonName(item.season.name),
      startDate: nextStart,
      endDate: nextEnd,
    };
    if (!world.getCompetitionSeason(nextSeason.id)) {
      world.insertCompetitionSeason(nextSeason);
      copyRuleSet(db, item.ruleSet, nextSeason);
      ensureSeasonState(db, nextSeason);
    }
    nextByCompetition.set(item.season.competitionId, nextSeason);
  }
  return new Map([...nextByCompetition.values()].map((season) => [season.id, season]));
};

const applyProgression = (
  db: GameDatabase,
  seasons: readonly RunnableSeason[],
  completed: Array<{
    season: CompetitionSeason;
    ruleSet: CompetitionRuleSet;
    standings: readonly LeagueStanding[];
  }>,
  nextSeasons: ReadonlyMap<EntityId, CompetitionSeason>,
  licensingEligible?: ReadonlySet<EntityId>,
): Map<EntityId, { promotions: number; relegations: number }> => {
  const world = new WorldRepository(db);
  const relationships = seasons.flatMap((season) =>
    new CompetitionRepository(db).relationshipsFrom(season.season.competitionId),
  );
  const result = progressPyramidSeason({
    completedSeasons: completed.map((item) => ({
      ...item,
      memberships: world.clubMembershipsForCompetitionSeason(item.season.id),
    })),
    nextSeasons: new Map([...nextSeasons.values()].map((season) => [season.competitionId, season])),
    relationships,
    eligibleClubIds: licensingEligible,
  });
  persistPyramidProgression(db, result);
  const counts = new Map<EntityId, { promotions: number; relegations: number }>();
  for (const movement of result.movements) {
    const current = counts.get(movement.fromCompetitionSeasonId) ?? {
      promotions: 0,
      relegations: 0,
    };
    if (movement.movementType === "PROMOTION" && movement.status === "APPLIED") {
      current.promotions += 1;
    }
    if (movement.movementType === "RELEGATION" && movement.status === "APPLIED") {
      current.relegations += 1;
    }
    counts.set(movement.fromCompetitionSeasonId, current);
  }
  return counts;
};

function ensureSeasonState(db: GameDatabase, season: CompetitionSeason): void {
  db.prepare(
    `INSERT INTO competition_season_states
    (competition_season_id, competition_id, season_label, start_date, end_date, status, current_round)
    VALUES (?, ?, ?, ?, ?, 'NOT_STARTED', 0)
    ON CONFLICT(competition_season_id) DO NOTHING`,
  ).run(season.id, season.competitionId, season.name, season.startDate, season.endDate);
}

function markSeasonState(
  db: GameDatabase,
  season: CompetitionSeason,
  status: CompetitionSeasonLifecycleStatus,
  options: {
    currentRound?: number;
    championClubId?: EntityId;
    completedAt?: string;
    rolledOverAt?: string;
  } = {},
): void {
  ensureSeasonState(db, season);
  db.prepare(
    `UPDATE competition_season_states
    SET status = ?, current_round = COALESCE(?, current_round),
      champion_club_id = COALESCE(?, champion_club_id),
      completed_at = COALESCE(?, completed_at),
      rolled_over_at = COALESCE(?, rolled_over_at)
    WHERE competition_season_id = ?`,
  ).run(
    status,
    options.currentRound ?? null,
    options.championClubId ?? null,
    options.completedAt ?? null,
    options.rolledOverAt ?? null,
    season.id,
  );
}

function seasonState(
  db: GameDatabase,
  seasonId: EntityId,
): { status: CompetitionSeasonLifecycleStatus } | undefined {
  return db
    .prepare("SELECT status FROM competition_season_states WHERE competition_season_id = ?")
    .get(seasonId) as { status: CompetitionSeasonLifecycleStatus } | undefined;
}

function allCompetitionSeasons(db: GameDatabase): CompetitionSeason[] {
  return db
    .prepare("SELECT * FROM competition_seasons ORDER BY start_date, id")
    .all()
    .map((row: any) => ({
      id: row.id,
      competitionId: row.competition_id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
    }));
}

function matchResultsForStandings(db: GameDatabase, competitionSeasonId: EntityId): MatchResult[] {
  return db
    .prepare(
      `SELECT m.*, f.home_team_id, f.away_team_id
      FROM matches m
      JOIN fixtures f ON f.id = m.fixture_id
      WHERE f.competition_season_id = ?
      ORDER BY f.scheduled_date, f.round, f.id`,
    )
    .all(competitionSeasonId)
    .map((row: any) => ({
      match: {
        id: row.id,
        fixtureId: row.fixture_id,
        playedDate: row.played_date ?? undefined,
        homeGoals: row.home_goals,
        awayGoals: row.away_goals,
      },
      events: [],
      homeStats: {
        teamId: row.home_team_id,
        goals: row.home_goals,
        shots: 0,
        shotsOnTarget: 0,
        xg: 0,
        possession: 50,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
        passesCompleted: 0,
        saves: 0,
      },
      awayStats: {
        teamId: row.away_team_id,
        goals: row.away_goals,
        shots: 0,
        shotsOnTarget: 0,
        xg: 0,
        possession: 50,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
        passesCompleted: 0,
        saves: 0,
      },
      playerStates: [],
    }));
}

function availablePlayers(
  players: PlayerAttributeSet[],
  unavailable: ReadonlySet<EntityId>,
): PlayerAttributeSet[] {
  return players.filter((player) => !unavailable.has(player.personId));
}

function unavailablePlayers(
  db: GameDatabase,
  competitionSeasonId: EntityId,
  date: string,
): Set<EntityId> {
  const players = new PlayerRepository(db);
  return new Set([
    ...players.activeInjuries(date).map((injury) => injury.personId),
    ...players.activeSuspensions(competitionSeasonId).map((suspension) => suspension.personId),
  ]);
}

function recordSquadHealth(
  health: SquadHealthReport,
  players: readonly PlayerAttributeSet[],
  unavailable: ReadonlySet<EntityId>,
): void {
  if (players.length >= 11) health.clubsWithValidXi += 1;
  if (players.length >= 16) health.clubsWithValidBench += 1;
  if (players.length < 11) health.emergencyLineupCases += 1;
  health.playersUnavailable += unavailable.size;
  const positions = new Set(players.map((player) => player.primaryPosition));
  if (!positions.has("GK") || ![...positions].some((position) => position !== "GK")) {
    health.clubsWithPositionShortages += 1;
  }
}

function blankSquadHealth(): SquadHealthReport {
  return {
    clubsWithValidXi: 0,
    clubsWithValidBench: 0,
    emergencyLineupCases: 0,
    playersUnavailable: 0,
    clubsWithPositionShortages: 0,
  };
}

function addPlayerSeasonStat(db: GameDatabase, stat: PlayerSeasonStat): void {
  if (!personExists(db, stat.personId) || !teamExists(db, stat.teamId)) {
    return;
  }
  const row = db
    .prepare(
      `SELECT * FROM player_season_stats
      WHERE competition_season_id = ? AND person_id = ? AND team_id = ?`,
    )
    .get(stat.competitionSeasonId, stat.personId, stat.teamId) as any;
  if (!row) {
    new CompetitionRepository(db).upsertPlayerSeasonStat(stat);
    return;
  }
  new CompetitionRepository(db).upsertPlayerSeasonStat({
    ...stat,
    appearances: row.appearances + stat.appearances,
    starts: row.starts + stat.starts,
    minutes: row.minutes + stat.minutes,
    goals: row.goals + stat.goals,
    assists: row.assists + stat.assists,
    yellowCards: row.yellow_cards + stat.yellowCards,
    redCards: row.red_cards + stat.redCards,
    cleanSheets: row.clean_sheets + stat.cleanSheets,
    averageRating: round(
      (row.average_rating * row.appearances + stat.averageRating * stat.appearances) /
        Math.max(1, row.appearances + stat.appearances),
    ),
  });
}

function addPlayerCareerStat(db: GameDatabase, stat: PlayerSeasonStat): void {
  if (!personExists(db, stat.personId) || !teamExists(db, stat.teamId)) {
    return;
  }
  db.prepare(
    `INSERT INTO player_career_stats
    (person_id, team_id, appearances, starts, minutes, goals, assists, yellow_cards, red_cards, clean_sheets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(person_id, team_id) DO UPDATE SET
      appearances = appearances + excluded.appearances,
      starts = starts + excluded.starts,
      minutes = minutes + excluded.minutes,
      goals = goals + excluded.goals,
      assists = assists + excluded.assists,
      yellow_cards = yellow_cards + excluded.yellow_cards,
      red_cards = red_cards + excluded.red_cards,
      clean_sheets = clean_sheets + excluded.clean_sheets`,
  ).run(
    stat.personId,
    stat.teamId,
    stat.appearances,
    stat.starts,
    stat.minutes,
    stat.goals,
    stat.assists,
    stat.yellowCards,
    stat.redCards,
    stat.cleanSheets,
  );
}

function personExists(db: GameDatabase, personId: EntityId): boolean {
  return persistedEntities(db).persons.has(personId);
}

function teamExists(db: GameDatabase, teamId: EntityId): boolean {
  return persistedEntities(db).teams.has(teamId);
}

function persistedEntities(db: GameDatabase): { persons: Set<EntityId>; teams: Set<EntityId> } {
  const cached = entityCache.get(db);
  if (cached) {
    return cached;
  }
  const entities = {
    persons: new Set(
      (db.prepare("SELECT id FROM persons").all() as Array<{ id: EntityId }>).map((row) => row.id),
    ),
    teams: new Set(
      (db.prepare("SELECT id FROM teams").all() as Array<{ id: EntityId }>).map((row) => row.id),
    ),
  };
  entityCache.set(db, entities);
  return entities;
}

function playerSeasonStats(db: GameDatabase, competitionSeasonId: EntityId): PlayerSeasonStat[] {
  return db
    .prepare("SELECT * FROM player_season_stats WHERE competition_season_id = ?")
    .all(competitionSeasonId)
    .map((row: any) => ({
      competitionSeasonId: row.competition_season_id,
      personId: row.person_id,
      teamId: row.team_id,
      appearances: row.appearances,
      starts: row.starts,
      minutes: row.minutes,
      goals: row.goals,
      assists: row.assists,
      yellowCards: row.yellow_cards,
      redCards: row.red_cards,
      averageRating: row.average_rating,
      cleanSheets: row.clean_sheets,
    }));
}

function awardFromStats(
  stats: readonly PlayerSeasonStat[],
  field: "goals" | "assists" | "cleanSheets" | "averageRating",
): PlayerAwardReport | undefined {
  const winner = [...stats]
    .filter((stat) => field !== "averageRating" || stat.appearances >= 3)
    .sort(
      (a, b) =>
        (b[field] as number) - (a[field] as number) ||
        String(a.personId).localeCompare(String(b.personId)),
    )[0];
  return winner
    ? { personId: winner.personId, teamId: winner.teamId, value: winner[field] as number }
    : undefined;
}

function persistChampionAndAwards(
  db: GameDatabase,
  input: RunnableSeason,
  champion: LeagueStanding | undefined,
  stats: readonly PlayerSeasonStat[],
): void {
  const competitions = new CompetitionRepository(db);
  if (
    champion &&
    !db
      .prepare("SELECT 1 FROM competition_winners WHERE competition_season_id = ?")
      .get(input.season.id)
  ) {
    competitions.insertWinner({
      id: createStableEntityId("competition-winner", input.season.id),
      competitionSeasonId: input.season.id,
      teamId: champion.teamId,
      decidedOn: input.ruleSet.seasonEndDate,
    });
    new FootballHistoryRepository(db).record({
      recordType: "COMPETITION_HIGHEST_POINTS",
      scopeId: input.season.id,
      holderId: champion.teamId,
      value: champion.points,
      achievedOn: input.ruleSet.seasonEndDate,
      sourceId: input.season.id,
      provenanceStatus: "SIMULATION_ONLY",
    });
  }
  for (const [awardType, award] of [
    ["TOP_SCORER", awardFromStats(stats, "goals")],
    ["MOST_ASSISTS", awardFromStats(stats, "assists")],
    [
      "BEST_GOALKEEPER",
      awardFromStats(
        stats.filter((stat) => stat.cleanSheets > 0),
        "cleanSheets",
      ),
    ],
    ["PLAYER_OF_SEASON", awardFromStats(stats, "averageRating")],
  ] as const) {
    if (!award) continue;
    new FootballHistoryRepository(db).record({
      recordType: `COMPETITION_${awardType}`,
      scopeId: input.season.id,
      holderId: award.personId,
      value: award.value,
      achievedOn: input.ruleSet.seasonEndDate,
      sourceId: input.season.id,
      provenanceStatus: "SIMULATION_ONLY",
    });
    db.prepare(
      `INSERT INTO season_awards
      (id, competition_season_id, award_type, person_id, team_id, value, decided_on)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(competition_season_id, award_type) DO NOTHING`,
    ).run(
      createStableEntityId("season-award", `${input.season.id}:${awardType}`),
      input.season.id,
      awardType,
      award.personId,
      award.teamId,
      award.value,
      input.ruleSet.seasonEndDate,
    );
  }
}

function summarizeTeamStatsWithCleanSheets(
  competitionSeasonId: EntityId,
  standings: readonly LeagueStanding[],
  results: readonly MatchResult[],
): TeamSeasonStat[] {
  return standings.map((standing) => ({
    competitionSeasonId,
    teamId: standing.teamId,
    played: standing.played,
    wins: standing.won,
    draws: standing.drawn,
    losses: standing.lost,
    goalsFor: standing.goalsFor,
    goalsAgainst: standing.goalsAgainst,
    cleanSheets: results.filter((result) =>
      result.homeStats.teamId === standing.teamId
        ? result.match.awayGoals === 0
        : result.awayStats.teamId === standing.teamId && result.match.homeGoals === 0,
    ).length,
  }));
}

const ageOnDate = (dateOfBirth: string, onDate: string): number => {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const on = new Date(`${onDate}T00:00:00Z`);
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  if (
    on.getUTCMonth() < birth.getUTCMonth() ||
    (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
};

/**
 * AI-club and background player development for a season period — the same
 * `updatePlayerDevelopment` engine the manager's own daily loop uses, given
 * real age, a sensible default individual plan (filled in only if the club
 * hasn't set one) and the club's real coaching/facility environment, so
 * background clubs develop players on the same rules the player's club does.
 */
function developPlayers(
  db: GameDatabase,
  competitionSeasonId: EntityId,
  date: string,
  seed: string,
): number {
  const players = new PlayerRepository(db);
  const world = new WorldRepository(db);
  const stats = playerSeasonStats(db, competitionSeasonId).filter((stat) => stat.minutes > 0);
  const teamsProcessed = new Set<EntityId>();
  const environmentByTeam = new Map<EntityId, ReturnType<typeof computeDevelopmentEnvironment>>();
  let count = 0;
  for (const stat of stats) {
    const attributes = players.getAttributes(stat.personId);
    const state = players.developmentState(stat.personId);
    const potential = players.potential(stat.personId);
    if (!attributes || !state || !potential) continue;
    /*
     * Development is a property of elapsed time, not of how many competitions a
     * player happened to enter. Nepal's competition seasons all end on the same
     * date, and a club fielding the same squad in (say) the ANFA National
     * League and the A-Division produces one stats row per competition — so
     * without this guard the same player was developed twice on the same date,
     * double-applying attribute and state changes and then colliding on the
     * canonical training-history event id.
     */
    if (state.lastDevelopmentUpdate && state.lastDevelopmentUpdate >= date) continue;
    if (!teamsProcessed.has(stat.teamId)) {
      ensureSensibleDevelopmentPlan(db, date, stat.teamId);
      teamsProcessed.add(stat.teamId);
    }
    let environment = environmentByTeam.get(stat.teamId);
    if (!environment) {
      const clubRow = db.prepare("SELECT club_id FROM teams WHERE id = ?").get(stat.teamId) as
        { club_id?: EntityId } | undefined;
      environment = computeDevelopmentEnvironment(db, clubRow?.club_id);
      environmentByTeam.set(stat.teamId, environment);
    }
    const person = world.getPerson(stat.personId);
    const age = person?.dateOfBirth ? ageOnDate(person.dateOfBirth, date) : 25;
    const individualPlan = world.activeIndividualDevelopmentPlan(stat.personId);
    const availability = trainingAvailabilityFor(db, stat.personId, date);
    const updated = updatePlayerDevelopment({
      attributes,
      state,
      potential,
      age,
      date,
      seed,
      historyScope: `${competitionSeasonId}:${stat.teamId}`,
      individualPlan,
      environment,
      trainingAvailability: availability,
      playingTime: {
        id: createStableEntityId("playing-time", `${competitionSeasonId}:${stat.personId}`),
        playerId: stat.personId,
        competitionSeasonId,
        minutesLast30Days: Math.min(stat.minutes, 450),
        minutesSeason: stat.minutes,
        startsSeason: stat.starts,
        subAppearances: Math.max(0, stat.appearances - stat.starts),
        updatedOn: date,
      },
      periodDays: 28,
    });
    players.upsertAttributes(updated.updatedAttributes);
    players.upsertDevelopmentState(updated.updatedState);
    for (const event of updated.historyEvents) {
      players.insertTrainingHistoryEvent({ ...event, teamId: stat.teamId });
    }
    count += 1;
  }
  return count;
}

function decrementSuspensions(
  db: GameDatabase,
  competitionSeasonId: EntityId,
  personIds: readonly EntityId[],
): void {
  for (const personId of new Set(personIds)) {
    db.prepare(
      `UPDATE suspensions SET matches_remaining = MAX(0, matches_remaining - 1)
      WHERE competition_season_id = ? AND person_id = ? AND matches_remaining > 0`,
    ).run(competitionSeasonId, personId);
  }
}

function clubIdForTeam(db: GameDatabase, teamId: EntityId): EntityId | undefined {
  return (
    db.prepare("SELECT club_id AS clubId FROM teams WHERE id = ?").get(teamId) as
      { clubId?: EntityId } | undefined
  )?.clubId;
}

function competitionName(db: GameDatabase, competitionId: EntityId): string {
  return (
    (
      db.prepare("SELECT name FROM competitions WHERE id = ?").get(competitionId) as
        { name: string } | undefined
    )?.name ?? String(competitionId)
  );
}

function copyRuleSet(
  db: GameDatabase,
  ruleSet: CompetitionRuleSet,
  season: CompetitionSeason,
): void {
  new CompetitionRepository(db).insertRuleSet({
    ...ruleSet,
    id: createStableEntityId("competition-rule", season.id),
    competitionSeasonId: season.id,
    seasonStartDate: season.startDate,
    seasonEndDate: season.endDate,
  });
}

function nextSeasonName(name: string): string {
  const match = name.match(/(.*?)(\d{4})$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${name} +1`;
}

function addYears(date: string, years: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
