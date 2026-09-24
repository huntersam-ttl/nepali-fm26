import React, { useState } from "react";
import type {
  EntityId,
  EntityReference,
  EntityReferenceType,
  FederationPresidentDashboard,
  NationalTeamAttentionItem,
  NationalTeamFixturesView,
  NationalTeamMatchView,
  NationalTeamOverview,
  NationalTeamSquadReadModel,
  NationalTeamStaffView,
} from "@nepal-football-sim/shared-types";
import type { DesktopRuntimeApi } from "../../appBridge.js";
import { EntityRefLink } from "../RoleDetailScreen.js";
import { humanizeToken } from "../storyHumanizer.js";
import { AsyncPanel, Badge, Metrics, Panel, useRuntimeData } from "../ui.js";
import { getSelectedNationalTeam, resolveNationalTeam, selectNationalTeam } from "./nationalTeamSelection.js";

/**
 * Phase 10A — the national-team workspace for the Federation President.
 *
 * Read-only. Everything is recorded state read from the runtime: identity,
 * staff, squad, matches and competition context. There is no selection, call-up
 * or appointment control here, so nothing on these screens can change a team.
 * Matches are shown from the team's own perspective, and home or away is stated
 * only where the record says it. Hidden simulation values are never shown.
 */

export type NationalTeamScreen =
  | "national-team-overview"
  | "national-team-squad"
  | "national-team-staff"
  | "national-team-fixtures";

export type NationalTeamTarget = NationalTeamScreen | "national-teams" | "federation-overview";

type Teams = FederationPresidentDashboard["nationalTeams"];
type Team = Teams[number];

type Common = {
  teams: Teams;
  bridge: DesktopRuntimeApi;
  onNavigate: (target: NationalTeamTarget) => void;
  onOpenEntity?: (entityType: EntityReferenceType, entityId: EntityId) => void;
};

export const NATIONAL_TEAM_SCREENS: Array<{ id: NationalTeamScreen; label: string }> = [
  { id: "national-team-overview", label: "Team overview" },
  { id: "national-team-squad", label: "Squad" },
  { id: "national-team-staff", label: "Staff" },
  { id: "national-team-fixtures", label: "Fixtures" },
];

const VENUE_SIDE_LABEL: Record<NationalTeamMatchView["venueSide"], string> = {
  HOME: "Home",
  AWAY: "Away",
  NEUTRAL: "Neutral venue",
  NOT_RECORDED: "Not recorded",
};

const RESULT_LABEL = { WIN: "Win", DRAW: "Draw", LOSS: "Loss" } as const;
const RESULT_TONE = { WIN: "ok", DRAW: "info", LOSS: "bad" } as const;

export const teamKind = (team: Pick<Team, "level" | "gender">): string =>
  team.gender === "women" ? "Women & girls" : team.level === "senior" ? "Senior men" : `Youth · ${team.level.toUpperCase()}`;

export const scoreText = (match: Pick<NationalTeamMatchView, "goalsFor" | "goalsAgainst" | "penaltiesFor" | "penaltiesAgainst">): string => {
  if (match.goalsFor === undefined || match.goalsAgainst === undefined) return "—";
  const penalties =
    match.penaltiesFor !== undefined && match.penaltiesAgainst !== undefined
      ? ` (${match.penaltiesFor}–${match.penaltiesAgainst} on penalties)`
      : "";
  return `${match.goalsFor}–${match.goalsAgainst}${penalties}`;
};

export const matchCompetition = (match: Pick<NationalTeamMatchView, "kind" | "competition" | "stage" | "group">): string =>
  [match.competition ?? humanizeToken(match.kind), match.stage, match.group].filter(Boolean).join(" · ");

