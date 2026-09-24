import {
  FederationGovernanceRepository,
  InternationalFootballRepository,
  NationalTeamManagementRepository,
  type GameDatabase,
} from "@nepal-football-sim/database";
import type {
  EntityId,
  NationalTeamAttentionItem,
  NationalTeamCompetitionContext,
  NationalTeamFixturesView,
  NationalTeamIdentity,
  NationalTeamMatchView,
  NationalTeamOverview,
  NationalTeamStaffMember,
  NationalTeamStaffView,
} from "@nepal-football-sim/shared-types";
import { buildEntityReference } from "./entity-reference.js";
import { buildNationalTeamSquad } from "./national-team-squad.js";

const ROLE = "FEDERATION_PRESIDENT" as const;

const TYPE_LABELS: Record<string, string> = {
  "senior:men": "Senior men",
  "senior:women": "Senior women",
  "u23:men": "Under-23 men",
  "u20:men": "Under-20 men",
  "u17:men": "Under-17 men",
};

const STAFF_ROLE_ORDER = [
  "NATIONAL_TEAM_HEAD_COACH",
  "NATIONAL_TEAM_ASSISTANT",
  "SPORTS_SCIENTIST",
  "NATIONAL_TEAM_PHYSIO",
  "NATIONAL_TEAM_ANALYST",
];

const STAFF_ROLE_LABELS: Record<string, string> = {
  NATIONAL_TEAM_HEAD_COACH: "Head coach",
  NATIONAL_TEAM_ASSISTANT: "Assistant coach",
  SPORTS_SCIENTIST: "Performance coach",
  NATIONAL_TEAM_PHYSIO: "Medical lead",
  NATIONAL_TEAM_ANALYST: "Analyst",
};

/** Whether the id is a national team of this federation (a team with no club). */
export const isFederationNationalTeam = (db: GameDatabase, teamId: EntityId, federationId: EntityId): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 FROM teams WHERE id=? AND federation_id=? AND club_id IS NULL")
      .get(teamId, federationId),
  );

export const nationalTeamIdentity = (db: GameDatabase, teamId: EntityId): NationalTeamIdentity => {
  const team = db
    .prepare(
      "SELECT t.id, t.name, t.level, t.gender, t.federation_id, f.name AS federation_name FROM teams t JOIN federations f ON f.id=t.federation_id WHERE t.id=? AND t.club_id IS NULL",
    )
    .get(teamId) as
    | { id: EntityId; name: string; level: string; gender: string; federation_id: EntityId; federation_name: string }
    | undefined;
  if (!team) throw new Error("National team not found");
  return {
    id: team.id,
    name: team.name,
    level: team.level,
    gender: team.gender,
    programme: team.gender === "women" ? "WOMENS_GIRLS" : team.level === "senior" ? "SENIOR_MENS" : "YOUTH",
    typeLabel: TYPE_LABELS[`${team.level}:${team.gender}`] ?? `${team.level} ${team.gender}`,
    federation: { id: team.federation_id, name: team.federation_name },
  };
};

const venueName = (db: GameDatabase, venueId?: EntityId): string | undefined =>
  venueId
    ? ((db.prepare("SELECT name FROM venues WHERE id=?").get(venueId) as { name?: string } | undefined)?.name ?? undefined)
    : undefined;

/**
 * Every recorded match of a national team, from the team's own perspective.
 * Competition matches come from the international match record (which states
 * home, away or neutral); friendlies come from the federation's fixture record
 * (where the national side's goals are stored first). A federation fixture that
 * mirrors a competition match is dropped, so nothing appears twice.
 */
