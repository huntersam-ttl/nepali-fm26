import React, { useState } from "react";
import type {
  EntityId,
  EntityReference,
  EntityReferenceType,
  FederationPresidentDashboard,
  NationalTeamAttentionItem,
  NationalTeamFixturesView,
  NationalTeamCoachCandidate,
  NationalTeamCoachCandidatesView,
  NationalTeamCompetitionEntry,
  NationalTeamCompetitionsView,
  NationalTeamMatchView,
  NationalTeamOverview,
  NationalTeamPlayerPool,
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
 * Recorded state read from the runtime: identity, staff, squad, player pool,
 * matches and competition context. The one thing the President decides here is
 * the head-coach seat, when it is vacant. Squad selection, friendlies and match
 * play belong to the simulation, so there is no control for them.
 * Matches are shown from the team's own perspective, and home or away is stated
 * only where the record says it. Hidden simulation values are never shown.
 */

export type NationalTeamScreen =
  | "national-team-overview"
  | "national-team-squad"
  | "national-team-pool"
  | "national-team-staff"
  | "national-team-fixtures"
  | "national-team-competitions";

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
  { id: "national-team-pool", label: "Player pool" },
  { id: "national-team-staff", label: "Staff" },
  { id: "national-team-fixtures", label: "Fixtures" },
  { id: "national-team-competitions", label: "Competitions" },
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
              <td>
                {humanizeToken(match.status)}
                {match.simulatedAhead && (
                  <>
                    {" "}
                    <Badge tone="info">Simulated ahead of its date</Badge>
                  </>
                )}
              </td>
              <td>{scoreText(match)}</td>
              <td>
                {match.result ? <Badge tone={RESULT_TONE[match.result]}>{RESULT_LABEL[match.result]}</Badge> : "—"}
                {match.result &&
                  match.result !== "DRAW" &&
                  match.goalsFor === match.goalsAgainst &&
                  match.penaltiesFor === undefined && <span className="subtle"> Level after play — winner recorded</span>}
              </td>
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
            <div className="button-row">
              <button className="ghost small" onClick={() => onNavigate("national-team-competitions")}>
                Open Competitions
              </button>
            </div>
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
                      <th scope="col">Squad registration</th>
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
                        <td>
                          {item.registration
                            ? `${humanizeToken(item.registration.status)} · ${item.registration.locked ? "Locked" : "Open"} · ${item.registration.playerCount} players`
                            : "Not recorded"}
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

const SquadBody = ({ teamId, bridge, onOpenEntity, onNavigate }: Common & { teamId: EntityId }): React.ReactElement => {
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
                screen.{" "}
                <button className="link" onClick={() => onNavigate("national-team-pool")}>
                  See who is eligible in the player pool
                </button>
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

const ELIGIBILITY_TONE = {
  ELIGIBLE: "ok",
  DOCUMENTATION_REQUIRED: "warn",
  CAP_TIED: "bad",
  INELIGIBLE: "bad",
  OVER_AGE: "info",
  SENIOR_SQUAD: "info",
  RETIRED_INTERNATIONAL: "info",
} as const;

export const NationalTeamPoolScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-pool" onNavigate={props.onNavigate}>
    {(team) => <PoolBody teamId={team.id} {...props} />}
  </Frame>
);

const PoolBody = ({ teamId, bridge, onOpenEntity }: Common & { teamId: EntityId }): React.ReactElement => {
  const [position, setPosition] = useState("");
  const [onlyEligible, setOnlyEligible] = useState(true);
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamPlayerPool
        ? bridge.getNationalTeamPlayerPool(teamId, { position: position || undefined, onlyEligible })
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "The player pool is unavailable right now." },
          }),
    [teamId, position, onlyEligible],
  );
  const positions = state.status === "ready" ? state.data.positions : [];
  return (
    <Panel title="Player pool" className="panel-wide">
      <div className="button-row">
        <label>
          Position{" "}
          <select aria-label="Position filter" value={position} onChange={(event) => setPosition(event.target.value)}>
            <option value="">All positions</option>
            {positions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            {position && !positions.includes(position) && <option value={position}>{position}</option>}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyEligible} onChange={(event) => setOnlyEligible(event.target.checked)} /> Eligible
          players only
        </label>
      </div>
      <AsyncPanel state={state}>
        {(pool: NationalTeamPlayerPool) => (
          <>
            <Metrics
              items={[
                { label: "In pool", value: pool.poolCount },
                { label: "Could be selected now", value: pool.selectableCount },
                { label: "Matching this filter", value: pool.matchingCount },
                { label: "As of", value: pool.asOf },
              ]}
            />
            {pool.players.length === 0 ? (
              <p className="empty-state">No players match this filter.</p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Player pool" tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Players who hold this nation's nationality in this team's category</caption>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Position</th>
                      <th scope="col">Age</th>
                      <th scope="col">Club</th>
                      <th scope="col">Eligibility</th>
                      <th scope="col">Availability</th>
                      <th scope="col">Selection</th>
                      <th scope="col">Caps</th>
                      <th scope="col">Goals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pool.players.map((row) => (
                      <tr key={row.player.id}>
                        <th scope="row">
                          <EntityLink reference={row.player} onOpenEntity={onOpenEntity} />
                        </th>
                        <td>{row.position ?? "—"}</td>
                        <td>{row.age ?? "—"}</td>
                        <td>{row.club ? <EntityLink reference={row.club} onOpenEntity={onOpenEntity} /> : "Unattached"}</td>
                        <td>
                          <Badge tone={ELIGIBILITY_TONE[row.eligibility]}>{humanizeToken(row.eligibility)}</Badge>{" "}
                          <span className="subtle">{row.eligibilityNote}</span>
                        </td>
                        <td>
                          <Badge tone={AVAILABILITY_TONE[row.availability]}>{humanizeToken(row.availability)}</Badge>
                        </td>
                        <td>{humanizeToken(row.selection)}</td>
                        <td>{row.caps}</td>
                        <td>{row.goals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pool.matchingCount > pool.players.length && (
              <p className="subtle">
                Showing {pool.players.length} of {pool.matchingCount} matching players — called-up players first. Narrow the
                filter to see the rest.
              </p>
            )}
            <p className="subtle">
              <Badge tone="info">simulated</Badge> The simulation picks each squad from this pool. Selection cannot be changed
              from this screen.
            </p>
          </>
        )}
      </AsyncPanel>
    </Panel>
  );
};

export const NationalTeamStaffScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-staff" onNavigate={props.onNavigate}>
    {(team) => <StaffBody teamId={team.id} {...props} />}
  </Frame>
);

const HeadCoachAppointment = ({
  teamId,
  teamName,
  bridge,
  onOpenEntity,
  onAppointed,
}: Pick<Common, "bridge" | "onOpenEntity"> & {
  teamId: EntityId;
  teamName: string;
  onAppointed: () => void;
}): React.ReactElement => {
  const [pending, setPending] = useState<NationalTeamCoachCandidate | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamCoachCandidates
        ? bridge.getNationalTeamCoachCandidates(teamId)
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "Coach candidates are unavailable right now." },
          }),
    [teamId],
  );
  const confirm = async (): Promise<void> => {
    if (!pending || !bridge.appointNationalTeamHeadCoach) return;
    setBusy(true);
    setFailure(undefined);
    const result = await bridge.appointNationalTeamHeadCoach(teamId, pending.person.id);
    setBusy(false);
    if (result.ok) {
      setPending(undefined);
      onAppointed();
    } else setFailure(result.error.message);
  };
  return (
    <Panel title="Appoint a head coach" className="panel-wide">
      <AsyncPanel state={state}>
        {(view: NationalTeamCoachCandidatesView) =>
          view.candidates.length === 0 ? (
            <p className="empty-state">No eligible, unemployed coaches are available right now.</p>
          ) : (
            <>
              <div className="table-scroll" role="region" aria-label="Head-coach candidates" tabIndex={0}>
                <table>
                  <caption className="visually-hidden">Coaches who could be appointed as head coach</caption>
                  <thead>
                    <tr>
                      <th scope="col">Coach</th>
                      <th scope="col">Nationality</th>
                      <th scope="col">Licence</th>
                      <th scope="col">Preferred role</th>
                      <th scope="col">Availability</th>
                      <th scope="col">Notes</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.candidates.map((candidate) => (
                      <tr key={candidate.person.id}>
                        <th scope="row">
                          <EntityLink reference={candidate.person} onOpenEntity={onOpenEntity} />
                        </th>
                        <td>{candidate.nationality ?? "—"}</td>
                        <td>{candidate.licence ?? "—"}</td>
                        <td>{candidate.preferredRole ? humanizeToken(candidate.preferredRole) : "—"}</td>
                        <td>{humanizeToken(candidate.availability)}</td>
                        <td>{candidate.note ?? "—"}</td>
                        <td>
                          <button
                            className="ghost small"
                            aria-label={`Appoint ${candidate.person.label} as head coach`}
                            onClick={() => {
                              setFailure(undefined);
                              setPending(candidate);
                            }}
                          >
                            Appoint
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pending && (
                <div role="group" aria-label="Confirm head-coach appointment" className="warning">
                  <p>
                    Appoint <strong>{pending.person.label}</strong> as head coach of {teamName}? The appointment takes effect
                    immediately.
                  </p>
                  <div className="button-row">
                    <button className="primary small" disabled={busy} onClick={() => void confirm()}>
                      Confirm appointment
                    </button>
                    <button className="ghost small" disabled={busy} onClick={() => setPending(undefined)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {failure && (
                <p className="warning" role="alert">
                  {failure}
                </p>
              )}
            </>
          )
        }
      </AsyncPanel>
    </Panel>
  );
};

const StaffBody = ({ teamId, bridge, onOpenEntity }: Common & { teamId: EntityId }): React.ReactElement => {
  const [state, refresh] = useRuntimeData(
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
        <>
        <Panel title="Staff" className="panel-wide">
          {view.headCoachVacant && (
            <p className="warning" role="status">
              This team has no head coach. Choose one of the eligible coaches below.
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
            <Badge tone="info">simulated</Badge> The simulation fills the other staff roles. The head-coach seat is yours to
            fill when it is vacant.
          </p>
        </Panel>
        {view.headCoachVacant && (
          <HeadCoachAppointment
            teamId={teamId}
            teamName={view.team.name}
            bridge={bridge}
            onOpenEntity={onOpenEntity}
            onAppointed={refresh}
          />
        )}
        </>
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

const PHASE_TONE = { active: "ok", upcoming: "info", completed: "warn" } as const;
const OUTCOME_TONE = { NOT_STARTED: "info", COMPETING: "ok", ELIMINATED: "bad", CHAMPION: "ok" } as const;
const REGISTRATION_STATUS_LABEL = {
  PROVISIONAL: "Provisional",
  FINAL: "Final",
  REPLACEMENT_WINDOW_CLOSED: "Replacement window closed",
} as const;

const eligibilityLabel = (value: string): string => (value === "NOT_IN_POOL" ? "Not in this team's pool" : humanizeToken(value));

export const NationalTeamCompetitionsScreen = (props: Common): React.ReactElement => (
  <Frame teams={props.teams} current="national-team-competitions" onNavigate={props.onNavigate}>
    {(team) => <CompetitionsBody teamId={team.id} {...props} />}
  </Frame>
);

const CompetitionsBody = ({ teamId, bridge, onOpenEntity }: Common & { teamId: EntityId }): React.ReactElement => {
  const [selectedId, setSelectedId] = useState<EntityId | undefined>();
  const [state] = useRuntimeData(
    () =>
      bridge.getNationalTeamCompetitions
        ? bridge.getNationalTeamCompetitions(teamId)
        : Promise.resolve({
            ok: false as const,
            error: { code: "RUNTIME_UNAVAILABLE" as const, message: "National-team competitions are unavailable right now." },
          }),
    [teamId],
  );
  return (
    <AsyncPanel state={state}>
      {(view: NationalTeamCompetitionsView) => {
        const groups: Array<{ key: "active" | "upcoming" | "completed"; title: string; entries: NationalTeamCompetitionEntry[] }> = [
          { key: "active", title: "Active competitions", entries: view.active },
          { key: "upcoming", title: "Upcoming competitions", entries: view.upcoming },
          { key: "completed", title: "Completed competitions", entries: view.completed },
        ];
        const all = groups.flatMap((group) => group.entries);
        if (all.length === 0)
          return (
            <Panel title="Competitions" className="panel-wide">
              <p className="empty-state">This team is not entered in a recorded competition.</p>
              <p className="subtle">
                <Badge tone="info">simulated</Badge> Competitions appear here once the simulation enters the team in one.
              </p>
            </Panel>
          );
        const selected = all.find((entry) => entry.editionId === selectedId) ?? all[0]!;
        return (
          <>
            {groups.map((group) => (
              <Panel key={group.key} title={group.title} className="panel-wide">
                {group.entries.length === 0 ? (
                  <p className="empty-state">None.</p>
                ) : (
                  <div className="table-scroll" role="region" aria-label={group.title} tabIndex={0}>
                    <table>
                      <caption className="visually-hidden">{group.title} of this national team</caption>
                      <thead>
                        <tr>
                          <th scope="col">Competition</th>
                          <th scope="col">Status</th>
                          <th scope="col">Where the team stands</th>
                          <th scope="col">Dates</th>
                          <th scope="col">Next match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.entries.map((entry) => (
                          <tr key={entry.editionId}>
                            <th scope="row">
                              <button
                                className="link"
                                aria-pressed={entry.editionId === selected.editionId}
                                aria-label={`Show ${entry.edition}`}
                                onClick={() => setSelectedId(entry.editionId)}
                              >
                                {entry.edition}
                              </button>
                            </th>
                            <td>
                              <Badge tone={PHASE_TONE[group.key]}>{humanizeToken(entry.status)}</Badge>
                            </td>
                            <td>
                              <Badge tone={OUTCOME_TONE[entry.outcome.key]}>{entry.outcome.label}</Badge>
                            </td>
                            <td>
                              {entry.startDate} – {entry.endDate}
                            </td>
                            <td>{entry.nextMatch ? `${entry.nextMatch.opponent} · ${entry.nextMatch.date}` : "None scheduled"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ))}
            <CompetitionDetail entry={selected} onOpenEntity={onOpenEntity} />
          </>
        );
      }}
    </AsyncPanel>
  );
};

const CompetitionDetail = ({
  entry,
  onOpenEntity,
}: {
  entry: NationalTeamCompetitionEntry;
  onOpenEntity?: Common["onOpenEntity"];
}): React.ReactElement => {
  const table = entry.groupTable;
  const finished = entry.status === "COMPLETED";
  return (
    <>
      <Panel title={entry.edition} className="panel-wide">
        <Metrics
          items={[
            { label: "Competition", value: entry.competition },
            { label: "Cycle", value: entry.cycle },
            { label: "Format", value: humanizeToken(entry.competitionType) },
            ...(entry.confederation ? [{ label: "Confederation", value: entry.confederation }] : []),
            ...(entry.region ? [{ label: "Region", value: humanizeToken(entry.region) }] : []),
            { label: "Hosts", value: entry.hosts.length > 0 ? entry.hosts.join(", ") : "Not recorded" },
            { label: "Status", value: humanizeToken(entry.status) },
            { label: "Entry", value: humanizeToken(entry.entryStatus) },
            { label: "Group", value: entry.group ?? "Not drawn" },
            { label: "Where the team stands", value: entry.outcome.label },
            { label: "Qualification route", value: entry.qualificationSource ?? "Not recorded" },
          ]}
        />
        {entry.qualificationLinks.length > 0 && (
          <ul className="report-list">
            {entry.qualificationLinks.map((link) => (
              <li key={`${link.fromEdition}-${link.condition}`}>
                {humanizeToken(link.condition)} from {link.fromEdition} · {link.slots} {link.slots === 1 ? "place" : "places"}
              </li>
            ))}
          </ul>
        )}
        <p className="subtle">
          <Badge tone="info">simulated</Badge> Competitions are run by the simulation. Nothing here estimates a team&rsquo;s
          chances.
        </p>
        {entry.simulatedAhead && (
          <p className="subtle" role="note">
            The season simulation has already played matches of this competition. Their dates are the scheduled dates, which
            are after today&rsquo;s date.
          </p>
        )}
      </Panel>

      <Panel title="Stages and squad rules" className="panel-wide">
        <div className="table-scroll" role="region" aria-label="Competition stages" tabIndex={0}>
          <table>
            <caption className="visually-hidden">Stages of this competition and their recorded rules</caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Format</th>
                <th scope="col">Advancing</th>
                <th scope="col">Legs</th>
                <th scope="col">Extra time</th>
                <th scope="col">Penalties</th>
              </tr>
            </thead>
            <tbody>
              {entry.stages.map((stage) => (
                <tr key={stage.order}>
                  <th scope="row">{stage.name}</th>
                  <td>{humanizeToken(stage.format)}</td>
                  <td>{stage.groupCount > 1 ? `${stage.teamsToAdvance} per group` : stage.teamsToAdvance}</td>
                  <td>{stage.legs}</td>
                  <td>{stage.extraTime ? "Yes" : "No"}</td>
                  <td>{stage.penalties ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {table && (
        <Panel title={`Group ${table.name}`} className="panel-wide">
          <div className="table-scroll" role="region" aria-label={`Group ${table.name} table`} tabIndex={0}>
            <table>
              <caption className="visually-hidden">Standings of group {table.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">Team</th>
                  <th scope="col"><abbr title="Played">P</abbr></th>
                  <th scope="col"><abbr title="Won">W</abbr></th>
                  <th scope="col"><abbr title="Drawn">D</abbr></th>
                  <th scope="col"><abbr title="Lost">L</abbr></th>
                  <th scope="col"><abbr title="Goals for">GF</abbr></th>
                  <th scope="col"><abbr title="Goals against">GA</abbr></th>
                  <th scope="col"><abbr title="Goal difference">GD</abbr></th>
                  <th scope="col"><abbr title="Points">Pts</abbr></th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={row.team}>
                    <td>
                      {index + 1}
                      {finished && index < table.advanceCount ? <> <Badge tone="ok">Advancing place</Badge></> : null}
                    </td>
                    <th scope="row">
                      {row.isThisTeam ? <strong>{row.team} (this team)</strong> : row.team}
                    </th>
                    <td>{row.played}</td>
                    <td>{row.won}</td>
                    <td>{row.drawn}</td>
                    <td>{row.lost}</td>
                    <td>{row.goalsFor}</td>
                    <td>{row.goalsAgainst}</td>
                    <td>{row.goalDifference}</td>
                    <td>{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtle">
            The top {table.advanceCount} of each group advance to the next stage. Teams are ordered by points, goal
            difference, then goals scored.
          </p>
        </Panel>
      )}

      <Panel title="Knockout" className="panel-wide">
        {entry.knockout.length === 0 ? (
          <p className="empty-state">This team has no knockout match in this competition.</p>
        ) : (
          entry.knockout.map((round) => (
            <div key={round.round}>
              <h3>{round.round}</h3>
              <MatchTable caption={`${round.round} matches`} matches={round.matches} empty="No matches." />
            </div>
          ))
        )}
      </Panel>

      <Panel title="Team matches in this competition" className="panel-wide">
        <MatchTable caption={`Matches in ${entry.edition}`} matches={entry.matches} empty="No matches are recorded for this competition." />
      </Panel>

      <Panel title="Campaign" className="panel-wide">
        {entry.campaign ? (
          <Metrics
            items={[
              { label: "Campaign", value: entry.campaign.name },
              { label: "Started", value: entry.campaign.startedOn },
              { label: "Played", value: entry.campaign.matchesPlayed },
              { label: "Record", value: `${entry.campaign.wins}W ${entry.campaign.draws}D ${entry.campaign.losses}L` },
              { label: "Qualification status", value: humanizeToken(entry.campaign.qualificationStatus) },
            ]}
          />
        ) : (
          <p className="empty-state">No campaign record exists for this competition.</p>
        )}
      </Panel>

      <Panel title="Squad registration" className="panel-wide">
        {entry.registration ? (
          <>
            <Metrics
              items={[
                { label: "Status", value: REGISTRATION_STATUS_LABEL[entry.registration.status] },
                { label: "Registration", value: entry.registration.locked ? "Locked" : "Open" },
                { label: "Deadline", value: entry.registration.deadline },
                { label: "Registered players", value: entry.registration.playerCount },
                ...(entry.registration.limits
                  ? [
                      {
                        label: "Squad limits",
                        value: `Preliminary ${entry.registration.limits.preliminary} · Final ${entry.registration.limits.final} · Matchday ${entry.registration.limits.matchday}`,
                      },
                    ]
                  : []),
              ]}
            />
            <div className="table-scroll" role="region" aria-label="Registered players" tabIndex={0}>
              <table>
                <caption className="visually-hidden">Players registered for this competition</caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Position</th>
                    <th scope="col">Eligibility today</th>
                    <th scope="col">Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.registration.players.map((row) => (
                    <tr key={row.player.id}>
                      <th scope="row">
                        <EntityLink reference={row.player} onOpenEntity={onOpenEntity} />
                      </th>
                      <td>{row.position ?? "—"}</td>
                      <td>{eligibilityLabel(row.eligibility)}</td>
                      <td>
                        <Badge tone={AVAILABILITY_TONE[row.availability]}>{humanizeToken(row.availability)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle">
              The registered squad is a separate record from the current squad. Registration is handled by the coaching
              staff and the simulation, so it cannot be changed here.
            </p>
          </>
        ) : (
          <>
            <p className="empty-state">No squad registration is recorded for this competition. Deadline: Not recorded.</p>
            <p className="subtle">
              Players recorded on duty for this competition: {entry.onDutyCount}. Registration is handled by the coaching
              staff and the simulation.
            </p>
          </>
        )}
      </Panel>
    </>
  );
};
