import { InternationalFootballRepository, NationalTeamManagementRepository, type GameDatabase } from "@nepal-football-sim/database";
import type {
  EntityId,
  InternationalCompetitionEdition,
  InternationalCompetitionStage,
  NationalTeamCompetitionEntry,
  NationalTeamCompetitionsView,
  NationalTeamKnockoutRound,
  NationalTeamMatchView,
  NationalTeamRegistrationView,
} from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";
import { groupStandings } from "./international-football.js";
import { nationalTeamPoolStanding } from "./national-team-operations.js";
import { nationalTeamIdentity, nationalTeamMatches } from "./national-team-workspace.js";

const ROLE = "FEDERATION_PRESIDENT" as const;
const COMPLETED_LIMIT = 10;
const NOT_STARTED = new Set(["PLANNED", "DRAWN", "SCHEDULED"]);

const isGroupStage = (stage: InternationalCompetitionStage): boolean => stage.formatType === "GROUP_STAGE";

const byDate = (a: NationalTeamMatchView, b: NationalTeamMatchView): number =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * The national team's competition entries, read from the international
 * competition record: the edition, the team's participation, its group table
 * and knockout matches, and (only where a record exists) its campaign and squad
 * registration. Read-only. Seeding, draw and strength values never leave the
 * backend, and nothing about how likely the team is to advance is computed.
 */