export const nationalTeamMatches = (db: GameDatabase, teamId: EntityId): NationalTeamMatchView[] => {
  const international = new InternationalFootballRepository(db);
  const profiles = international.teamProfiles();
  const own = profiles.find((profile) => profile.nationalTeamId === teamId);
  const profileName = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const editions = new Map(international.editions().map((edition) => [edition.id, edition]));
  const stages = new Map(international.stages().map((stage) => [stage.id, stage]));
  const views: NationalTeamMatchView[] = [];

  if (own) {
    for (const match of international.matches()) {
      const isHome = match.homeTeamProfileId === own.id;
      if (!isHome && match.awayTeamProfileId !== own.id) continue;
      const played = match.status === "PLAYED";
      const goalsFor = played ? (isHome ? match.homeGoals : match.awayGoals) : undefined;
      const goalsAgainst = played ? (isHome ? match.awayGoals : match.homeGoals) : undefined;
      const result: NationalTeamMatchView["result"] =
        !played || goalsFor === undefined || goalsAgainst === undefined
          ? undefined
          : match.winnerTeamProfileId
            ? match.winnerTeamProfileId === own.id
              ? "WIN"
              : "LOSS"
            : goalsFor > goalsAgainst
              ? "WIN"
              : goalsFor < goalsAgainst
                ? "LOSS"
                : "DRAW";
      views.push({
        id: match.id,
        date: match.matchDate,
        opponent: profileName.get(isHome ? match.awayTeamProfileId : match.homeTeamProfileId) ?? "Unknown opponent",
        kind: match.importance,
        competition: match.editionId ? editions.get(match.editionId)?.name : undefined,
        stage: match.stageId ? stages.get(match.stageId)?.name : undefined,
        group: match.groupName,
        venueSide: match.neutralVenue ? "NEUTRAL" : isHome ? "HOME" : "AWAY",
        venue: venueName(db, match.venueId),
        status: match.status,
        goalsFor,
        goalsAgainst,
        result,
        penaltiesFor: match.penaltiesPlayed ? (isHome ? match.homePenaltyGoals : match.awayPenaltyGoals) : undefined,
        penaltiesAgainst: match.penaltiesPlayed ? (isHome ? match.awayPenaltyGoals : match.homePenaltyGoals) : undefined,
      });
    }
  }

  const seen = new Set(views.map((view) => `${view.date}:${view.opponent}`));
  for (const fixture of new FederationGovernanceRepository(db).nationalTeamFixtures(teamId)) {
    if (seen.has(`${fixture.fixtureDate}:${fixture.opponentName}`)) continue;
    const played = fixture.status === "PLAYED";
    const goalsFor = played ? fixture.homeGoals : undefined;
    const goalsAgainst = played ? fixture.awayGoals : undefined;
    views.push({
      id: fixture.id,
      date: fixture.fixtureDate,
      opponent: fixture.opponentName,
      kind: fixture.fixtureType,
      venueSide: "NOT_RECORDED",
      venue: venueName(db, fixture.venueId),
      status: fixture.status,
      goalsFor,
      goalsAgainst,
      result:
        goalsFor === undefined || goalsAgainst === undefined
          ? undefined
          : goalsFor > goalsAgainst
            ? "WIN"
            : goalsFor < goalsAgainst
              ? "LOSS"
              : "DRAW",
    });
  }
  return views;
};

const upcomingFirst = (a: NationalTeamMatchView, b: NationalTeamMatchView): number =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const latestFirst = (a: NationalTeamMatchView, b: NationalTeamMatchView): number =>
  b.date.localeCompare(a.date) || a.id.localeCompare(b.id);

export const buildNationalTeamFixtures = (db: GameDatabase, teamId: EntityId, asOf: string): NationalTeamFixturesView => {
  const matches = nationalTeamMatches(db, teamId);
  return {
    team: nationalTeamIdentity(db, teamId),
    upcoming: matches.filter((match) => match.status === "SCHEDULED").sort(upcomingFirst),
    results: matches.filter((match) => match.status !== "SCHEDULED").sort(latestFirst),
    asOf,
    provenanceStatus: "SIMULATION_ONLY",
  };
};

export const buildNationalTeamStaff = (db: GameDatabase, teamId: EntityId): NationalTeamStaffView => {
  const rows = db
    .prepare(
      `SELECT sa.person_id, sa.role, sa.start_date, c.contract_end
       FROM staff_appointments sa
       LEFT JOIN staff_employment_contracts c ON c.appointment_id = sa.id AND c.status = 'ACTIVE'
       WHERE sa.team_id = ? AND sa.employment_status = 'ACTIVE'
       ORDER BY sa.start_date, sa.id`,
    )
    .all(teamId) as Array<{ person_id: EntityId; role: string; start_date: string; contract_end?: string | null }>;
  const orderOf = (role: string): number => {
    const index = STAFF_ROLE_ORDER.indexOf(role);
    return index === -1 ? STAFF_ROLE_ORDER.length : index;
  };
  const members: NationalTeamStaffMember[] = rows
    .map((row) => ({
      person: buildEntityReference(db, "STAFF", row.person_id, ROLE),
      role: row.role,
      roleLabel: STAFF_ROLE_LABELS[row.role] ?? row.role,
      startDate: row.start_date,
      contractEnd: row.contract_end ?? undefined,
    }))
    .sort((a, b) => orderOf(a.role) - orderOf(b.role) || a.person.label.localeCompare(b.person.label));
  return {
    team: nationalTeamIdentity(db, teamId),
    members,
    headCoachVacant: !members.some((member) => member.role === "NATIONAL_TEAM_HEAD_COACH"),
    provenanceStatus: "SIMULATION_ONLY",
  };
};

