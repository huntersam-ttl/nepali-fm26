import { createDemoLeagueInput } from "./demo-league.js";
import { simulateSeason } from "./season-engine.js";

const seasonsArgIndex = process.argv.indexOf("--seasons");
const yearsArgIndex = process.argv.indexOf("--years");
const seasons =
  seasonsArgIndex >= 0
    ? Number(process.argv[seasonsArgIndex + 1] ?? 1)
    : yearsArgIndex >= 0
      ? Number(process.argv[yearsArgIndex + 1] ?? 10)
      : 10;

const reports = Array.from({ length: seasons }, (_, index) => {
  const input = createDemoLeagueInput(`stage-three-season-cli:${index}`, index);
  return simulateSeason(input).report;
});

console.log(
  JSON.stringify(
    {
      seasons: reports.length,
      reports,
      aggregate: {
        matchesPlayed: reports.reduce((total, report) => total + report.matchesPlayed, 0),
        goalsPerMatch:
          Math.round(
            (reports.reduce((total, report) => total + report.goals, 0) /
              Math.max(
                1,
                reports.reduce((total, report) => total + report.matchesPlayed, 0),
              )) *
              100,
          ) / 100,
      },
    },
    null,
    2,
  ),
);
