import { createDemoLeagueInput } from "./demo-league.js";
import { generateLeagueFixtures } from "./fixture-generation.js";
import { simulateMatch } from "./match-engine.js";

const input = createDemoLeagueInput("stage-three-match-cli");
const fixture = generateLeagueFixtures({
  competitionSeasonId: input.competitionSeason.id,
  teamIds: input.teamIds.slice(0, 2),
  ruleSet: { ...input.ruleSet, homeAwayStructure: "single" },
  seed: input.seed,
})[0]!;
const result = simulateMatch({
  fixture,
  homePlayers: input.playersByTeam.get(fixture.homeTeamId) ?? [],
  awayPlayers: input.playersByTeam.get(fixture.awayTeamId) ?? [],
  seed: `${input.seed}:single-match`,
});

console.log(
  JSON.stringify(
    {
      fixtureId: fixture.id,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      score: `${result.match.homeGoals}-${result.match.awayGoals}`,
      shots: [result.homeStats.shots, result.awayStats.shots],
      xg: [result.homeStats.xg, result.awayStats.xg],
      events: result.events.length,
    },
    null,
    2,
  ),
);