const competitionContexts = (db: GameDatabase, teamId: EntityId): NationalTeamCompetitionContext[] => {
  const international = new InternationalFootballRepository(db);
  const own = international.teamProfiles().find((profile) => profile.nationalTeamId === teamId);
  if (!own) return [];
  const editions = new Map(international.editions().map((edition) => [edition.id, edition]));
  const campaigns = new NationalTeamManagementRepository(db).campaigns(teamId);
  return international
    .participants()
    .filter((participant) => participant.teamProfileId === own.id)
    .flatMap((participant) => {
      const edition = editions.get(participant.editionId);
      if (!edition) return [];
      const campaign = campaigns.find((item) => item.competitionEditionId === edition.id);
      return [
        {
          edition: edition.name,
          status: edition.status,
          startDate: edition.startDate,
          endDate: edition.endDate,
          entryStatus: participant.entryStatus,
          group: participant.groupName,
          campaign: campaign
            ? {
                name: campaign.name,
                matchesPlayed: campaign.matchesPlayed,
                wins: campaign.wins,
                draws: campaign.draws,
                losses: campaign.losses,
                qualificationStatus: campaign.qualificationStatus,
              }
            : undefined,
        },
      ];
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.edition.localeCompare(b.edition))
    .slice(0, 6);
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export const buildNationalTeamOverview = (db: GameDatabase, teamId: EntityId, asOf: string): NationalTeamOverview => {
  const team = nationalTeamIdentity(db, teamId);
  const staff = buildNationalTeamStaff(db, teamId);
  const squad = buildNationalTeamSquad(db, teamId, asOf, ROLE);
  const matches = nationalTeamMatches(db, teamId);
  const nextMatch = matches.filter((match) => match.status === "SCHEDULED").sort(upcomingFirst)[0];
  const recent = matches.filter((match) => match.status === "PLAYED").sort(latestFirst).slice(0, 5);

  const decision = new NationalTeamManagementRepository(db)
    .decisions(teamId)
    .filter((item) => item.status === "ACTIVE" && item.decisionDate <= asOf)
    .sort((a, b) => b.decisionDate.localeCompare(a.decisionDate) || b.id.localeCompare(a.id))[0];
  const captain = decision?.captainPlayerId
    ? squad.players.find((player) => player.personId === decision.captainPlayerId)?.player
    : undefined;

  const attention: NationalTeamAttentionItem[] = [];
  if (staff.headCoachVacant) attention.push({ key: "coach", text: "No head coach is recorded for this team", target: "staff" });
  if (squad.players.length === 0)
    attention.push({
      key: "squad",
      text: nextMatch ? "A match is scheduled and no squad has been called up" : "No squad has been called up",
      target: "squad",
    });
  else if (squad.unavailableCount > 0)
    attention.push({
      key: "availability",
      text: `${squad.unavailableCount} called-up ${squad.unavailableCount === 1 ? "player is" : "players are"} injured or suspended`,
      target: "squad",
    });
  if (nextMatch && daysBetween(asOf, nextMatch.date) >= 0 && daysBetween(asOf, nextMatch.date) <= 14)
    attention.push({ key: "match", text: `Next match: ${nextMatch.opponent} on ${nextMatch.date}`, target: "fixtures" });

  return {
    team,
    headCoach: squad.headCoach,
    staffCount: staff.members.length,
    squad: {
      squadSize: squad.squadSize,
      selectedCount: squad.selectedCount,
      unavailableCount: squad.unavailableCount,
      captain,
      currentWindow: squad.currentWindow?.callupDate,
    },
    nextMatch,
    recent,
    competitions: competitionContexts(db, teamId),
    attention,
    asOf,
    provenanceStatus: "SIMULATION_ONLY",
  };
};
