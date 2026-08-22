import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateNepalWorldDataset } from "@nepal-football-sim/data-import";
import {
  type EntityId,
  type FixtureRecord,
  type PlayerAttributeSet,
} from "@nepal-football-sim/shared-types";
import { simulateMatch } from "./match-engine.js";

const defaultDatasetPath = "data/nepal/2026-08/club-registry.json";
const datasetPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolveDefaultDatasetPath();
const dataset = validateNepalWorldDataset(JSON.parse(readFileSync(datasetPath, "utf8")));

const assignmentsByTeam = new Map<string, string[]>();
for (const assignment of dataset.teamPersonAssignments) {
  const players = assignmentsByTeam.get(assignment.teamKey) ?? [];
  players.push(assignment.personKey);
  assignmentsByTeam.set(assignment.teamKey, players);
}

const attributesByPerson = new Map(
  dataset.playerAttributes.map((attributes) => [attributes.personKey, attributes]),
);
const profilesByPerson = new Map(
  dataset.playerFactualProfiles.map((profile) => [profile.playerKey, profile]),
);
const nationalLeagueMemberships = dataset.clubMemberships.filter(
  (membership) => membership.competitionSeasonKey?.value === "anfa-national-league-2026",
);
const nationalLeagueTeamKeys = nationalLeagueMemberships.flatMap((membership) =>
  membership.teamKey?.value ? [membership.teamKey.value] : [],
);
const rosterSizes = nationalLeagueTeamKeys.map((teamKey) => ({
  teamKey,
  players: assignmentsByTeam.get(teamKey)?.length ?? 0,
}));
const abilities = dataset.playerFactualProfiles.map((profile) => profile.currentAbility);
const potentials = dataset.playerFactualProfiles.map((profile) => profile.potentialAbility);
const factualStatuses = countBy(dataset.playerFactualProfiles, (profile) => profile.recordStatus);
const positionPrecision = countBy(
  dataset.playerFactualProfiles,
  (profile) => profile.positionPrecision,
);
const sourceReliability = countBy(dataset.playerSourceRegister, (source) => source.reliability);
const factualCoverage = {
  dateOfBirth: dataset.playerFactualProfiles.filter((profile) => profile.dateOfBirth?.value).length,
  heightCm: dataset.playerFactualProfiles.filter((profile) => profile.heightCm?.value).length,
  preferredFoot: dataset.playerFactualProfiles.filter((profile) => profile.preferredFoot?.value)
    .length,
  goalkeeperFlag: dataset.playerFactualProfiles.filter((profile) => profile.goalkeeperFlag?.value)
    .length,
};
const simulationOnlyCoverage = {
  primaryPosition: dataset.playerFactualProfiles.filter(
    (profile) => profile.simulationPrimaryPositionStatus === "SIMULATION_ONLY",
  ).length,
  dateOfBirth: dataset.playerFactualProfiles.filter(
    (profile) => profile.simulationDateOfBirthStatus === "SIMULATION_ONLY",
  ).length,
  heightCm: dataset.playerFactualProfiles.filter(
    (profile) => profile.simulationHeightStatus === "SIMULATION_ONLY",
  ).length,
  preferredFoot: dataset.playerFactualProfiles.filter(
    (profile) => profile.simulationPreferredFootStatus === "SIMULATION_ONLY",
  ).length,
  attributes: dataset.playerAttributes.filter(
    (attributes) => attributes.provenance.status === "SIMULATION_ONLY",
  ).length,
};
const matchSmoke = simulateImportedSquadMatch("NEP-DIVA-MAC-MEN", "NEP-DEP-ARM-MEN");