/** The team selector and the family navigation shared by every national-team screen. */
const Frame = ({
  teams,
  current,
  onNavigate,
  children,
}: Pick<Common, "teams" | "onNavigate"> & {
  current: NationalTeamScreen;
  children: (team: Team) => React.ReactNode;
}): React.ReactElement => {
  const [, setVersion] = useState(0);
  const team = resolveNationalTeam(teams, getSelectedNationalTeam());
  if (!team) return <p className="empty-state">No national teams are recorded for this federation.</p>;
  return (
    <section className="role-detail">
      <div className="button-row">
        <nav aria-label="National team sections" className="button-row">
          <button className="ghost small" onClick={() => onNavigate("national-teams")}>
            All teams
          </button>
          {NATIONAL_TEAM_SCREENS.map((item) => (
            <button
              key={item.id}
              className={item.id === current ? "primary small" : "ghost small"}
              aria-current={item.id === current ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {teams.length > 1 && (
          <label>
            National team{" "}
            <select
              value={team.id}
              onChange={(event) => {
                selectNationalTeam(event.target.value as EntityId);
                setVersion((value) => value + 1);
              }}
            >
              {teams.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({teamKind(option)})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {children(team)}
    </section>
  );
};

const EntityLink = ({
  reference,
  onOpenEntity,
}: {
  reference: EntityReference;
  onOpenEntity?: Common["onOpenEntity"];
}): React.ReactElement => (
  <EntityRefLink reference={reference} onOpen={(ref) => onOpenEntity?.(ref.entityType, ref.id)} />
);

/** The national-teams list. Opening a team goes to its workspace. */
export const NationalTeamsHub = ({
  teams,
  onNavigate,
}: Pick<Common, "teams" | "onNavigate">): React.ReactElement => (
  <section className="role-detail">
    {teams.length === 0 ? (
      <p className="empty-state">No national teams are recorded for this federation.</p>
    ) : (
      <div className="facility-lifecycle-grid">
        {teams.map((team) => (
          <article key={team.id} className="facility-project-card">
            <header>
              <strong>{team.name}</strong>
              <Badge tone="info">{teamKind(team)}</Badge>
            </header>
            <p className="subtle">Coach: {team.headCoach ?? "Not recorded"}</p>
            <Metrics
              items={[
                { label: "Squad", value: team.squadSize },
                {
                  label: "Next fixture",
                  value: team.nextFixture ? `${team.nextFixture.opponent} · ${team.nextFixture.date}` : "None scheduled",
                },
                {
                  label: "Recent result",
                  value: team.recentResult ? `${team.recentResult.opponent} ${team.recentResult.result}` : "No result recorded",
                },
              ]}
            />
            <button
              className="link"
              aria-label={`Open ${team.name} (${teamKind(team)})`}
              onClick={() => {
                selectNationalTeam(team.id);
                onNavigate("national-team-overview");
              }}
            >
              Open team workspace
            </button>
          </article>
        ))}
      </div>
    )}
  </section>
);

const MatchTable = ({ caption, matches, empty }: { caption: string; matches: NationalTeamMatchView[]; empty: string }): React.ReactElement =>
  matches.length === 0 ? (
    <p className="empty-state">{empty}</p>
  ) : (
    <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Opponent</th>
            <th scope="col">Competition</th>
            <th scope="col">Venue</th>
            <th scope="col">Status</th>
            <th scope="col">Score</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.id}>
              <th scope="row">{match.date}</th>
              <td>{match.opponent}</td>
              <td>{matchCompetition(match)}</td>
              <td>
                {VENUE_SIDE_LABEL[match.venueSide]}
                {match.venue ? ` · ${match.venue}` : ""}
              </td>
              <td>{humanizeToken(match.status)}</td>
              <td>{scoreText(match)}</td>
              <td>{match.result ? <Badge tone={RESULT_TONE[match.result]}>{RESULT_LABEL[match.result]}</Badge> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

const attentionLabel = (target: NationalTeamAttentionItem["target"]): string =>
  target === "squad" ? "Open Squad" : target === "staff" ? "Open Staff" : "Open Fixtures";

export const NationalTeamOverviewScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-overview" onNavigate={props.onNavigate}>
    {(team) => <OverviewBody teamId={team.id} {...props} />}
  </Frame>
);

const OverviewBody = ({
  teamId,
  bridge,
  onNavigate,
  onOpenEntity,
}: Common & { teamId: EntityId }): React.ReactElement => {
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamOverview
        ? bridge.getNationalTeamOverview(teamId)
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "The national team is unavailable right now." },
          }),
    [teamId],
  );
  return (
    <AsyncPanel state={state}>
      {(overview: NationalTeamOverview) => (
        <>
          <Panel title={overview.team.name} className="panel-wide">
            <Metrics
              items={[
                { label: "Team type", value: overview.team.typeLabel },
                { label: "Federation", value: overview.team.federation.name },
                {
                  label: "Head coach",
                  value: overview.headCoach ? <EntityLink reference={overview.headCoach} onOpenEntity={onOpenEntity} /> : "Vacant",
                },
                { label: "Staff", value: overview.staffCount },
              ]}
            />
            <p className="subtle">
              <Badge tone="info">simulated</Badge> Squads, matches and competitions are generated by the simulation.
            </p>
            <div className="button-row">
              <button className="ghost small" onClick={() => onNavigate("federation-overview")}>
                Back to Federation Overview
              </button>
            </div>
          </Panel>

          <Panel title="Needs attention" className="panel-wide">
            {overview.attention.length === 0 ? (
              <p className="empty-state">Nothing currently needs attention for this team.</p>
            ) : (
              <ul className="report-list">
                {overview.attention.map((item) => (
                  <li key={item.key}>
                    {item.text}{" "}
                    <button className="ghost small" onClick={() => onNavigate(`national-team-${item.target}` as NationalTeamScreen)}>
                      {attentionLabel(item.target)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Squad summary" className="panel-wide">
            <Metrics
              items={[
                { label: "Called up", value: overview.squad.squadSize },
                { label: "Selected", value: overview.squad.selectedCount },
                { label: "Unavailable", value: overview.squad.unavailableCount },
                {
                  label: "Captain",
                  value: overview.squad.captain ? <EntityLink reference={overview.squad.captain} onOpenEntity={onOpenEntity} /> : "Not recorded",
                },
                ...(overview.squad.currentWindow ? [{ label: "Current window", value: overview.squad.currentWindow }] : []),
              ]}
            />
          </Panel>

          <Panel title="Next match" className="panel-wide">
            <MatchTable caption="Next national-team match" matches={overview.nextMatch ? [overview.nextMatch] : []} empty="No match is scheduled." />
          </Panel>

          <Panel title="Recent results" className="panel-wide">
            <MatchTable caption="Recent national-team results" matches={overview.recent} empty="No results are recorded yet." />
          </Panel>

          <Panel title="Competitions" className="panel-wide">
            {overview.competitions.length === 0 ? (
              <p className="empty-state">This team is not entered in a recorded competition.</p>
            ) : (
              <div className="table-scroll" role="region" aria-label="National-team competitions" tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Competitions this national team is entered in</caption>
                  <thead>
                    <tr>
                      <th scope="col">Competition</th>
                      <th scope="col">Status</th>
                      <th scope="col">Dates</th>
                      <th scope="col">Entry</th>
                      <th scope="col">Group</th>
                      <th scope="col">Campaign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.competitions.map((item) => (
                      <tr key={`${item.edition}-${item.startDate}`}>
                        <th scope="row">{item.edition}</th>
                        <td>{humanizeToken(item.status)}</td>
                        <td>
                          {item.startDate} – {item.endDate}
                        </td>
                        <td>{item.entryStatus ? humanizeToken(item.entryStatus) : "—"}</td>
                        <td>{item.group ?? "—"}</td>
                        <td>
                          {item.campaign
                            ? `${item.campaign.wins}W ${item.campaign.draws}D ${item.campaign.losses}L (${item.campaign.matchesPlayed} played) · ${humanizeToken(item.campaign.qualificationStatus)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </AsyncPanel>
  );
};

const AVAILABILITY_TONE = { AVAILABLE: "ok", INJURED: "bad", SUSPENDED: "warn", UNAVAILABLE: "info" } as const;

export const NationalTeamSquadScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-squad" onNavigate={props.onNavigate}>
    {(team) => <SquadBody teamId={team.id} {...props} />}
  </Frame>
);

const SquadBody = ({ teamId, bridge, onOpenEntity }: Common & { teamId: EntityId }): React.ReactElement => {
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamSquad
        ? bridge.getNationalTeamSquad(teamId)
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "National-team squads are unavailable right now." },
          }),
    [teamId],
  );
  return (
    <AsyncPanel state={state}>
      {(squad: NationalTeamSquadReadModel) =>
        !squad.supported ? (
          <p className="empty-state">{squad.unsupportedReason ?? "This national team's squad is not available."}</p>
        ) : (
          <>
            <Panel title="Squad" className="panel-wide">
              <Metrics
                items={[
                  { label: "Called up", value: squad.squadSize },
                  { label: "Selected", value: squad.selectedCount },
                  { label: "Unavailable", value: squad.unavailableCount },
                  {
                    label: "Head coach",
                    value: squad.headCoach ? <EntityLink reference={squad.headCoach} onOpenEntity={onOpenEntity} /> : "Vacant",
                  },
                  { label: "As of", value: squad.asOf },
                ]}
              />
              {squad.players.length === 0 ? (
                <p className="empty-state">No players are currently called up to this team.</p>
              ) : (
                <div className="table-scroll" role="region" aria-label="Called-up players" tabIndex={0}>
                  <table>
                    <caption className="visually-hidden">Players called up to this national team</caption>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">Position</th>
                        <th scope="col">Age</th>
                        <th scope="col">Club</th>
                        <th scope="col">Squad type</th>
                        <th scope="col">Status</th>
                        <th scope="col">Availability</th>
                        <th scope="col">Caps</th>
                        <th scope="col">Called up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {squad.players.map((player) => (
                        <tr key={player.personId}>
                          <th scope="row">
                            <EntityLink reference={player.player} onOpenEntity={onOpenEntity} />
                          </th>
                          <td>{player.position ? humanizeToken(player.position) : "—"}</td>
                          <td>{player.age ?? "—"}</td>
                          <td>
                            {player.currentClub ? <EntityLink reference={player.currentClub} onOpenEntity={onOpenEntity} /> : "Unattached"}
                          </td>
                          <td>{humanizeToken(player.squadType)}</td>
                          <td>{humanizeToken(player.selectionStatus)}</td>
                          <td>
                            <Badge tone={AVAILABILITY_TONE[player.availability]}>{humanizeToken(player.availability)}</Badge>
                          </td>
                          <td>{player.internationalAppearances}</td>
                          <td>{player.callupDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="subtle">
                Squads are chosen by the simulation from the eligible players. Selection cannot be changed from this
                screen.
              </p>
            </Panel>

            <Panel title="Clubs represented" className="panel-wide">
              {squad.clubDistribution.length === 0 ? (
                <p className="empty-state">No clubs are represented yet.</p>
              ) : (
                <ul className="compact-list">
                  {squad.clubDistribution.map((entry, index) => (
                    <li key={entry.club?.id ?? `unattached-${index}`}>
                      {entry.club ? <EntityLink reference={entry.club} onOpenEntity={onOpenEntity} /> : "Unattached"} · {entry.count}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Recent call-ups" className="panel-wide">
              {squad.selectionHistory.length === 0 ? (
                <p className="empty-state">No call-ups are recorded.</p>
              ) : (
                <div className="table-scroll" role="region" aria-label="Recent call-ups" tabIndex={0}>
                  <table>
                    <caption className="visually-hidden">Recent national-team call-ups</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Player</th>
                        <th scope="col">Status</th>
                        <th scope="col">Appearance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {squad.selectionHistory.slice(0, 20).map((entry) => (
                        <tr key={entry.id}>
                          <th scope="row">{entry.callupDate}</th>
                          <td>
                            <EntityLink reference={entry.player} onOpenEntity={onOpenEntity} />
                          </td>
                          <td>{humanizeToken(entry.selectionStatus)}</td>
                          <td>
                            {entry.appearance
                              ? `vs ${entry.appearance.opponent} · ${entry.appearance.minutes} min · ${entry.appearance.goals} goal${entry.appearance.goals === 1 ? "" : "s"}`
                              : "Did not play"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )
      }
    </AsyncPanel>
  );
};

export const NationalTeamStaffScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-staff" onNavigate={props.onNavigate}>
    {(team) => <StaffBody teamId={team.id} {...props} />}
  </Frame>
);

const StaffBody = ({ teamId, bridge, onOpenEntity }: Common & { teamId: EntityId }): React.ReactElement => {
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamStaff
        ? bridge.getNationalTeamStaff(teamId)
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "National-team staff are unavailable right now." },
          }),
    [teamId],
  );
  return (
    <AsyncPanel state={state}>
      {(view: NationalTeamStaffView) => (
        <Panel title="Staff" className="panel-wide">
          {view.headCoachVacant && (
            <p className="warning" role="status">
              This team has no head coach. Appointing one is not available from this screen yet.
            </p>
          )}
          {view.members.length === 0 ? (
            <p className="empty-state">No staff are recorded for this team.</p>
          ) : (
            <div className="table-scroll" role="region" aria-label="National-team staff" tabIndex={0}>
              <table>
                <caption className="visually-hidden">Current staff of this national team</caption>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Person</th>
                    <th scope="col">Since</th>
                    <th scope="col">Contract ends</th>
                  </tr>
                </thead>
                <tbody>
                  {view.members.map((member) => (
                    <tr key={`${member.role}-${member.person.id}`}>
                      <th scope="row">{member.roleLabel}</th>
                      <td>
                        <EntityLink reference={member.person} onOpenEntity={onOpenEntity} />
                      </td>
                      <td>{member.startDate}</td>
                      <td>{member.contractEnd ?? "No contract end recorded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="subtle">
            <Badge tone="info">simulated</Badge> Staff appointments are generated by the simulation.
          </p>
        </Panel>
      )}
    </AsyncPanel>
  );
};

export const NationalTeamFixturesScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-fixtures" onNavigate={props.onNavigate}>
    {(team) => <FixturesBody teamId={team.id} {...props} />}
  </Frame>
);

const FixturesBody = ({ teamId, bridge }: Common & { teamId: EntityId }): React.ReactElement => {
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamFixtures
        ? bridge.getNationalTeamFixtures(teamId)
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "National-team fixtures are unavailable right now." },
          }),
    [teamId],
  );
  return (
    <AsyncPanel state={state}>
      {(view: NationalTeamFixturesView) => (
        <>
          <Panel title="Upcoming matches" className="panel-wide">
            <MatchTable caption="Upcoming national-team matches" matches={view.upcoming} empty="No matches are scheduled." />
          </Panel>
          <Panel title="Results" className="panel-wide">
            <MatchTable caption="National-team results" matches={view.results} empty="No results are recorded yet." />
            <p className="subtle">
              <Badge tone="info">simulated</Badge> Matches are played by the simulation. Scores are shown from this
              team&rsquo;s side.
            </p>
          </Panel>
        </>
      )}
    </AsyncPanel>
  );
};