export const buildNationalTeamCompetitions = (db: GameDatabase, teamId: EntityId, asOf: string): NationalTeamCompetitionsView => {
  const team = nationalTeamIdentity(db, teamId);
  const international = new InternationalFootballRepository(db);
  const own = international.teamProfiles().find((profile) => profile.nationalTeamId === teamId);
  const empty: NationalTeamCompetitionsView = { team, active: [], upcoming: [], completed: [], asOf, provenanceStatus: "SIMULATION_ONLY" };
  if (!own) return empty;

  const profileName = new Map(international.teamProfiles().map((profile) => [profile.id, profile.name]));
  const editions = new Map(international.editions().map((edition) => [edition.id, edition]));
  const competitions = new Map(international.competitions().map((competition) => [competition.id, competition]));
  const management = new NationalTeamManagementRepository(db);
  const campaigns = management.campaigns(teamId);
  const registrations = management.registrations().filter((item) => item.nationalTeamId === teamId);
  const duties = international.duties().filter((duty) => duty.nationalTeamId === teamId);
  const allMatches = nationalTeamMatches(db, teamId, asOf);
  let standing: ReturnType<typeof nationalTeamPoolStanding> | undefined;

  const entries = international
    .participants()
    .filter((participant) => participant.teamProfileId === own.id)
    .flatMap((participant): NationalTeamCompetitionEntry[] => {
      const edition = editions.get(participant.editionId) as InternationalCompetitionEdition | undefined;
      if (!edition) return [];
      const competition = competitions.get(edition.competitionId);
      const stages = international.stages(edition.id).sort((a, b) => a.stageOrder - b.stageOrder);
      const stageOf = (name?: string) => stages.find((stage) => stage.name === name);
      const matches = allMatches.filter((match) => match.editionId === edition.id).sort(byDate);

      const playedStages = matches
        .filter((match) => match.status === "PLAYED")
        .map((match) => stageOf(match.stage))
        .filter((stage): stage is InternationalCompetitionStage => Boolean(stage));
      const furthest = playedStages.sort((a, b) => b.stageOrder - a.stageOrder)[0];
      const started = matches.some((match) => match.status === "PLAYED");
      const stageReached = furthest?.name ?? (participant.groupName ? stages[0]?.name : undefined);

      const outcome: NationalTeamCompetitionEntry["outcome"] =
        participant.entryStatus === "CHAMPION"
          ? { key: "CHAMPION", label: "Champion", stageReached }
          : participant.entryStatus === "ELIMINATED"
            ? { key: "ELIMINATED", label: stageReached ? `Eliminated in ${stageReached}` : "Eliminated", stageReached }
            : !started && NOT_STARTED.has(edition.status)
              ? { key: "NOT_STARTED", label: "Not started", stageReached }
              : { key: "COMPETING", label: stageReached ? `Competing in ${stageReached}` : "Competing", stageReached };

      let groupTable: NationalTeamCompetitionEntry["groupTable"];
      const groupStage = stages.find(isGroupStage);
      if (groupStage && participant.groupName) {
        const table = groupStandings(international, edition.id, groupStage.id).find((group) => group.groupName === participant.groupName);
        if (table)
          groupTable = {
            name: participant.groupName,
            advanceCount: groupStage.teamsToAdvance,
            rows: table.rows.map((row) => ({
              team: profileName.get(row.teamProfileId) ?? "Unknown team",
              isThisTeam: row.teamProfileId === own.id,
              played: row.played,
              won: row.won,
              drawn: row.drawn,
              lost: row.lost,
              goalsFor: row.goalsFor,
              goalsAgainst: row.goalsAgainst,
              goalDifference: row.goalDifference,
              points: row.points,
            })),
          };
      }

      const knockout: NationalTeamKnockoutRound[] = stages
        .filter((stage) => !isGroupStage(stage))
        .flatMap((stage) => {
          const roundMatches = matches.filter((match) => match.stage === stage.name);
          return roundMatches.length > 0 ? [{ round: stage.name, matches: roundMatches }] : [];
        });

      const campaign = campaigns.find((item) => item.competitionEditionId === edition.id);
      const registration = registrations.find((item) => item.competitionEditionId === edition.id);
      let registrationView: NationalTeamRegistrationView | undefined;
      if (registration) {
        standing ??= nationalTeamPoolStanding(db, teamId, asOf);
        const ids = registration.finalPlayerIds ?? registration.provisionalPlayerIds;
        const first = stages[0];
        registrationView = {
          status: registration.status,
          locked: registration.status !== "PROVISIONAL",
          deadline: registration.registrationDeadline,
          playerCount: ids.length,
          limits: first
            ? { preliminary: first.preliminarySquadSize, final: first.finalSquadSize, matchday: first.matchdaySquadSize }
            : undefined,
          players: ids.map((id) => {
            const row = standing!.get(id);
            return {
              player: buildEntityReference(db, "PLAYER", id, ROLE),
              position: row?.position,
              eligibility: row?.eligibility ?? "NOT_IN_POOL",
              availability: row?.availability ?? "AVAILABLE",
            };
          }),
        };
      }

      const hostNames = edition.hostCountryIds.flatMap((id) => {
        const row = db.prepare("SELECT name FROM countries WHERE id=?").get(id) as { name?: string } | undefined;
        return row?.name ? [row.name] : [];
      });

      return [
        {
          editionId: edition.id,
          competition: competition?.name ?? edition.name,
          edition: edition.name,
          cycle: edition.cycle,
          competitionType: competition?.competitionType ?? "UNKNOWN",
          confederation: competition?.confederation,
          region: competition?.region,
          hosts: hostNames,
          status: edition.status,
          startDate: edition.startDate,
          endDate: edition.endDate,
          entryStatus: participant.entryStatus,
          group: participant.groupName,
          outcome,
          qualificationSource: participant.qualificationSource,
          qualificationLinks: edition.qualificationLinks
            .filter((link) => link.toCompetitionEditionId === edition.id)
            .map((link) => ({
              fromEdition: editions.get(link.fromCompetitionEditionId)?.name ?? "Unknown competition",
              condition: link.qualificationCondition,
              slots: link.slots,
            })),
          stages: stages.map((stage) => ({
            name: stage.name,
            order: stage.stageOrder,
            format: stage.formatType,
            groupCount: stage.groupCount,
            teamsToAdvance: stage.teamsToAdvance,
            legs: stage.legs,
            extraTime: stage.allowExtraTime,
            penalties: stage.allowPenalties,
          })),
          groupTable,
          knockout,
          matches,
          nextMatch: matches.filter((match) => match.status === "SCHEDULED")[0],
          campaign: campaign
            ? {
                name: campaign.name,
                startedOn: campaign.startedOn,
                matchesPlayed: campaign.matchesPlayed,
                wins: campaign.wins,
                draws: campaign.draws,
                losses: campaign.losses,
                qualificationStatus: campaign.qualificationStatus,
              }
            : undefined,
          registration: registrationView,
          onDutyCount: duties.filter((duty) => duty.competitionEditionId === edition.id).length,
          simulatedAhead: matches.some((match) => match.simulatedAhead === true),
        },
      ];
    });

  const completed = entries.filter((entry) => entry.status === "COMPLETED");
  const open = entries.filter((entry) => entry.status !== "COMPLETED");
  return {
    team,
    active: open.filter((entry) => entry.outcome.key !== "NOT_STARTED").sort((a, b) => a.startDate.localeCompare(b.startDate)),
    upcoming: open.filter((entry) => entry.outcome.key === "NOT_STARTED").sort((a, b) => a.startDate.localeCompare(b.startDate)),
    completed: completed.sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, COMPLETED_LIMIT),
    asOf,
    provenanceStatus: "SIMULATION_ONLY",
  };
};