console.log(
  JSON.stringify(
    {
      datasetPath,
      sourceRows: dataset.playerImportSummary?.sourceRows ?? dataset.playerFactualProfiles.length,
      players: dataset.playerFactualProfiles.length,
      sourceRegisterRows: dataset.playerSourceRegister.length,
      sourceReliability,
      nationalLeagueTeams: nationalLeagueTeamKeys.length,
      rosterSizes,
      rosterSizeRange: range(rosterSizes.map((roster) => roster.players)),
      positionPrecision,
      factualStatuses,
      factualCoverage,
      simulationOnlyCoverage,
      ability: distribution(abilities),
      potential: distribution(potentials),
      clubStrength: nationalLeagueTeamKeys.map((teamKey) => clubStrengthSummary(teamKey)),
      duplicateHandling: {
        importedRowsMerged: dataset.playerImportSummary?.duplicateMergesApplied ?? 0,
        unresolvedCases: dataset.playerImportSummary?.duplicateUnresolvedCases ?? 0,
        sameNameSankataBishalTamang: dataset.playerFactualProfiles
          .filter(
            (profile) =>
              profile.currentClubKey?.value === "NEP-DIVA-SBO" &&
              profile.nameVariants.some((variant) => variant.startsWith("Bishal Tamang")),
          )
          .map((profile) => profile.canonicalExternalId)
          .sort(),
      },
      matchSmoke,
      threeSeasonDevelopmentProjection: projectThreeSeasons(),
    },
    null,
    2,
  ),
);

function playersForTeam(teamKey: string): PlayerAttributeSet[] {
  return (assignmentsByTeam.get(teamKey) ?? []).map((personKey) => {
    const attributes = attributesByPerson.get(personKey)!;
    return {
      id: attributes.key as EntityId,
      personId: attributes.personKey as EntityId,
      primaryPosition: attributes.primaryPosition,
      secondaryPositions: attributes.secondaryPositions,
      technical: attributes.technical,
      mental: attributes.mental,
      physical: attributes.physical,
      goalkeeping: attributes.goalkeeping,
    };
  });
}

function simulateImportedSquadMatch(homeTeamId: string, awayTeamId: string) {
  const fixture: FixtureRecord = {
    id: "fixture-imported-nepal-player-balance" as EntityId,
    competitionSeasonId: "anfa-national-league-2026" as EntityId,
    homeTeamId: homeTeamId as EntityId,
    awayTeamId: awayTeamId as EntityId,
    scheduledDate: "2026-08-15",
    status: "scheduled",
    round: 1,
  };
  const result = simulateMatch({
    fixture,
    homePlayers: playersForTeam(homeTeamId),
    awayPlayers: playersForTeam(awayTeamId),
    seed: "players-balance-imported-nepal-match",
  });

  return {
    homeTeamId,
    awayTeamId,
    score: `${result.match.homeGoals ?? 0}-${result.match.awayGoals ?? 0}`,
    shots: [result.homeStats.shots, result.awayStats.shots],
    xg: [round(result.homeStats.xg), round(result.awayStats.xg)],
    events: result.events.length,
    selectedPlayers: result.playerStates.length,
  };
}

function clubStrengthSummary(teamKey: string) {
  const people = assignmentsByTeam.get(teamKey) ?? [];
  const clubAbilities = people
    .map((personKey) => profilesByPerson.get(personKey)?.currentAbility)
    .filter((value): value is number => typeof value === "number");

  return {
    teamKey,
    players: people.length,
    averageCurrentAbility: average(clubAbilities),
    topCurrentAbility: clubAbilities.length > 0 ? round(Math.max(...clubAbilities)) : 0,
  };
}

function projectThreeSeasons() {
  let current = dataset.playerFactualProfiles.map((profile) => ({
    currentAbility: profile.currentAbility,
    potentialAbility: profile.potentialAbility,
  }));
  const seasons = [];
  for (let season = 1; season <= 3; season += 1) {
    current = current.map((player) => ({
      ...player,
      currentAbility: Math.min(
        player.potentialAbility,
        player.currentAbility + (player.potentialAbility - player.currentAbility) * 0.12,
      ),
    }));
    seasons.push({
      season,
      averageCurrentAbility: average(current.map((player) => player.currentAbility)),
      playersAtOrAboveTen: current.filter((player) => player.currentAbility >= 10).length,
    });
  }
  return seasons;
}

function countBy<T>(items: readonly T[], keyFor: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function distribution(values: readonly number[]) {
  return {
    min: round(Math.min(...values)),
    average: average(values),
    max: round(Math.max(...values)),
  };
}

function range(values: readonly number[]) {
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function average(values: readonly number[]): number {
  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveDefaultDatasetPath(): string {
  const fromCurrent = resolve(process.cwd(), defaultDatasetPath);
  if (existsSync(fromCurrent)) {
    return fromCurrent;
  }
  return resolve(process.cwd(), "../..", defaultDatasetPath);
}
